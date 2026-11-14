import { expect, mock, test } from "claude-code/testing";
import type { TestBody } from "claude-code/testing";

type TestEngine = Parameters<TestBody>[0];
type TestOn = Parameters<TestBody>[1];

// An in-memory stand-in for ccb-mcp, answering with the same shapes as
// packages/mcp-server/src/server.ts and refusing what its validation refuses (button IDs
// and labels, empty bodies, unknown note IDs; variable names normalised), plus the engine
// calls the panes make.

interface Prompt { id: string; title: string; body: string; category: string | null; tags: string[]; favorite: boolean; deleted: boolean; used: number; conflictOf?: string | null }
interface Note { id: string; title: string; body: string; pinned: boolean; updatedAt: string; deleted: boolean; conflictOf?: string | null }
interface SyncSummary { state: string; line: string; pending: number; conflicts: number; message: string | null; pendingKeys: string[] }
interface Fake {
  prompts: Prompt[];
  categories: Array<{ id: string; name: string }>;
  variables: Record<string, string>;
  buttons: Array<{ id: string; label: string; icon: string | null; action: Record<string, unknown>; order: number }>;
  notes: Note[];
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
  submits: string[];
  fills: Array<{ text: string; mode?: string }>;
  copies: string[];
  opened: string[];
  toasts: string[];
  draft: string;
  clientStateCalls: () => number;
  /** Tools whose next call fails, once each. */
  failNext: string[];
  settings: { local: Record<string, string | number | boolean | null>; shared: Record<string, string | null> };
  /** Sync as the server reports it; null when the server runs without sync. */
  sync: SyncSummary | null;
  connect: { state: string; url: string | null; message: string | null } | null;
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}${String(++seq).padStart(4, "0")}`;
let tick = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 10, 12, 0, tick++)).toISOString();

function firstLine(body: string): string {
  return (body.split("\n").find((l) => l.trim() !== "") ?? "").replace(/^#+\s*/, "").trim().slice(0, 120) || "Untitled note";
}

function fake(on: TestOn, opts: { draft?: string; failTool?: string; placed?: boolean } = {}): Fake {
  const f: Fake = {
    prompts: [
      { id: "p_plan", title: "Plan my day", body: "Plan my day for {{project}}", category: "c_work", tags: ["daily"], favorite: true, deleted: false, used: 3 },
      { id: "p_review", title: "Review code", body: "Review this code: {{?file}}", category: "c_work", tags: ["code"], favorite: false, deleted: false, used: 1 },
      { id: "p_poem", title: "Write a poem", body: "Write a short poem", category: null, tags: [], favorite: false, deleted: false, used: 0 },
    ],
    categories: [{ id: "c_work", name: "Work" }],
    variables: { project: "Billing API" },
    buttons: [],
    notes: [
      { id: "n_a", title: "Ideas", body: "Ideas\nfirst idea", pinned: false, updatedAt: stamp(), deleted: false },
      { id: "n_b", title: "Todo", body: "Todo\nship M4", pinned: true, updatedAt: stamp(), deleted: false },
    ],
    calls: [],
    submits: [],
    fills: [],
    copies: [],
    opened: [],
    toasts: [],
    draft: opts.draft ?? "",
    clientStateCalls: () => f.calls.filter((c) => c.tool === "client_state").length,
    failNext: [],
    sync: null,
    connect: null,
    settings: {
      local: { "regenerate.autoSubmit": false, "regenerate.source": "auto", "continue.highlightOnTruncation": true, "buttons.maxVisible": 6, "buttons.showBuiltIns": true, "notes.autosaveMs": 2000, "notes.mirrorFiles": true, "sync.mode": "drive-api", "sync.folderPath": null, "sync.intervalSeconds": 60, "translate.target": "auto", "translate.primary": "English", "translate.secondary": "Arabic", "translate.instant": true, "codex.autoSync": true },
      shared: { "regenerate.instructions": null, "continue.message": null },
    },
  };
  const live = <T extends { deleted: boolean }>(xs: T[]) => xs.filter((x) => !x.deleted);
  const summary = (p: Prompt) => ({ id: p.id, title: p.title, category: p.category, tags: p.tags, favorite: p.favorite, conflictOf: p.conflictOf ?? null, preview: p.body });
  const expand = (body: string) => {
    const unanswered: string[] = [];
    const text = body.replace(/\{\{(\?)?(\w+)\}\}/g, (m, ask: string | undefined, name: string) => {
      if (ask) {
        unanswered.push(name);
        return m;
      }
      return f.variables[name] ?? m;
    });
    return { text, unknown: [], unavailable: [], unanswered };
  };

  const answer = (tool: string, a: Record<string, unknown>): unknown => {
    switch (tool) {
      case "client_state":
        return {
          buttons: f.buttons.map((b) => ({ ...b, targetMissing: false })),
          variables: f.variables,
          settings: { regenerate: { autoSubmit: false, source: "auto" }, continue: { highlightOnTruncation: true }, buttons: { maxVisible: 6, showBuiltIns: true }, notes: { autosaveMs: 500 } },
          continueMessage: "Continue.",
          regenerateInstructions: null,
          sync: f.sync,
        };
      case "settings_get":
        return f.settings;
      case "settings_set": {
        const key = String(a["key"]);
        if (key === "sync.intervalSeconds" && Number(a["value"]) < 15) throw new Error(`${JSON.stringify(a["value"])} isn't allowed for ${key}; it stays ${JSON.stringify(f.settings.local[key])}.`);
        f.settings.local[key] = a["value"] as string | number | boolean | null;
        return { saved: { key, value: a["value"] } };
      }
      case "settings_set_shared":
        f.settings.shared[String(a["id"])] = (a["value"] as string | null) ?? null;
        return { saved: { id: a["id"], value: a["value"] } };
      case "sync_now":
      case "sync_status":
        if (!f.sync) throw new Error("Sync isn't running in this server.");
        return { ...f.sync, connect: f.connect };
      case "sync_connect":
        f.connect = { state: "waiting", url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x", message: null };
        return f.connect;
      case "conflict_resolve": {
        const list = (a["collection"] === "notes" ? f.notes : f.prompts) as Array<{ id: string; title: string; body: string; deleted: boolean; conflictOf?: string | null }>;
        const copy = list.find((x) => x.id === a["copyId"] && !x.deleted && x.conflictOf);
        if (!copy) throw new Error("not a conflict copy");
        const original = list.find((x) => x.id === copy.conflictOf);
        if (a["keep"] === "both") {
          copy.conflictOf = null;
          return { kept: { id: copy.id, title: copy.title } };
        }
        if (a["keep"] === "copy" && original) original.body = copy.body;
        copy.deleted = true;
        return { kept: { id: original?.id ?? copy.id, title: original?.title ?? copy.title } };
      }
      case "library_status":
        return { counts: { prompts: live(f.prompts).length, favorites: live(f.prompts).filter((p) => p.favorite).length, categories: 1, variables: 1, buttons: f.buttons.length, notes: live(f.notes).length, conflicts: 0 } };
      case "bank_search": {
        const words = String(a["query"] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const hits = live(f.prompts)
          .filter((p) => words.every((w) => `${p.title} ${p.tags.join(" ")} ${p.body}`.toLowerCase().includes(w)))
          .filter((p) => a["category"] === undefined || p.category === a["category"])
          .filter((p) => !a["favoritesOnly"] || p.favorite)
          .sort((x, y) => Number(y.favorite) - Number(x.favorite) || y.used - x.used);
        return { results: hits.map(summary) };
      }
      case "bank_get": {
        const p = live(f.prompts).find((x) => x.id === a["id"]);
        if (!p) throw new Error(`No prompt with id "${String(a["id"])}"`);
        if (a["markUsed"]) p.used++;
        return { prompt: { ...p, deletedAt: null }, askFields: [], ...(a["expand"] ? { expanded: expand(p.body) } : {}) };
      }
      case "bank_save": {
        const fields = { title: String(a["title"]), body: String(a["body"]) };
        if (fields.title.trim() === "") throw new Error("prompts.title: must not be empty");
        if (fields.body === "") throw new Error("prompts.body: must not be empty");
        let p = a["id"] !== undefined ? f.prompts.find((x) => x.id === a["id"]) : undefined;
        if (a["id"] !== undefined && !p) throw new Error("no record");
        if (!p) {
          p = { id: nextId("p_new"), title: "", body: "", category: null, tags: [], favorite: false, deleted: false, used: 0 };
          f.prompts.push(p);
        }
        Object.assign(p, fields, { deleted: false });
        if (a["category"] !== undefined) p.category = a["category"] as string | null;
        if (a["tags"] !== undefined) p.tags = a["tags"] as string[];
        if (a["favorite"] !== undefined) p.favorite = Boolean(a["favorite"]);
        return { saved: p };
      }
      case "bank_delete": {
        const p = live(f.prompts).find((x) => x.id === a["id"]);
        if (!p) throw new Error("no record");
        p.deleted = true;
        return { deleted: p.id };
      }
      case "bank_list_categories":
        return { categories: f.categories.map((c, i) => ({ ...c, order: i, prompts: live(f.prompts).filter((p) => p.category === c.id).length })), uncategorised: 1 };
      case "variables_list":
        return { variables: f.variables };
      case "variables_set": {
        const name = String(a["name"]).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) throw new Error("variables.id: invalid name");
        f.variables[name] = String(a["value"]);
        return { saved: { name, value: a["value"] } };
      }
      case "variables_delete":
        delete f.variables[String(a["name"]).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")];
        return { deleted: a["name"] };
      case "buttons_list":
        return { buttons: f.buttons.map((b) => ({ ...b, targetMissing: false })) };
      case "buttons_save": {
        const b = { id: String(a["id"]), label: String(a["label"]), icon: (a["icon"] as string | null) ?? null, action: a["action"] as Record<string, unknown>, order: f.buttons.length };
        if (!/^btn_[a-z0-9_]{1,60}$/.test(b.id)) throw new Error("buttons.id: invalid");
        if (b.label.trim() === "" || b.label.length > 24) throw new Error("buttons.label: 1 to 24 characters");
        if ("promptId" in b.action && !live(f.prompts).some((p) => p.id === b.action["promptId"])) throw new Error("buttons.action.promptId: no such prompt");
        f.buttons = [...f.buttons.filter((x) => x.id !== b.id), b];
        return { saved: b };
      }
      case "buttons_delete":
        f.buttons = f.buttons.filter((x) => x.id !== a["id"]);
        return { deleted: a["id"] };
      case "notes_list":
        return {
          notes: live(f.notes)
            .sort((x, y) => Number(y.pinned) - Number(x.pinned) || Date.parse(y.updatedAt) - Date.parse(x.updatedAt))
            .map((n) => ({ id: n.id, title: n.title, pinned: n.pinned, updatedAt: n.updatedAt, conflictOf: n.conflictOf ?? null, length: n.body.length })),
        };
      case "notes_read": {
        const n = live(f.notes).find((x) => x.id === a["id"]);
        if (!n) throw new Error("no note");
        return { note: { ...n, deletedAt: null } };
      }
      case "notes_write": {
        let n = a["id"] !== undefined ? f.notes.find((x) => x.id === a["id"]) : undefined;
        if (a["id"] !== undefined && !n) throw new Error(`notes: no record with id "${String(a["id"])}"`);
        if (n) n.deleted = false; // saving a deleted note brings it back, as in core
        if (!n) {
          n = { id: nextId("n_new"), title: "", body: "", pinned: false, updatedAt: stamp(), deleted: false };
          f.notes.push(n);
        }
        n.body = String(a["body"]);
        n.title = a["title"] !== undefined ? String(a["title"]) : n.title || firstLine(n.body);
        if (a["pinned"] !== undefined) n.pinned = Boolean(a["pinned"]);
        n.updatedAt = stamp();
        return { saved: { id: n.id, title: n.title, updatedAt: n.updatedAt } };
      }
      case "notes_append": {
        const n = live(f.notes).find((x) => x.id === a["id"]);
        if (!n) throw new Error("no note");
        n.body = n.body === "" || n.body.endsWith("\n") ? n.body + String(a["text"]) : `${n.body}\n${String(a["text"])}`;
        n.updatedAt = stamp();
        return { saved: { id: n.id, title: n.title, updatedAt: n.updatedAt } };
      }
      case "notes_delete": {
        const n = live(f.notes).find((x) => x.id === a["id"]);
        if (!n) throw new Error("no note");
        n.deleted = true;
        return { deleted: n.id };
      }
      default:
        throw new Error(`unknown tool ${tool}`);
    }
  };

  on("command.register", () => ({ value: { command: "x" } }) as never);
  on("mcp.connect", (_$, e) => ({ value: { isConnected: true, server: `plugin:prompt-buttons:${(e as { server: string }).server}` } }) as never);
  on("mcp.call", (_$, e) => {
    f.calls.push({ tool: e.tool, args: e.args });
    try {
      if (opts.failTool === e.tool) throw new Error("disk full");
      const once = f.failNext.indexOf(e.tool);
      if (once >= 0) {
        f.failNext.splice(once, 1);
        throw new Error("disk full");
      }
      return { value: { content: [{ type: "text", text: JSON.stringify(answer(e.tool, e.args)) }], isError: false } } as never;
    } catch (error) {
      return { value: { content: [{ type: "text", text: (error as Error).message }], isError: true } } as never;
    }
  });
  on("prompt.submit", (_$, e) => {
    f.submits.push(e.text);
    return { text: e.text } as never;
  });
  on("prompt.fill", (_$, e) => {
    f.fills.push({ text: e.text, ...(e.mode ? { mode: e.mode } : {}) });
    return { isFilled: true } as never;
  });
  on("prompt.read", () => ({ value: { text: f.draft, cursor: 0 } }) as never);
  on("ui.selection", () => ({ value: undefined }) as never);
  on("session.messages", () => ({ value: [] }) as never);
  on("session.model", () => ({ value: "claude-test" }) as never);
  on("ui.toast", (_$, e) => {
    f.toasts.push(JSON.stringify(e));
    return { value: undefined } as never;
  });
  on("ui.open", (_$, e) => {
    f.opened.push((e as { id: string }).id);
    return { value: { isPlaced: opts.placed ?? true } } as never;
  });
  on("ui.status", () => ({ value: undefined }) as never);
  on("ui.copy", (_$, e) => {
    f.copies.push((e as { text: string }).text);
    return { value: { isCopied: true } } as never;
  });
  on("session.start", (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never);
  on("command.run", () => ({}) as never);
  on("turn.complete", (_$, e) => ({ text: (e as { answer: string }).answer }) as never);
  return f;
}

