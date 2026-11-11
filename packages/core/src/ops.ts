// Edits to a library, shared by the MCP server, the CLI and (later) the Claude mod.
// Pure: they return a new library or a list of errors, and never touch files.
import { ulid } from "./ids.js";
import { applyEdit, deleteRecord, newMeta, restoreRecord } from "./records.js";
import { deriveNoteTitle, normalizeVariableName, validateRecord } from "./schema.js";
import type {
  Button,
  ButtonAction,
  Category,
  CollectionName,
  EditContext,
  Library,
  Note,
  Prompt,
  Result,
  SharedSetting,
  SharedSettingId,
  SyncMeta,
  SyncedData,
  Variable,
} from "./types.js";

export type OpResult<T> = Result<{ library: Library; record: T }>;

/** The position after the last live record, for a new button or category. */
function nextOrder(records: ReadonlyArray<SyncMeta & { order: number }>): number {
  const orders = records.filter((r) => r.deletedAt === null).map((r) => r.order);
  return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

function fail<T>(...errors: string[]): Result<T> {
  return { ok: false, errors };
}

function put<C extends CollectionName>(library: Library, collection: C, record: SyncedData[C][number]): Library {
  const list = library[collection] as SyncMeta[];
  const exists = list.some((r) => r.id === record.id);
  const next = exists ? list.map((r) => (r.id === record.id ? record : r)) : [...list, record];
  return { ...library, [collection]: next };
}

function find<C extends CollectionName>(library: Library, collection: C, id: string): SyncedData[C][number] | undefined {
  return (library[collection] as SyncMeta[]).find((r) => r.id === id) as SyncedData[C][number] | undefined;
}

/** Validates `draft`, then creates or edits it in `collection`. */
function save<C extends CollectionName>(
  library: Library,
  collection: C,
  prev: SyncedData[C][number] | undefined,
  draft: SyncedData[C][number],
  ctx: EditContext,
): OpResult<SyncedData[C][number]> {
  const checked = validateRecord(collection, draft);
  if (!checked.ok) return checked;
  let record: SyncedData[C][number] = checked.value;
  if (prev) {
    const base = prev.deletedAt !== null ? restoreRecord(prev, ctx) : prev;
    record = applyEdit(base, { ...record, deletedAt: null }, ctx);
  }
  return { ok: true, value: { library: put(library, collection, record), record } };
}

function remove<C extends CollectionName>(library: Library, collection: C, id: string, ctx: EditContext): OpResult<SyncedData[C][number]> {
  const prev = find(library, collection, id);
  if (!prev || prev.deletedAt !== null) return fail(`${collection}: no record with id ${JSON.stringify(id)}`);
  const record = deleteRecord(prev, ctx);
  return { ok: true, value: { library: put(library, collection, record), record } };
}

// --- prompts --------------------------------------------------------------------------

export interface PromptInput {
  id?: string;
  title: string;
  body: string;
  category?: string | null;
  tags?: string[];
  favorite?: boolean;
}

export function savePrompt(library: Library, input: PromptInput, ctx: EditContext, random: () => number): OpResult<Prompt> {
  const prev = input.id !== undefined ? find(library, "prompts", input.id) : undefined;
  if (input.id !== undefined && !prev) return fail(`prompts: no record with id ${JSON.stringify(input.id)}`);
  const base: Prompt = prev ?? {
    ...newMeta(ulid(Date.parse(ctx.now), random), ctx),
    title: "",
    body: "",
    category: null,
    tags: [],
    favorite: false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: ctx.now,
    conflictOf: null,
  };
  const draft: Prompt = {
    ...base,
    title: input.title,
    body: input.body,
    category: input.category !== undefined ? input.category : base.category,
    tags: input.tags ?? base.tags,
    favorite: input.favorite ?? base.favorite,
  };
  return save(library, "prompts", prev, draft, ctx);
}

export const deletePrompt = (library: Library, id: string, ctx: EditContext): OpResult<Prompt> =>
  remove(library, "prompts", id, ctx);

// --- categories -----------------------------------------------------------------------

export function saveCategory(library: Library, input: { id: string; name: string; order?: number }, ctx: EditContext): OpResult<Category> {
  const prev = find(library, "categories", input.id);
  const draft: Category = { ...(prev ?? newMeta(input.id, ctx)), id: input.id, name: input.name, order: input.order ?? prev?.order ?? nextOrder(library.categories) };
  return save(library, "categories", prev, draft, ctx);
}

export const deleteCategory = (library: Library, id: string, ctx: EditContext): OpResult<Category> =>
  remove(library, "categories", id, ctx);

// --- variables ------------------------------------------------------------------------

export function setVariable(library: Library, name: string, value: string, ctx: EditContext): OpResult<Variable> {
  const id = normalizeVariableName(name);
  const prev = find(library, "variables", id);
  return save(library, "variables", prev, { ...(prev ?? newMeta(id, ctx)), id, value }, ctx);
}

export const deleteVariable = (library: Library, name: string, ctx: EditContext): OpResult<Variable> =>
  remove(library, "variables", normalizeVariableName(name), ctx);

// --- buttons --------------------------------------------------------------------------

export interface ButtonInput {
  id: string;
  label: string;
  icon?: string | null;
  action: ButtonAction;
  order?: number;
}

export function saveButton(library: Library, input: ButtonInput, ctx: EditContext): OpResult<Button> {
  const prev = find(library, "buttons", input.id);
  if ("promptId" in input.action) {
    const target = find(library, "prompts", input.action.promptId);
    if (!target || target.deletedAt !== null) return fail(`buttons: prompt ${input.action.promptId} does not exist`);
  }
  const draft: Button = {
    ...(prev ?? newMeta(input.id, ctx)),
    id: input.id,
    label: input.label,
    icon: input.icon !== undefined ? input.icon : (prev?.icon ?? null),
    action: input.action,
    order: input.order ?? prev?.order ?? nextOrder(library.buttons),
  };
  return save(library, "buttons", prev, draft, ctx);
}

export const deleteButton = (library: Library, id: string, ctx: EditContext): OpResult<Button> =>
  remove(library, "buttons", id, ctx);

// --- notes ----------------------------------------------------------------------------

export interface NoteInput {
  id?: string;
  title?: string;
  body: string;
  pinned?: boolean;
}

export function saveNote(library: Library, input: NoteInput, ctx: EditContext, random: () => number): OpResult<Note> {
  const prev = input.id !== undefined ? find(library, "notes", input.id) : undefined;
  if (input.id !== undefined && !prev) return fail(`notes: no record with id ${JSON.stringify(input.id)}`);
  const base: Note = prev ?? {
    ...newMeta(ulid(Date.parse(ctx.now), random), ctx),
    title: "",
    body: "",
    pinned: false,
    createdAt: ctx.now,
    conflictOf: null,
  };
  const draft: Note = {
    ...base,
    body: input.body,
    title: input.title ?? (prev ? prev.title : deriveNoteTitle(input.body)),
    pinned: input.pinned ?? base.pinned,
  };
  return save(library, "notes", prev, draft, ctx);
}

/** Appends text to a note on a new line. */
export function appendNote(library: Library, id: string, text: string, ctx: EditContext, random: () => number): OpResult<Note> {
  const prev = find(library, "notes", id);
  if (!prev || prev.deletedAt !== null) return fail(`notes: no record with id ${JSON.stringify(id)}`);
  const body = prev.body === "" ? text : prev.body.endsWith("\n") ? prev.body + text : `${prev.body}\n${text}`;
  return saveNote(library, { id, body }, ctx, random);
}

export const deleteNote = (library: Library, id: string, ctx: EditContext): OpResult<Note> =>
  remove(library, "notes", id, ctx);

// --- conflict copies ------------------------------------------------------------------

const CONFLICT_SUFFIX = " (conflict)";

/**
 * Settles a conflict copy (made when two devices edited a prompt or note at once):
 *   "original"  keep the note or prompt as it is; the copy is deleted
 *   "copy"      the copy's text replaces the original; the copy is deleted
 *   "both"      keep both: the copy becomes an ordinary prompt or note
 * Returns the record that remains (the original, or the copy for "both").
 */
export function resolveConflict(
  library: Library,
  collection: "prompts" | "notes",
  copyId: string,
  keep: "original" | "copy" | "both",
  ctx: EditContext,
): OpResult<Prompt | Note> {
  const copy = find(library, collection, copyId) as Prompt | Note | undefined;
  if (!copy || copy.deletedAt !== null || !copy.conflictOf) return fail(`${collection}: ${copyId} is not a conflict copy`);
  const original = find(library, collection, copy.conflictOf) as Prompt | Note | undefined;
  const title = copy.title.endsWith(CONFLICT_SUFFIX) ? copy.title.slice(0, -CONFLICT_SUFFIX.length) : copy.title;

  if (keep === "both" || (keep === "copy" && !original)) {
    return save(library, collection, copy, { ...copy, conflictOf: null, ...(keep === "copy" ? { title } : {}) } as never, ctx) as OpResult<Prompt | Note>;
  }
  let lib = library;
  let kept: Prompt | Note | undefined = original;
  if (keep === "copy" && original) {
    const content =
      collection === "prompts"
        ? { title, body: copy.body, category: (copy as Prompt).category, tags: (copy as Prompt).tags, favorite: (copy as Prompt).favorite }
        : { title, body: copy.body, pinned: (copy as Note).pinned };
    const saved = save(lib, collection, original, { ...original, ...content } as never, ctx) as OpResult<Prompt | Note>;
    if (!saved.ok) return saved;
    lib = saved.value.library;
    kept = saved.value.record;
  }
  const removed = remove(lib, collection, copyId, ctx);
  if (!removed.ok) return removed as OpResult<Prompt | Note>;
  return { ok: true, value: { library: removed.value.library, record: (kept ?? removed.value.record) as Prompt | Note } };
}

// --- shared settings ------------------------------------------------------------------

export function setSharedSetting(library: Library, id: SharedSettingId, value: string | null, ctx: EditContext): OpResult<SharedSetting> {
  const prev = find(library, "sharedSettings", id);
  return save(library, "sharedSettings", prev, { ...(prev ?? newMeta(id, ctx)), id, value }, ctx);
}

/** The value of a shared setting, or null when it uses the built-in default. */
export function sharedSetting(library: Library, id: SharedSettingId): string | null {
  const record = find(library, "sharedSettings", id);
  return record && record.deletedAt === null ? record.value : null;
}
