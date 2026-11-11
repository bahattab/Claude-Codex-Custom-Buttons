// ccb-mcp: the MCP server Claude Code, Codex and Claude Desktop use to reach the library.
// Tools for the Prompt Bank, categories, variables, buttons, notes and Regenerate, plus a
// prompt list built from the Prompt Bank. Never logs prompt or note text.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GetPromptRequestSchema, ListPromptsRequestSchema, type Prompt as McpPrompt } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  BUILT_IN_VARIABLES,
  DEFAULT_CONTINUE_MESSAGE,
  appendNote,
  askFields,
  buildRefineRequest,
  dateBuiltIns,
  deleteButton,
  deleteCategory,
  deleteNote,
  deletePrompt,
  resolveConflict,
  deleteVariable,
  expand,
  live,
  recordUse,
  saveButton,
  saveCategory,
  saveNote,
  savePrompt,
  searchPrompts,
  setSharedSetting,
  setVariable,
  sharedSetting,
  slugify,
  type BuiltInVariable,
  type ButtonAction,
  type Library,
  type OpResult,
  type Prompt,
  type SharedSettingId,
} from "@ccb/core";
import { LibraryStore, writeCodexSkills } from "@ccb/store";
import { loadClient, login, statusLine, tokenStoreFor, type SetupOptions, type SyncEngine, type SyncStatus } from "@ccb/sync";

export const SERVER_NAME = "ccb-mcp";
export const SERVER_VERSION = "0.1.0";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Runs a tool body, turning thrown errors into an MCP error result. */
async function guard(body: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await body();
  } catch (error) {
    return failure((error as Error).message);
  }
}

class OpFailed extends Error {}

function unwrap<T>(result: OpResult<T>): { library: Library; record: T } {
  if (!result.ok) throw new OpFailed(result.errors.join("; "));
  return result.value;
}

/** Drops keys whose value is undefined (a client may send only some built-ins). */
function definedOnly(values: Partial<Record<BuiltInVariable, string | undefined>>): Partial<Record<BuiltInVariable, string>> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Partial<Record<BuiltInVariable, string>>;
}

function variableMap(library: Library): Record<string, string> {
  return Object.fromEntries(live(library.variables).map((v) => [v.id, v.value]));
}

function promptSummary(p: Prompt): Record<string, unknown> {
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    tags: p.tags,
    favorite: p.favorite,
    conflictOf: p.conflictOf,
    preview: p.body.length > 160 ? `${p.body.slice(0, 157)}...` : p.body,
  };
}

/** A status with its one-line summary ("Sync ✓ 12:04", "Sync offline · 2 pending" ...). */
function withLine(status: SyncStatus): SyncStatus & { line: string } {
  return { ...status, line: statusLine(status) };
}

/** What the Claude Code button row needs to draw the sync button and note markers. */
function summary(status: SyncStatus): Record<string, unknown> {
  return {
    state: status.state,
    line: statusLine(status),
    pending: status.pending,
    conflicts: status.conflicts,
    message: status.message,
    pendingKeys: status.pendingKeys.filter((k) => k.startsWith("notes/")),
  };
}

const builtInsShape = z
  .object(Object.fromEntries(BUILT_IN_VARIABLES.map((n) => [n, z.string().optional()])) as Record<BuiltInVariable, z.ZodOptional<z.ZodString>>)
  .partial()
  .optional()
  .describe("Values for built-in variables this client knows, e.g. selection, draft, last_prompt, cwd");

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("submit"), promptId: z.string().optional(), text: z.string().optional() }),
  z.object({
    type: z.literal("fill"),
    promptId: z.string().optional(),
    text: z.string().optional(),
    mode: z.enum(["replace", "append", "insert"]).default("replace"),
  }),
  z.object({ type: z.literal("refine") }),
  z.object({ type: z.literal("continue") }),
  z.object({ type: z.literal("insert-prompt"), category: z.string().nullable().default(null), search: z.string().nullable().default(null) }),
  z.object({ type: z.literal("open-pane"), pane: z.enum(["notes", "prompt-bank"]) }),
]);