async function start($: TestEngine): Promise<void> {
  await $.session.start({ cwd: "/", surface: "desktop", isInteractive: true } as never);
}

const PANE = (surface: "terminal" | "desktop", id: "ccb-bank" | "ccb-notes") =>
  ({
    plugin: "prompt-buttons",
    surface,
    component: "Pane",
    requestId: id,
    props: { title: id, isFocused: true, bodyColumns: 80, placement: "dock" },
    viewport: { columns: 100, rows: 40, docks: true },
  }) as never;

const ABOVE = { plugin: "prompt-buttons", surface: "desktop", component: "AbovePrompt", props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 4 } } as never;

/** Titles of the prompt rows, in the order shown. */
async function rows(ui: { findAll: (q: never) => Promise<Array<{ key?: string }>> }): Promise<string[]> {
  const found = await ui.findAll({ type: "Box" } as never);
  return found.map((el) => el.key ?? "").filter((k) => k.startsWith("ccb-row-")).map((k) => k.slice("ccb-row-".length));
}

// --- G2: listing, search, filters --------------------------------------------------

test("the Prompts button opens the Prompt Bank, favourites and most used first, on terminal and desktop", async ($, on) => {
  const f = fake(on);
  await start($);
  const row = await $.ui.mount(ABOVE);
  await row.press({ key: "ccb-prompts" });
  expect(f.opened).toEqual(["ccb-bank"]);
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount(PANE(surface, "ccb-bank"));
    expect(await rows(ui as never)).toEqual(["p_plan", "p_review", "p_poem"]);
    expect(await ui.find({ key: "ccb-insert-p_plan" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /3 prompts, 1 favourites, 2 notes/ })).toBeDefined();
    await ui.unmount();
  }
});

test("search filters while typing (after a short pause), and Enter searches at once", async ($, on) => {
  const clock = mock.clock(on);
  const f = fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.input({ key: "ccb-search", text: "co", kind: "change" });
  await ui.input({ key: "ccb-search", text: "code", kind: "change" });
  const before = f.calls.filter((c) => c.tool === "bank_search").length;
  await clock.advance(200);
  await clock.settle();
  const searches = f.calls.filter((c) => c.tool === "bank_search").slice(before);
  expect(searches.map((c) => c.args["query"])).toEqual(["code"]); // the pause drops the half-typed search
  expect(await rows(ui as never)).toEqual(["p_review"]);
  await ui.input({ key: "ccb-search", text: "poem" });
  expect(await rows(ui as never)).toEqual(["p_poem"]);
  await ui.input({ key: "ccb-search", text: "nothing-like-this" });
  expect(await ui.find({ type: "Text", text: "No prompts match." })).toBeDefined();
});

test("category filter and favourites-only toggle narrow the list", async ($, on) => {
  fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("terminal", "ccb-bank"));
  await ui.select({ key: "ccb-category", value: "c_work" });
  expect(await rows(ui as never)).toEqual(["p_plan", "p_review"]);
  await ui.press({ key: "ccb-favorites" });
  expect(await rows(ui as never)).toEqual(["p_plan"]);
  await ui.select({ key: "ccb-category", value: "" });
  await ui.press({ key: "ccb-favorites" });
  expect(await rows(ui as never)).toEqual(["p_plan", "p_review", "p_poem"]);
});

// --- G3: row actions and the edit form -----------------------------------------------

test("Insert fills the prompt box with variables filled in; Send submits; Copy copies the body", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-insert-p_plan" });
  expect(f.fills).toEqual([{ text: "Plan my day for Billing API", mode: "insert" }]);
  await ui.press({ key: "ccb-send-p_poem" });
  expect(f.submits).toEqual(["Write a short poem"]);
  await ui.press({ key: "ccb-copy-p_plan" });
  expect(f.copies).toEqual(["Plan my day for {{project}}"]);
  expect(f.calls.filter((c) => c.tool === "bank_get" && c.args["markUsed"]).length).toBe(2);
});

test("Send with a {{?question}} puts the text in the box instead and says what to fill in", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-send-p_review" });
  expect(f.submits).toEqual([]);
  expect(f.fills).toEqual([{ text: "Review this code: {{?file}}", mode: "replace" }]);
  expect(f.toasts.join()).toContain("{{?file}}");
});

test("Edit saves changes through bank_save; New creates; Cancel discards", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-edit-p_poem" });
  expect((await ui.find({ key: "ccb-edit-title" }))).toBeDefined();
  await ui.input({ key: "ccb-edit-title", text: "Write a haiku", kind: "change" });
  await ui.input({ key: "ccb-edit-tags", text: "fun, short", kind: "change" });
  await ui.select({ key: "ccb-edit-category", value: "c_work" });
  await ui.press({ key: "ccb-edit-favorite" });
  await ui.press({ key: "ccb-edit-save" });
  expect(f.calls.find((c) => c.tool === "bank_save")?.args).toEqual({ id: "p_poem", title: "Write a haiku", body: "Write a short poem", category: "c_work", tags: ["fun", "short"], favorite: true });
  expect(await ui.find({ key: "ccb-edit-title" })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: 'Saved "Write a haiku".' })).toBeDefined();

  await ui.press({ key: "ccb-new" });
  await ui.input({ key: "ccb-edit-title", text: "Throwaway", kind: "change" });
  await ui.press({ key: "ccb-edit-cancel" });
  expect(f.prompts.some((p) => p.title === "Throwaway")).toBe(false);

  await ui.press({ key: "ccb-new" });
  await ui.input({ key: "ccb-edit-title", text: "Standup", kind: "change" });
  await ui.input({ key: "ccb-edit-body", text: "Summarise yesterday" }); // Enter in the body saves
  expect(f.prompts.find((p) => p.title === "Standup")?.body).toBe("Summarise yesterday");
});