function toAction(input: z.infer<typeof actionSchema>): ButtonAction {
  // Exactly one of promptId/text is checked by core validation; keep only what was given.
  const { type } = input;
  if (type === "submit" || type === "fill") {
    const target = input.promptId !== undefined ? { promptId: input.promptId } : { text: input.text ?? "" };
    if (input.promptId !== undefined && input.text !== undefined) {
      throw new OpFailed("buttons: give promptId or text, not both");
    }
    return (type === "fill" ? { type, ...target, mode: input.mode } : { type, ...target }) as ButtonAction;
  }
  return input as ButtonAction;
}

/**
 * Prompt names shown to clients: "ccb-<slug>". The oldest prompt with a given slug keeps
 * the plain name, so adding a prompt never takes over an existing name; later ones get a
 * suffix from their ID. Names stay within 64 characters.
 */
export function promptNames(library: Library): Map<string, Prompt> {
  const names = new Map<string, Prompt>();
  const reserved = new Set(["ccb-continue", "ccb-regenerate"]);
  const oldestFirst = [...live(library.prompts)].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const p of oldestFirst) {
    let name = `ccb-${slugify(p.title).slice(0, 48).replace(/-+$/, "")}`;
    if (names.has(name) || reserved.has(name)) name = `${name}-${p.id.slice(-8).toLowerCase()}`;
    names.set(name, p);
  }
  return names;
}

export interface ServerOptions {
  /** The sync engine to tell about changes and to run for sync_now / sync_status. */
  sync?: SyncEngine;
  /** Where Codex keeps its skills ($CODEX_HOME); generated $ccb-* skills follow buttons and favourites. */
  codexHome?: string;
  /** For tests: how sign-in reaches Google and the OS, and the browser. */
  connect?: Omit<SetupOptions, "home"> & { openBrowser?: (url: string) => void | Promise<void> };
}

/** A Google sign-in started from a pane (sync_connect). */
interface Connecting {
  state: "waiting" | "done" | "failed";
  url: string | null;
  message: string | null;
}