test("a failed save keeps the form and its text", async ($, on) => {
  fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-new" });
  await ui.input({ key: "ccb-edit-body", text: "No title yet", kind: "change" });
  await ui.press({ key: "ccb-edit-save" }); // empty title is refused by the server
  expect(await ui.find({ type: "Text", text: /Not saved: prompts.title/ })).toBeDefined();
  expect((await ui.find({ key: "ccb-edit-body" }))?.props?.["value"]).toBe("No title yet");
});

test("an edit in progress survives closing and reopening the pane", async ($, on) => {
  fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  let ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-edit-p_plan" });
  await ui.input({ key: "ccb-edit-title", text: "Plan my week", kind: "change" });
  await ui.unmount();
  await $.command.run({ command: "pb", args: "" } as never);
  ui = await $.ui.mount(PANE("terminal", "ccb-bank"));
  expect((await ui.find({ key: "ccb-edit-title" }))?.props?.["value"]).toBe("Plan my week");
});

test("Duplicate copies a prompt; Delete asks first, then deletes; Undo delete restores it", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-dup-p_poem" });
  expect(f.prompts.filter((p) => !p.deleted).map((p) => p.title)).toContain("Write a poem (copy)");

  await ui.press({ key: "ccb-del-p_poem" });
  expect(f.calls.some((c) => c.tool === "bank_delete")).toBe(false);
  await ui.press({ key: "ccb-del-keep-p_poem" });
  expect(await ui.find({ key: "ccb-del-confirm-p_poem" })).toBeUndefined();
  await ui.press({ key: "ccb-del-p_poem" });
  await ui.press({ key: "ccb-del-confirm-p_poem" });
  expect(f.prompts.find((p) => p.id === "p_poem")?.deleted).toBe(true);
  expect(await rows(ui as never)).not.toContain("p_poem");

  await ui.press({ key: "ccb-undo-delete" });
  expect(f.prompts.find((p) => p.id === "p_poem")?.deleted).toBe(false);
  expect(await rows(ui as never)).toContain("p_poem");
  expect(await ui.find({ key: "ccb-undo-delete" })).toBeUndefined();
});

test("Save draft opens the form with the prompt box text; /pb save <title> saves it directly", async ($, on) => {
  const f = fake(on, { draft: "Refactor the billing module\nkeep the API" });
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-save-draft" });
  expect((await ui.find({ key: "ccb-edit-title" }))?.props?.["value"]).toBe("Refactor the billing module");
  expect((await ui.find({ key: "ccb-edit-body" }))?.props?.["value"]).toBe("Refactor the billing module\nkeep the API");

  const result = await $.command.run({ command: "pb", args: "save Billing refactor" } as never);
  expect((result as { text?: string }).text).toBe('Saved "Billing refactor" to the Prompt Bank.');
  expect(f.prompts.find((p) => p.title === "Billing refactor")?.body).toBe("Refactor the billing module\nkeep the API");
});

test("/pb save with an empty prompt box says so", async ($, on) => {
  fake(on);
  await start($);
  const result = await $.command.run({ command: "pb", args: "save Title" } as never);
  expect((result as { text?: string }).text).toBe("The prompt box is empty: type the prompt first.");
});

// --- G4: variables and buttons -------------------------------------------------------

test("Variables tab sets, adds and deletes variables, and the button row is refreshed", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-tab-variables" });
  const before = f.clientStateCalls();
  await ui.input({ key: "ccb-var-project", text: "Payments" });
  expect(f.variables["project"]).toBe("Payments");
  expect(f.clientStateCalls()).toBeGreaterThan(before);

  await ui.press({ key: "ccb-newvar-add" });
  expect(await ui.find({ type: "Text", text: "Type a name first." })).toBeDefined();
  await ui.input({ key: "ccb-newvar-name", text: "team", kind: "change" });
  await ui.input({ key: "ccb-newvar-value", text: "Core" });
  expect(f.variables["team"]).toBe("Core");
  expect(await ui.find({ key: "ccb-var-team" })).toBeDefined();

  await ui.press({ key: "ccb-var-del-team" });
  expect(f.variables["team"]).toBeUndefined();
  expect(await ui.find({ key: "ccb-var-team" })).toBeUndefined();
});

test("Buttons tab creates buttons of each kind, and they show on the button row; Delete removes one", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-tab-buttons" });
  expect(await ui.find({ type: "Text", text: "No custom buttons yet." })).toBeDefined();

  const make = async (label: string, type: string, extra: () => Promise<void> = async () => undefined) => {
    await ui.press({ key: "ccb-new-button" });
    await ui.input({ key: "ccb-b-label", text: label, kind: "change" });
    await ui.select({ key: "ccb-b-type", value: type });
    await extra();
    await ui.press({ key: "ccb-b-save" });
  };
  await make("Plan", "submit", () => ui.select({ key: "ccb-b-prompt", value: "p_plan" }).then(() => undefined));
  await make("Greet", "fill", async () => {
    await ui.input({ key: "ccb-b-text", text: "Hello {{project}}", kind: "change" });
    await ui.select({ key: "ccb-b-mode", value: "append" });
  });
  await make("Go on", "continue");
  await make("Tidy", "refine");
  await make("My notes", "open-notes");
  await make("Find review", "insert-prompt", () => ui.input({ key: "ccb-b-text", text: "review", kind: "change" }).then(() => undefined));

  expect(f.buttons.map((b) => [b.id, b.action])).toEqual([
    ["btn_plan", { type: "submit", promptId: "p_plan" }],
    ["btn_greet", { type: "fill", text: "Hello {{project}}", mode: "append" }],
    ["btn_go_on", { type: "continue" }],
    ["btn_tidy", { type: "refine" }],
    ["btn_my_notes", { type: "open-pane", pane: "notes" }],
    ["btn_find_review", { type: "insert-prompt", category: null, search: "review" }],
  ]);
  const row = await $.ui.mount(ABOVE);
  expect(await row.find({ key: "ccb-btn-btn_greet" })).toBeDefined();

  await ui.press({ key: "ccb-bdel-btn_greet" });
  expect(f.buttons.some((b) => b.id === "btn_greet")).toBe(false);
  await row.redraw();
  expect(await row.find({ key: "ccb-btn-btn_greet" })).toBeUndefined();
});

test("custom buttons that open panes and search prompts work from the row", async ($, on) => {
  const f = fake(on);
  f.buttons = [
    { id: "btn_n", label: "N", icon: null, action: { type: "open-pane", pane: "notes" }, order: 0 },
    { id: "btn_s", label: "S", icon: null, action: { type: "insert-prompt", category: null, search: "poem" }, order: 1 },
  ];
  await start($);
  const row = await $.ui.mount(ABOVE);
  await row.press({ key: "ccb-btn-btn_n" });
  await row.press({ key: "ccb-btn-btn_s" });
  expect(f.opened).toEqual(["ccb-notes", "ccb-bank"]);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  expect((await ui.find({ key: "ccb-search" }))?.props?.["value"]).toBe("poem");
  expect(await rows(ui as never)).toEqual(["p_poem"]);
});

test("/pb <words> opens the bank already searching", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "review" } as never);
  expect(f.opened).toEqual(["ccb-bank"]);
  const ui = await $.ui.mount(PANE("terminal", "ccb-bank"));
  expect(await rows(ui as never)).toEqual(["p_review"]);
});

test("a server failure while loading shows a notice instead of breaking the pane", async ($, on) => {
  fake(on, { failTool: "bank_list_categories" });
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  expect(await ui.find({ type: "Text", text: /Couldn't load the Prompt Bank: disk full/ })).toBeDefined();
});

// --- G5: Notes -------------------------------------------------------------------------

test("the Notes button opens Notes: pinned first, the first note open; selecting shows another", async ($, on) => {
  const f = fake(on);
  await start($);
  const row = await $.ui.mount(ABOVE);
  await row.press({ key: "ccb-notes" });
  expect(f.opened).toEqual(["ccb-notes"]);
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount(PANE(surface, "ccb-notes"));
    const buttons = (await ui.findAll({ type: "Button" })).map((b) => b.key ?? "").filter((k) => /^ccb-note-n_/.test(k));
    expect(buttons).toEqual(["ccb-note-n_b", "ccb-note-n_a"]);
    expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("Todo\nship M4");
    await ui.unmount();
  }
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.press({ key: "ccb-note-n_a" });
  expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("Ideas\nfirst idea");
});

test("typing saves on its own after notes.autosaveMs; more typing restarts the wait; Enter saves now", async ($, on) => {
  const clock = mock.clock(on);
  const f = fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.input({ key: "ccb-note-body", text: "Todo\nship M4\nand docs", kind: "change" });
  expect(await ui.find({ type: "Text", text: "Unsaved" })).toBeDefined();
  await clock.advance(300);
  await ui.input({ key: "ccb-note-body", text: "Todo\nship M4\nand docs!", kind: "change" });
  await clock.advance(300);
  await clock.settle();
  expect(f.notes.find((n) => n.id === "n_b")?.body).toBe("Todo\nship M4"); // 600 ms in, but only 300 since the last key
  await clock.advance(300);
  await clock.settle();
  expect(f.notes.find((n) => n.id === "n_b")?.body).toBe("Todo\nship M4\nand docs!");
  expect(f.calls.filter((c) => c.tool === "notes_write").length).toBe(1);
  expect(await ui.find({ type: "Text", text: "Saved" })).toBeDefined();

  await ui.input({ key: "ccb-note-body", text: "Todo\ndone" });
  expect(f.notes.find((n) => n.id === "n_b")?.body).toBe("Todo\ndone");
});

test("New note, rename, pin, copy, insert into prompt and delete", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.press({ key: "ccb-note-new" });
  expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("");
  await ui.press({ key: "ccb-note-save" }); // nothing typed: nothing saved
  expect(f.calls.some((c) => c.tool === "notes_write")).toBe(false);
  await ui.input({ key: "ccb-note-body", text: "Meeting\nagenda" });
  const created = f.notes.find((n) => n.body === "Meeting\nagenda");
  expect(created?.title).toBe("Meeting");

  await ui.press({ key: "ccb-note-rename" });
  await ui.input({ key: "ccb-note-title", text: "Monday meeting" });
  expect(created?.title).toBe("Monday meeting");
  expect(await ui.find({ type: "Text", text: "Monday meeting" })).toBeDefined();

  await ui.press({ key: "ccb-note-pin" });
  expect(created?.pinned).toBe(true);
  expect((await ui.find({ key: "ccb-note-pin" }))?.props?.["label"]).toBe("Unpin");

  await ui.press({ key: "ccb-note-copy" });
  expect(f.copies).toEqual(["Meeting\nagenda"]);
  await ui.press({ key: "ccb-note-insert" });
  expect(f.fills).toEqual([{ text: "Meeting\nagenda", mode: "insert" }]);

  await ui.press({ key: "ccb-note-del" });
  expect(created?.deleted).toBe(false);
  await ui.press({ key: "ccb-note-del-confirm" });
  expect(created?.deleted).toBe(true);
  expect(await ui.find({ type: "Text", text: 'Deleted "Monday meeting".' })).toBeDefined();
});

test("switching notes saves the text of the note being left", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.input({ key: "ccb-note-body", text: "Todo\nunsaved line", kind: "change" });
  await ui.press({ key: "ccb-note-n_a" });
  expect(f.notes.find((n) => n.id === "n_b")?.body).toBe("Todo\nunsaved line");
  expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("Ideas\nfirst idea");
});

// --- G6: never overwrite unsaved text --------------------------------------------------

test("a change made elsewhere while you type is offered, not loaded over your text: Keep mine saves yours", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.input({ key: "ccb-note-body", text: "Todo\nmine", kind: "change" });
  const note = f.notes.find((n) => n.id === "n_b");
  if (note) note.body = "Todo\ntheirs"; // another device, via sync or the Markdown file
  await $.turn.complete({ turnId: "t1", answer: "ok", durationMs: 1, isAborted: false, reason: "answer" } as never);
  expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("Todo\nmine");
  expect(await ui.find({ key: "ccb-note-keep-mine" })).toBeDefined();
  await ui.press({ key: "ccb-note-keep-mine" });
  expect(note?.body).toBe("Todo\nmine");
  expect(await ui.find({ key: "ccb-note-keep-mine" })).toBeUndefined();
});

test("Load theirs replaces your unsaved text with the other version", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.input({ key: "ccb-note-body", text: "Todo\nmine", kind: "change" });
  const note = f.notes.find((n) => n.id === "n_b");
  if (note) note.body = "Todo\ntheirs";
  await $.command.run({ command: "n", args: "" } as never); // reopening reloads too
  await ui.press({ key: "ccb-note-load-theirs" });
  expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("Todo\ntheirs");
  expect(await ui.find({ type: "Text", text: "Unsaved" })).toBeUndefined();
  expect(note?.body).toBe("Todo\ntheirs");
});

test("a reload with no change elsewhere keeps unsaved text quietly", async ($, on) => {
  fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.input({ key: "ccb-note-body", text: "Todo\nmine", kind: "change" });
  await $.command.run({ command: "n", args: "" } as never);
  expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("Todo\nmine");
  expect(await ui.find({ key: "ccb-note-keep-mine" })).toBeUndefined();
});

// --- G7: /n <text> -----------------------------------------------------------------