export function createServer(store: LibraryStore, opts: ServerOptions = {}): McpServer {
  const mcp = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { prompts: { listChanged: true } },
      instructions:
        "Claude Codex Custom Buttons: a Prompt Bank, prompt variables ({{name}}), custom buttons and notes, shared with Claude Code, Codex and Claude Desktop and synced through the user's Google Drive. Use bank_search before bank_get; never invent prompt IDs.",
    },
  );

  const read = async (): Promise<Library> => {
    const { library, status } = await store.read();
    if (library === null) throw new Error(`The library uses a newer schema version (${(status as { foundVersion: number }).foundVersion}); update ccb-mcp.`);
    return library;
  };

  const promptsChanged = (): void => {
    if (mcp.isConnected()) mcp.sendPromptListChanged();
  };

  /** Keeps Codex's $ccb-* skills in step with buttons and favourite prompts (codex.autoSync). */
  let codexTimer: NodeJS.Timeout | null = null;
  const refreshCodex = (): void => {
    if (codexTimer) clearTimeout(codexTimer);
    codexTimer = setTimeout(() => {
      codexTimer = null;
      void (async () => {
        const { library } = await store.read();
        if (library?.settings.codex.autoSync) {
          await writeCodexSkills(library, { onlyIfInstalled: true, ...(opts.codexHome ? { home: opts.codexHome } : {}) });
        }
      })().catch(() => undefined);
    }, 500);
    codexTimer.unref?.();
  };

  /** Something changed here: sync uploads it after sync.pushDelayMs, and Codex skills follow. */
  const changed = (): void => {
    opts.sync?.notifyChanged();
    refreshCodex();
  };

  const write = async <T>(op: (lib: Library, ctx: Parameters<Parameters<LibraryStore["update"]>[0]>[1]) => OpResult<T>): Promise<T> => {
    let record: T | undefined;
    await store.update((lib, ctx) => {
      const result = unwrap(op(lib, ctx));
      record = result.record;
      return result.library;
    });
    changed();
    return record as T;
  };

  /** Picks up notes edited in their Markdown files; those edits sync like any other. */
  const importNotes = async (): Promise<void> => {
    if ((await store.importNoteEdits()) > 0) changed();
  };

  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
  const edits = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const deletes = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;
  const syncsFiles = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

  // --- library -------------------------------------------------------------------------

  mcp.registerTool(
    "library_status",
    { title: "Library status", description: "Counts of prompts, categories, variables, buttons and notes, and this device's identity.", annotations: readOnly },
    () =>
      guard(async () => {
        const library = await read();
        const device = await store.getDevice();
        return ok({
          device,
          revision: library.revision,
          counts: {
            prompts: live(library.prompts).length,
            favorites: live(library.prompts).filter((p) => p.favorite).length,
            categories: live(library.categories).length,
            variables: live(library.variables).length,
            buttons: live(library.buttons).length,
            notes: live(library.notes).length,
            conflicts: live(library.prompts).filter((p) => p.conflictOf).length + live(library.notes).filter((n) => n.conflictOf).length,
          },
          sync: { mode: library.settings.sync.mode },
        });
      }),
  );

  mcp.registerTool(
    "client_state",
    {
      title: "Client state",
      description:
        "Everything a button row needs in one call: custom buttons in order (with targetMissing when a button's prompt was deleted), prompt variables, display settings, the Continue message and the Regenerate instructions.",
      annotations: readOnly,
    },
    () =>
      guard(async () => {
        const library = await read();
        const livePrompts = new Set(live(library.prompts).map((p) => p.id));
        const { regenerate, buttons, notes } = library.settings;
        return ok({
          buttons: live(library.buttons)
            .sort((a, b) => a.order - b.order)
            .map(({ id, label, icon, action, order }) => ({
              id,
              label,
              icon,
              action,
              order,
              targetMissing: "promptId" in action && !livePrompts.has(action.promptId),
            })),
          variables: variableMap(library),
          settings: {
            regenerate,
            continue: library.settings.continue,
            buttons,
            notes: { autosaveMs: notes.autosaveMs },
          },
          continueMessage: sharedSetting(library, "continue.message") ?? DEFAULT_CONTINUE_MESSAGE,
          regenerateInstructions: sharedSetting(library, "regenerate.instructions"),
          sync: opts.sync ? summary(await opts.sync.status()) : null,
        });
      }),
  );

  // --- Prompt Bank ---------------------------------------------------------------------

  mcp.registerTool(
    "bank_search",
    {
      title: "Search the Prompt Bank",
      description: "Search saved prompts. Every word must match the title, tags or body. An empty query lists prompts (favourites and recently used first).",
      inputSchema: {
        query: z.string().default("").describe("Words to search for"),
        category: z.string().optional().describe("Only this category ID"),
        tag: z.string().optional(),
        favoritesOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).default(20),
      },
      annotations: readOnly,
    },
    (args) =>
      guard(async () => {
        const library = await read();
        const hits = searchPrompts(library.prompts, args.query, {
          ...(args.category !== undefined ? { category: args.category } : {}),
          ...(args.tag !== undefined ? { tag: args.tag } : {}),
          ...(args.favoritesOnly !== undefined ? { favoritesOnly: args.favoritesOnly } : {}),
          limit: args.limit,
          now: new Date().toISOString(),
        });
        return ok({ results: hits.map((h) => promptSummary(h.prompt)) });
      }),
  );

  mcp.registerTool(
    "bank_get",
    {
      title: "Get a saved prompt",
      description: "Get one prompt by ID, optionally with {{variables}} filled in. Set markUsed when the prompt is actually used.",
      inputSchema: {
        id: z.string().describe("Prompt ID from bank_search"),
        expand: z.boolean().default(false).describe("Fill in {{variables}}"),
        answers: z.record(z.string(), z.string()).default({}).describe("Values for {{?ask}} fields"),
        builtIns: builtInsShape,
        markUsed: z.boolean().default(false),
      },
      annotations: { ...edits, idempotentHint: false },
    },
    (args) =>
      guard(async () => {
        let library = await read();
        let prompt = library.prompts.find((p) => p.id === args.id && p.deletedAt === null);
        if (!prompt) return failure(`No prompt with id ${JSON.stringify(args.id)}`);
        if (args.markUsed) {
          library = await store.update((lib) => ({
            ...lib,
            prompts: lib.prompts.map((p) => (p.id === args.id && p.deletedAt === null ? recordUse(p, new Date().toISOString()) : p)),
          }));
          prompt = library.prompts.find((p) => p.id === args.id) ?? prompt;
          changed();
        }
        const result: Record<string, unknown> = { prompt, askFields: askFields(prompt.body) };
        if (args.expand) {
          const expanded = expand(prompt.body, {
            variables: variableMap(library),
            builtIns: { ...dateBuiltIns(new Date()), ...definedOnly(args.builtIns ?? {}) },
            answers: args.answers,
          });
          result["expanded"] = expanded;
        }
        return ok(result);
      }),
  );

  mcp.registerTool(
    "bank_save",
    {
      title: "Save a prompt",
      description: "Create a prompt (no id) or update one (with id). Use {{name}} for variables and {{?name}} for values asked each time.",
      inputSchema: {
        id: z.string().optional(),
        title: z.string(),
        body: z.string(),
        category: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        favorite: z.boolean().optional(),
      },
      annotations: edits,
    },
    (args) =>
      guard(async () => {
        const record = await write((lib, ctx) =>
          savePrompt(
            lib,
            {
              title: args.title,
              body: args.body,
              ...(args.id !== undefined ? { id: args.id } : {}),
              ...(args.category !== undefined ? { category: args.category } : {}),
              ...(args.tags !== undefined ? { tags: args.tags } : {}),
              ...(args.favorite !== undefined ? { favorite: args.favorite } : {}),
            },
            ctx,
            store.randomSource(),
          ),
        );
        promptsChanged();
        return ok({ saved: record });
      }),
  );

  mcp.registerTool(
    "bank_delete",
    { title: "Delete a prompt", description: "Delete a prompt everywhere (it can be restored by saving it again with the same id).", inputSchema: { id: z.string() }, annotations: deletes },
    (args) =>
      guard(async () => {
        const record = await write((lib, ctx) => deletePrompt(lib, args.id, ctx));
        promptsChanged();
        return ok({ deleted: record.id });
      }),
  );

  mcp.registerTool(
    "bank_list_categories",
    { title: "List categories", description: "Categories with the number of prompts in each.", annotations: readOnly },
    () =>
      guard(async () => {
        const library = await read();
        const prompts = live(library.prompts);
        return ok({
          categories: live(library.categories)
            .sort((a, b) => a.order - b.order)
            .map((c) => ({ id: c.id, name: c.name, order: c.order, prompts: prompts.filter((p) => p.category === c.id).length })),
          uncategorised: prompts.filter((p) => p.category === null).length,
        });
      }),
  );

  mcp.registerTool(
    "categories_save",
    {
      title: "Save a category",
      description: "Create or rename a category. id: lowercase letters, digits, - and _.",
      inputSchema: { id: z.string(), name: z.string(), order: z.number().int().min(0).optional() },
      annotations: edits,
    },
    (args) =>
      guard(async () => {
        const record = await write((lib, ctx) =>
          saveCategory(lib, { id: args.id, name: args.name, ...(args.order !== undefined ? { order: args.order } : {}) }, ctx),
        );
        return ok({ saved: record });
      }),
  );

  mcp.registerTool(
    "categories_delete",
    { title: "Delete a category", description: "Delete a category. Its prompts keep the category ID until edited.", inputSchema: { id: z.string() }, annotations: deletes },
    (args) => guard(async () => ok({ deleted: (await write((lib, ctx) => deleteCategory(lib, args.id, ctx))).id })),
  );

  // --- variables -----------------------------------------------------------------------

  mcp.registerTool(
    "variables_list",
    { title: "List variables", description: "Prompt variables ({{name}}) and their values.", annotations: readOnly },
    () => guard(async () => ok({ variables: variableMap(await read()) })),
  );

  mcp.registerTool(
    "variables_set",
    {
      title: "Set a variable",
      description: "Set a prompt variable. Names are lowercased; other characters become _.",
      inputSchema: { name: z.string(), value: z.string() },
      annotations: edits,
    },
    (args) =>
      guard(async () => {
        const record = await write((lib, ctx) => setVariable(lib, args.name, args.value, ctx));
        return ok({ saved: { name: record.id, value: record.value } });
      }),
  );

  mcp.registerTool(
    "variables_delete",
    { title: "Delete a variable", description: "Delete a prompt variable.", inputSchema: { name: z.string() }, annotations: deletes },
    (args) => guard(async () => ok({ deleted: (await write((lib, ctx) => deleteVariable(lib, args.name, ctx))).id })),
  );

  // --- buttons -------------------------------------------------------------------------

  mcp.registerTool(
    "buttons_list",
    { title: "List buttons", description: "Custom buttons in display order.", annotations: readOnly },
    () =>
      guard(async () => {
        const library = await read();
        const livePrompts = new Set(live(library.prompts).map((p) => p.id));
        return ok({
          buttons: live(library.buttons)
            .sort((a, b) => a.order - b.order)
            .map(({ id, label, icon, action, order }) => ({
              id,
              label,
              icon,
              action,
              order,
              // A button whose prompt was deleted is shown disabled (docs/features.md).
              targetMissing: "promptId" in action && !livePrompts.has(action.promptId),
            })),
        });
      }),
  );

  mcp.registerTool(
    "buttons_save",
    {
      title: "Save a button",
      description:
        "Create or update a custom button. Actions: submit or fill (a promptId or text; fill also takes mode replace/append/insert), refine, continue, insert-prompt (category/search), open-pane (notes or prompt-bank). Buttons cannot run commands.",
      inputSchema: {
        id: z.string().describe("btn_ followed by lowercase letters, digits or _"),
        label: z.string(),
        icon: z.string().nullable().optional(),
        action: actionSchema,
        order: z.number().int().min(0).optional(),
      },
      annotations: edits,
    },
    (args) =>
      guard(async () => {
        const action = toAction(args.action);
        const record = await write((lib, ctx) =>
          saveButton(
            lib,
            {
              id: args.id,
              label: args.label,
              action,
              ...(args.icon !== undefined ? { icon: args.icon } : {}),
              ...(args.order !== undefined ? { order: args.order } : {}),
            },
            ctx,
          ),
        );
        return ok({ saved: record });
      }),
  );

  mcp.registerTool(
    "buttons_delete",
    { title: "Delete a button", description: "Delete a custom button.", inputSchema: { id: z.string() }, annotations: deletes },
    (args) => guard(async () => ok({ deleted: (await write((lib, ctx) => deleteButton(lib, args.id, ctx))).id })),
  );

  // --- notes ---------------------------------------------------------------------------

  mcp.registerTool(
    "notes_list",
    // Not read-only: listing first imports edits made to the notes' Markdown files.
    { title: "List notes", description: "Notes, pinned first, then most recently edited.", annotations: syncsFiles },
    () =>
      guard(async () => {
        await importNotes();
        const library = await read();
        const notes = live(library.notes)
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
          .map((n) => ({ id: n.id, title: n.title, pinned: n.pinned, updatedAt: n.updatedAt, conflictOf: n.conflictOf, length: n.body.length }));
        return ok({ notes });
      }),
  );

  mcp.registerTool(
    "notes_read",
    { title: "Read a note", description: "The full text of one note.", inputSchema: { id: z.string() }, annotations: syncsFiles },
    (args) =>
      guard(async () => {
        await importNotes();
        const note = (await read()).notes.find((n) => n.id === args.id && n.deletedAt === null);
        return note ? ok({ note }) : failure(`No note with id ${JSON.stringify(args.id)}`);
      }),
  );

  mcp.registerTool(
    "notes_write",
    {
      title: "Write a note",
      description: "Create a note (no id) or replace a note's text (with id). The title defaults to the first line.",
      inputSchema: { id: z.string().optional(), title: z.string().optional(), body: z.string(), pinned: z.boolean().optional() },
      annotations: edits,
    },
    (args) =>
      guard(async () => {
        const record = await write((lib, ctx) =>
          saveNote(
            lib,
            {
              body: args.body,
              ...(args.id !== undefined ? { id: args.id } : {}),
              ...(args.title !== undefined ? { title: args.title } : {}),
              ...(args.pinned !== undefined ? { pinned: args.pinned } : {}),
            },
            ctx,
            store.randomSource(),
          ),
        );
        return ok({ saved: { id: record.id, title: record.title, updatedAt: record.updatedAt } });
      }),
  );

  mcp.registerTool(
    "notes_append",
    { title: "Append to a note", description: "Add text to the end of a note, on a new line.", inputSchema: { id: z.string(), text: z.string() }, annotations: edits },
    (args) =>
      guard(async () => {
        const record = await write((lib, ctx) => appendNote(lib, args.id, args.text, ctx, store.randomSource()));
        return ok({ saved: { id: record.id, title: record.title, updatedAt: record.updatedAt } });
      }),
  );

  mcp.registerTool(
    "notes_delete",
    { title: "Delete a note", description: "Delete a note everywhere.", inputSchema: { id: z.string() }, annotations: deletes },
    (args) => guard(async () => ok({ deleted: (await write((lib, ctx) => deleteNote(lib, args.id, ctx))).id })),
  );

  // --- settings and Regenerate ---------------------------------------------------------

  mcp.registerTool(
    "settings_set_shared",
    {
      title: "Set a shared setting",
      description: "Change the Regenerate instructions or the Continue message for every device. null restores the built-in default.",
      inputSchema: { id: z.enum(["regenerate.instructions", "continue.message"]), value: z.string().nullable() },
      annotations: edits,
    },
    (args) =>
      guard(async () => {
        const record = await write((lib, ctx) => setSharedSetting(lib, args.id as SharedSettingId, args.value, ctx));
        return ok({ saved: { id: record.id, value: record.value } });
      }),
  );

  mcp.registerTool(
    "refine_instructions",
    {
      title: "Regenerate instructions",
      description:
        "The instructions for rewriting a rough prompt into a clearer one. With text, returns the complete request (system and user parts) for the client's own model; ccb-mcp never calls a model itself.",
      inputSchema: { text: z.string().optional(), extra: z.string().optional() },
      annotations: readOnly,
    },
    (args) =>
      guard(async () => {
        const library = await read();
        const request = buildRefineRequest(args.text ?? "", {
          instructions: sharedSetting(library, "regenerate.instructions"),
          ...(args.extra !== undefined ? { extra: args.extra } : {}),
        });
        return ok(args.text === undefined ? { instructions: request.system } : request);
      }),
  );

  // --- prompts (dynamic list from the Prompt Bank) -------------------------------------

  mcp.server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const library = await read();
    const prompts: McpPrompt[] = [
      { name: "ccb-continue", title: "Continue", description: "Continue a reply that was cut off." },
      {
        name: "ccb-regenerate",
        title: "Regenerate my prompt",
        description: "Rewrite a rough prompt into a clearer one.",
        arguments: [
          { name: "text", description: "The prompt to improve", required: true },
          { name: "extra", description: "Anything else to change", required: false },
        ],
      },
    ];
    for (const [name, p] of promptNames(library)) {
      prompts.push({
        name,
        title: p.title,
        description: p.body.length > 120 ? `${p.body.slice(0, 117)}...` : p.body,
        arguments: askFields(p.body).map((f) => ({
          name: f.name,
          description: f.default !== null ? `Default: ${f.default}` : `Value for {{?${f.name}}}`,
          required: f.default === null,
        })),
      });
    }
    return { prompts };
  });

  mcp.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const library = await read();
    const args = request.params.arguments ?? {};
    const message = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });
    if (request.params.name === "ccb-continue") {
      return message(sharedSetting(library, "continue.message") ?? DEFAULT_CONTINUE_MESSAGE);
    }
    if (request.params.name === "ccb-regenerate") {
      const req = buildRefineRequest(args["text"] ?? "", {
        instructions: sharedSetting(library, "regenerate.instructions"),
        ...(args["extra"] !== undefined ? { extra: args["extra"] } : {}),
      });
      return message(`${req.system}\n\n${req.user}`);
    }
    const prompt = promptNames(library).get(request.params.name);
    if (!prompt) throw new Error(`Unknown prompt: ${request.params.name}`);
    const expanded = expand(prompt.body, { variables: variableMap(library), builtIns: dateBuiltIns(new Date()), answers: args });
    return { description: prompt.title, ...message(expanded.text) };
  });

  // --- conflicts -----------------------------------------------------------------------

  mcp.registerTool(
    "conflict_resolve",
    {
      title: "Resolve a conflict copy",
      description:
        'Settle a conflict copy of a prompt or note (made when two devices edited it at once): keep "original" (delete the copy), "copy" (the copy\'s text replaces the original) or "both" (the copy becomes an ordinary prompt or note).',
      inputSchema: { collection: z.enum(["prompts", "notes"]), copyId: z.string(), keep: z.enum(["original", "copy", "both"]) },
      annotations: { ...edits, destructiveHint: true },
    },
    (args) =>
      guard(async () => {
        const record = await write((lib, ctx) => resolveConflict(lib, args.collection, args.copyId, args.keep, ctx));
        if (args.collection === "prompts") promptsChanged();
        return ok({ kept: { id: record.id, title: record.title } });
      }),
  );

  // --- sync ----------------------------------------------------------------------------

  const syncUnavailable = (): ToolResult => failure("Sync isn't running in this server.");
  let connecting: Connecting | null = null;
  let connectStarting: Promise<ToolResult> | null = null;

  mcp.registerTool(
    "sync_status",
    {
      title: "Sync status",
      description: "Google Drive sync status: state (idle, syncing, offline, signed-out, not-set-up, off, error), pending changes, conflicts, last sync times and other devices. Sync is automatic.",
      annotations: readOnly,
    },
    () => guard(async () => (opts.sync ? ok({ ...withLine(await opts.sync.status()), connect: connecting }) : syncUnavailable())),
  );

  mcp.registerTool(
    "sync_now",
    {
      title: "Sync now",
      description: "Pull changes from other devices and upload this device's changes now. Sync already runs by itself; use this only when asked to sync immediately.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    () =>
      guard(async () => {
        if (!opts.sync) return syncUnavailable();
        const status = await opts.sync.syncNow();
        promptsChanged(); // a pull may have brought new prompts
        refreshCodex();
        return ok({ ...withLine(status), connect: connecting });
      }),
  );

  mcp.registerTool(
    "sync_connect",
    {
      title: "Connect Google Drive",
      description:
        "Start the one-time Google sign-in for Drive sync. Opens the browser on this computer and returns the sign-in link; sync_status reports when it finishes. Needs the Google OAuth client to be set up first (docs/google-cloud-setup.md).",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    () =>
      guard(async () => {
        // One sign-in at a time: a second press while one is starting or waiting reuses it.
        if (connectStarting) return connectStarting;
        if (connecting?.state === "waiting" && connecting.url) return ok(connecting);
        connectStarting = startConnect().finally(() => {
          connectStarting = null;
        });
        return connectStarting;
      }),
  );

  async function startConnect(): Promise<ToolResult> {
        const library = await read();
        const client = await loadClient(store.paths.home, library);
        if ("missing" in client) return failure(client.missing);
        const setup: SetupOptions = { ...(opts.connect ?? {}), home: store.paths.home };
        const tokens = await tokenStoreFor(setup, library);
        if ("unavailable" in tokens) return failure(tokens.unavailable);
        const attempt: Connecting = { state: "waiting", url: null, message: null };
        connecting = attempt;
        const gotUrl = new Promise<void>((resolve) => {
          void login({
            client,
            store: tokens,
            ...(opts.connect?.fetch ? { fetch: opts.connect.fetch } : {}),
            ...(opts.connect?.openBrowser ? { openBrowser: opts.connect.openBrowser } : {}),
            onUrl: (url) => {
              attempt.url = url;
              resolve();
            },
          })
            .then(async () => {
              if (library.settings.sync.mode !== "drive-api") {
                await store.update((lib) => ({ ...lib, settings: { ...lib.settings, sync: { ...lib.settings.sync, mode: "drive-api" } } }));
              }
              attempt.state = "done";
              attempt.message = `Connected. The sign-in is kept in: ${tokens.name}.`;
              // A sync problem now is reported by the sync status, not as a failed sign-in.
              await opts.sync?.syncNow().catch(() => undefined);
            })
            .catch((error: unknown) => {
              attempt.state = "failed";
              const text = (error as Error).message;
              attempt.message = /timed out/.test(text) ? "Sign-in timed out. Press Connect Google Drive to try again." : text;
              resolve();
            });
        });
        await gotUrl;
        return attempt.state === "failed" ? failure(attempt.message ?? "Sign-in failed.") : ok(attempt);
  }

  return mcp;
}