test("/n <text> adds to the open note, or starts a new note when none is open", async ($, on) => {
  const f = fake(on);
  await start($);
  let result = await $.command.run({ command: "n", args: "call the bank" } as never);
  expect((result as { text?: string }).text).toBe('Started a new note: "call the bank".');
  expect(f.notes.find((n) => n.body === "call the bank")).toBeDefined();

  result = await $.command.run({ command: "n", args: "and the insurer" } as never);
  expect((result as { text?: string }).text).toBe('Added to "call the bank".');
  expect(f.notes.find((n) => n.title === "call the bank")?.body).toBe("call the bank\nand the insurer");
});

test("/n <text> while the open note has unsaved text keeps that text and adds to it", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.input({ key: "ccb-note-body", text: "Todo\ntyped", kind: "change" });
  await $.command.run({ command: "n", args: "from the command" } as never);
  expect(f.notes.find((n) => n.id === "n_b")?.body).toBe("Todo\ntyped\nfrom the command");
});

// --- regressions from the independent M4 review ----------------------------------------

const TURN = { turnId: "t1", answer: "ok", durationMs: 1, isAborted: false, reason: "answer" } as never;

test("autosave never decides a change made elsewhere: both texts wait for Keep mine / Load theirs (review #1)", async ($, on) => {
  const clock = mock.clock(on);
  const f = fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.input({ key: "ccb-note-body", text: "Todo\nmine", kind: "change" });
  const note = f.notes.find((n) => n.id === "n_b");
  if (note) note.body = "Todo\ntheirs";
  await $.turn.complete(TURN);
  await clock.advance(5000);
  await clock.settle();
  expect(note?.body).toBe("Todo\ntheirs");
  expect(await ui.find({ key: "ccb-note-keep-mine" })).toBeDefined();
  await ui.press({ key: "ccb-note-save" });
  await ui.press({ key: "ccb-note-pin" });
  expect(note?.body).toBe("Todo\ntheirs");
  expect(note?.pinned).toBe(true); // unchanged: pin was refused
  expect(await ui.find({ type: "Text", text: "Choose Keep mine or Load theirs first." })).toBeDefined();
  const r = await $.command.run({ command: "n", args: "more" } as never);
  expect((r as { text?: string }).text).toBe("Not added: Choose Keep mine or Load theirs first.");
  expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("Todo\nmine");
});

test("a failed save keeps you on the note, with its text, instead of switching (review #2)", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.input({ key: "ccb-note-body", text: "Todo\nprecious", kind: "change" });
  f.failNext.push("notes_write");
  await ui.press({ key: "ccb-note-n_a" });
  expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("Todo\nprecious");
  expect(await ui.find({ type: "Text", text: /Not saved: disk full/ })).toBeDefined();
  f.failNext.push("notes_write");
  await ui.press({ key: "ccb-note-new" });
  expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("Todo\nprecious");
  await ui.press({ key: "ccb-note-n_a" }); // saving works again: it saves, then switches
  expect(f.notes.find((n) => n.id === "n_b")?.body).toBe("Todo\nprecious");
  expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("Ideas\nfirst idea");
});

test("/n <text> while writing a new note adds to it instead of discarding it (review #3)", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.press({ key: "ccb-note-new" });
  await ui.input({ key: "ccb-note-body", text: "Draft idea", kind: "change" });
  const r = await $.command.run({ command: "n", args: "plus this" } as never);
  expect((r as { text?: string }).text).toBe('Added to "Draft idea".');
  expect(f.notes.filter((n) => !n.deleted).map((n) => n.body)).toContain("Draft idea\nplus this");
  expect(f.notes.filter((n) => n.body === "plus this")).toEqual([]);
});

test("reopening Notes while writing a new note keeps it, and it still autosaves (review #4)", async ($, on) => {
  const clock = mock.clock(on);
  const f = fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.press({ key: "ccb-note-new" });
  await ui.input({ key: "ccb-note-body", text: "Fresh thought", kind: "change" });
  await $.command.run({ command: "n", args: "" } as never);
  expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("Fresh thought");
  await clock.advance(600);
  await clock.settle();
  expect(f.notes.filter((n) => n.body === "Fresh thought").length).toBe(1);
});

test("a note deleted elsewhere: unsaved text is kept and saves as a new note", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.input({ key: "ccb-note-body", text: "Todo\nkeep me", kind: "change" });
  const gone = f.notes.find((n) => n.id === "n_b");
  if (gone) gone.deleted = true;
  await $.turn.complete(TURN);
  expect(await ui.find({ type: "Text", text: /deleted elsewhere. Your text is kept/ })).toBeDefined();
  await ui.press({ key: "ccb-note-save" });
  expect(gone?.deleted).toBe(true);
  expect(f.notes.filter((n) => !n.deleted && n.body === "Todo\nkeep me").length).toBe(1);
});

test("Rename and delete confirmation survive a completed turn (review #9)", async ($, on) => {
  fake(on);
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.press({ key: "ccb-note-rename" });
  await ui.input({ key: "ccb-note-title", text: "Half typ", kind: "change" });
  await ui.press({ key: "ccb-note-del" });
  await $.turn.complete(TURN);
  expect((await ui.find({ key: "ccb-note-title" }))?.props?.["value"]).toBe("Half typ");
  expect(await ui.find({ key: "ccb-note-del-confirm" })).toBeDefined();
});

test("new buttons never overwrite an existing one, including labels without Latin letters (review #5)", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-tab-buttons" });
  for (const label of ["Review", "review!", "مراجعة", "🚀"]) {
    await ui.press({ key: "ccb-new-button" });
    await ui.input({ key: "ccb-b-label", text: label, kind: "change" });
    await ui.input({ key: "ccb-b-text", text: `Do ${label}` });
  }
  expect(f.buttons.map((b) => [b.id, b.label])).toEqual([
    ["btn_review", "Review"],
    ["btn_review_2", "review!"],
    ["btn_button", "مراجعة"],
    ["btn_button_2", "🚀"],
  ]);
});

test("a search button can open on a category", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-tab-buttons" });
  await ui.press({ key: "ccb-new-button" });
  await ui.input({ key: "ccb-b-label", text: "Work", kind: "change" });
  await ui.select({ key: "ccb-b-type", value: "insert-prompt" });
  await ui.select({ key: "ccb-b-category", value: "c_work" });
  await ui.press({ key: "ccb-b-save" });
  expect(f.buttons[0]?.action).toEqual({ type: "insert-prompt", category: "c_work", search: null });
});

test("Save draft doesn't replace a prompt being edited; /pb <search> says the form hides results (review #6, #7)", async ($, on) => {
  fake(on, { draft: "something else" });
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-edit-p_plan" });
  await ui.input({ key: "ccb-edit-title", text: "Plan my week", kind: "change" });
  await ui.press({ key: "ccb-save-draft" }).catch(() => undefined); // not on screen while editing
  const r = await $.command.run({ command: "pb", args: "save" } as never);
  expect((r as { text?: string }).text).toBe("Save or cancel the prompt you're editing first.");
  expect((await ui.find({ key: "ccb-edit-title" }))?.props?.["value"]).toBe("Plan my week");
  await $.command.run({ command: "pb", args: "poem" } as never);
  expect(await ui.find({ type: "Text", text: /Save or cancel the prompt you're editing to see the search results/ })).toBeDefined();
  expect((await ui.find({ key: "ccb-edit-title" }))?.props?.["value"]).toBe("Plan my week");
});

test("the variable notice shows the name as saved (review #10)", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-tab-variables" });
  await ui.input({ key: "ccb-newvar-name", text: "My Var", kind: "change" });
  await ui.input({ key: "ccb-newvar-value", text: "x" });
  expect(f.variables["my_var"]).toBe("x");
  expect(await ui.find({ type: "Text", text: "Saved {{my_var}}." })).toBeDefined();
});

// --- M5b: sync in the row, the Prompt Bank and Notes ------------------------------------

const SYNCED = { state: "idle", line: "Sync ✓ 12:04", pending: 0, conflicts: 0, message: null, pendingKeys: [] };

test("the row shows the sync status; pressing it syncs now when all is well", async ($, on) => {
  const f = fake(on);
  f.sync = { ...SYNCED };
  await start($);
  const row = await $.ui.mount(ABOVE);
  expect((await row.find({ key: "ccb-sync" }))?.props?.["label"]).toBe("Sync ✓ 12:04");
  await row.press({ key: "ccb-sync" });
  expect(f.calls.some((c) => c.tool === "sync_now")).toBe(true);
  expect(f.toasts.join()).toContain("Sync ✓ 12:04");
});

test("no sync button when the server has no sync or sync is off", async ($, on) => {
  const f = fake(on);
  await start($);
  let row = await $.ui.mount(ABOVE);
  expect(await row.find({ key: "ccb-sync" })).toBeUndefined();
  await row.unmount();
  f.sync = { ...SYNCED, state: "off", line: "Sync off" };
  await $.turn.complete({ turnId: "t", answer: "a", durationMs: 1, isAborted: false, reason: "answer" } as never);
  row = await $.ui.mount(ABOVE);
  expect(await row.find({ key: "ccb-sync" })).toBeUndefined();
});

test("signed out: the sync button opens the Prompt Bank, where Connect starts the sign-in and shows the link", async ($, on) => {
  const clock = mock.clock(on);
  const f = fake(on);
  f.sync = { ...SYNCED, state: "signed-out", line: "Sync ⚠ sign in", message: "Not signed in to Google Drive." };
  await start($);
  const row = await $.ui.mount(ABOVE);
  await row.press({ key: "ccb-sync" });
  expect(f.opened).toEqual(["ccb-bank"]);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  expect(await ui.find({ type: "Text", text: "Sync ⚠ sign in" })).toBeDefined();
  expect(await ui.find({ key: "ccb-sync-now" })).toBeUndefined();
  await ui.press({ key: "ccb-connect" });
  const link = await ui.find({ type: "Link" } as never); // a Link keeps no key in the drawing
  expect(link?.props?.["href"]).toMatch(/^https:\/\/accounts\.google\.com\//);
  expect(await ui.find({ key: "ccb-connect" })).toBeUndefined(); // waiting: no second sign-in

  // The sign-in finishes in the browser; the pane notices by itself.
  f.connect = { state: "done", url: null, message: "Connected." };
  f.sync = { ...SYNCED };
  await clock.advance(3000);
  await clock.settle();
  expect(await ui.find({ type: "Link" } as never)).toBeUndefined();
  expect(await ui.find({ type: "Text", text: "Connected." })).toBeDefined();
  expect(await ui.find({ key: "ccb-sync-now" })).toBeDefined();
});

test("Sync now in the Prompt Bank, and /pb sync, report the outcome", async ($, on) => {
  const f = fake(on);
  f.sync = { ...SYNCED, state: "offline", line: "Sync offline · 2 pending", pending: 2, message: "Google Drive is unreachable." };
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  expect(await ui.find({ type: "Text", text: "Google Drive is unreachable." })).toBeDefined();
  await ui.press({ key: "ccb-sync-now" });
  expect(await ui.find({ type: "Text", text: "Sync offline · 2 pending: Google Drive is unreachable." })).toBeDefined();
  const r = await $.command.run({ command: "pb", args: "sync" } as never);
  expect((r as { text?: string }).text).toBe("Sync offline · 2 pending: Google Drive is unreachable.");
});

test("/pb sync without sync running explains it", async ($, on) => {
  fake(on);
  await start($);
  const r = await $.command.run({ command: "pb", args: "sync" } as never);
  expect((r as { text?: string }).text).toMatch(/Couldn't sync: Sync isn't running/);
});

test("opening a pane pulls other computers' changes right away", async ($, on) => {
  const clock = mock.clock(on);
  const f = fake(on);
  f.sync = { ...SYNCED };
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  await clock.settle();
  expect(f.calls.filter((c) => c.tool === "sync_now")).toHaveLength(1);
  await $.command.run({ command: "pb", args: "" } as never);
  await clock.settle();
  expect(f.calls.filter((c) => c.tool === "sync_now")).toHaveLength(2);
});

test("a conflict copy of a prompt offers Keep this, Keep other and Keep both", async ($, on) => {
  const f = fake(on);
  f.sync = { ...SYNCED, line: "Sync ⚠ 1 conflict", conflicts: 1 };
  f.prompts.push({ id: "p_poem_c", title: "Write a poem (conflict)", body: "Write a long poem", category: null, tags: [], favorite: false, deleted: false, used: 0, conflictOf: "p_poem" });
  await start($);
  const row = await $.ui.mount(ABOVE);
  expect((await row.find({ key: "ccb-sync" }))?.props?.["variant"]).toBe("primary");
  await row.press({ key: "ccb-sync" }); // a conflict to resolve: opens the Prompt Bank
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  expect(await ui.find({ key: "ccb-keep-copy-p_poem" })).toBeUndefined();
  await ui.press({ key: "ccb-keep-copy-p_poem_c" });
  expect(f.prompts.find((p) => p.id === "p_poem")?.body).toBe("Write a long poem");
  expect(f.prompts.find((p) => p.id === "p_poem_c")?.deleted).toBe(true);
  expect(await ui.find({ key: "ccb-keep-copy-p_poem_c" })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: 'Kept one version of "Write a poem".' })).toBeDefined();
});

test("a conflict copy of a note offers the same choice; Keep both makes it an ordinary note", async ($, on) => {
  const f = fake(on);
  f.sync = { ...SYNCED, conflicts: 1, line: "Sync ⚠ 1 conflict" };
  f.notes.push({ id: "n_b_c", title: "Todo (conflict)", body: "Todo\nother", pinned: false, updatedAt: stamp(), deleted: false, conflictOf: "n_b" });
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  expect(await ui.find({ key: "ccb-note-keep-both" })).toBeUndefined(); // the original (pinned, open first) has no choice
  await ui.press({ key: "ccb-note-n_b_c" });
  expect((await ui.find({ key: "ccb-note-n_b_c" }))?.props?.["label"]).toBe("Todo (conflict)");
  await ui.press({ key: "ccb-note-keep-both" });
  expect(f.notes.find((n) => n.id === "n_b_c")?.conflictOf).toBeNull();
  expect(await ui.find({ type: "Text", text: 'Kept both versions of "Todo (conflict)".' })).toBeDefined();
});

test("Keep other on a note copy keeps the original's text and opens it", async ($, on) => {
  const f = fake(on);
  f.sync = { ...SYNCED, conflicts: 1 };
  f.notes.push({ id: "n_a_c", title: "Ideas (conflict)", body: "Ideas\nother", pinned: false, updatedAt: stamp(), deleted: false, conflictOf: "n_a" });
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  await ui.press({ key: "ccb-note-n_a_c" });
  await ui.press({ key: "ccb-note-keep-original" });
  expect(f.notes.find((n) => n.id === "n_a_c")?.deleted).toBe(true);
  expect(f.notes.find((n) => n.id === "n_a")?.body).toBe("Ideas\nfirst idea");
  expect((await ui.find({ key: "ccb-note-body" }))?.props?.["value"]).toBe("Ideas\nfirst idea");
});

test("notes changed here and not uploaded yet are marked with a dot", async ($, on) => {
  const f = fake(on);
  f.sync = { ...SYNCED, state: "offline", line: "Sync offline · 1 pending", pending: 1, pendingKeys: ["notes/n_a"] };
  await start($);
  await $.command.run({ command: "n", args: "" } as never);
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount(PANE(surface, "ccb-notes"));
    expect((await ui.find({ key: "ccb-note-n_a" }))?.props?.["label"]).toBe("• Ideas");
    expect((await ui.find({ key: "ccb-note-n_b" }))?.props?.["label"]).toBe("* Todo");
    expect(await ui.find({ type: "Text", text: "Sync offline · 1 pending · • not uploaded yet" })).toBeDefined();
    await ui.unmount();
  }
  // Before sync is set up, nothing is marked.
  f.sync = { ...SYNCED, state: "not-set-up", line: "Sync not set up", pendingKeys: ["notes/n_a"] };
  await $.turn.complete({ turnId: "t", answer: "a", durationMs: 1, isAborted: false, reason: "answer" } as never);
  const ui = await $.ui.mount(PANE("desktop", "ccb-notes"));
  expect((await ui.find({ key: "ccb-note-n_a" }))?.props?.["label"]).toBe("Ideas");
});

// --- M8: the Settings tab ------------------------------------------------------------------

test("the Settings tab changes this device's settings and the shared ones", async ($, on) => {
  const f = fake(on);
  await start($);
  await $.command.run({ command: "pb", args: "" } as never);
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount(PANE(surface, "ccb-bank"));
    await ui.press({ key: "ccb-tab-settings" });
    expect((await ui.find({ key: "ccb-set-translate.instant" }))?.props?.["label"]).toBe("Instant: on");
    await ui.unmount();
  }
  const ui = await $.ui.mount(PANE("desktop", "ccb-bank"));
  await ui.press({ key: "ccb-tab-settings" });
  await ui.press({ key: "ccb-set-regenerate.autoSubmit" });
  expect(f.settings.local["regenerate.autoSubmit"]).toBe(true);
  expect((await ui.find({ key: "ccb-set-regenerate.autoSubmit" }))?.props?.["label"]).toBe("Send the rewrite at once: on");
  await ui.select({ key: "ccb-set-translate.primary", value: "French" });
  expect(f.settings.local["translate.primary"]).toBe("French");
  await ui.select({ key: "ccb-set-buttons.maxVisible", value: "3" });
  expect(f.settings.local["buttons.maxVisible"]).toBe(3); // a number, not text
  await ui.input({ key: "ccb-set-continue-message", text: "Keep going, please." });
  expect(f.settings.shared["continue.message"]).toBe("Keep going, please.");
  expect(await ui.find({ type: "Text", text: "Saved for every device." })).toBeDefined();
  await ui.input({ key: "ccb-set-continue-message", text: "  " });
  expect(f.settings.shared["continue.message"]).toBeNull();
  // Folder mode shows the folder field.
  expect(await ui.find({ key: "ccb-set-sync-folderPath" })).toBeUndefined();
  await ui.select({ key: "ccb-set-sync.mode", value: "drive-folder" });
  await ui.input({ key: "ccb-set-sync-folderPath", text: "/drive/CCB" });
  expect(f.settings.local["sync.folderPath"]).toBe("/drive/CCB");
  expect(f.calls.filter((c) => c.tool === "client_state").length).toBeGreaterThan(3); // the row picks the changes up
});


// --- cloud sessions: the app shows no pane, so the commands answer in text ----------------

test("in a session with no panes, /pb lists prompts as text, and /pb use and /pb send take a number", async ($, on) => {
  const clock = mock.clock(on);
  const f = fake(on, { placed: false });
  await start($);
  const list = ((await $.command.run({ command: "pb", args: "" } as never)) as { text?: string }).text ?? "";
  expect(list).toMatch(/1\. ★ Plan my day · /);
  expect(list).toMatch(/Review code/);
  expect(list).toMatch(/\/pb use <number>/);
  const lines = list.split("\n");
  const plan = lines.findIndex((l) => l.includes("Plan my day")) + 1;
  const poem = lines.findIndex((l) => l.includes("Write a poem")) + 1;
  await $.command.run({ command: "pb", args: `use ${plan}` } as never);
  expect(f.fills.at(-1)?.text).toBe("Plan my day for Billing API");
  await $.command.run({ command: "pb", args: `send ${poem}` } as never);
  await clock.settle();
  expect(f.submits.at(-1)).toBe("Write a short poem");
  const none = ((await $.command.run({ command: "pb", args: "zzz" } as never)) as { text?: string }).text;
  expect(none).toBe('No prompts match "zzz".');
});

test("in a session with no panes, /n lists notes and /n read shows one", async ($, on) => {
  fake(on, { placed: false });
  await start($);
  const list = ((await $.command.run({ command: "n", args: "" } as never)) as { text?: string }).text ?? "";
  expect(list).toMatch(/1\. 📌 Todo/);
  expect(list).toMatch(/2\. Ideas/);
  const one = ((await $.command.run({ command: "n", args: "read 1" } as never)) as { text?: string }).text;
  expect(one).toBe("**Todo**\n\nTodo\nship M4");
});
