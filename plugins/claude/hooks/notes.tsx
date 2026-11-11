// The Notes pane: a scratchpad beside the chat. Notes are synced library records in
// ccb-mcp. Typing saves on its own after a pause; text you haven't saved is never
// replaced by a reload. This file owns its $.state atom.
import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { NoteSummary, NotesView } from "../types";
import { autosaveMs, readClient, refreshClient } from "./client.js";
import { callTool, errorText } from "./mcp.js";

type $ = EngineInterface;

export const NOTES_PANE = "ccb-notes";

const EMPTY: NotesView = {
  list: [],
  selectedId: null,
  title: "",
  draft: "",
  base: "",
  dirty: false,
  theirs: null,
  renaming: null,
  confirmDelete: false,
  saveToken: 0,
  editor: 0,
  notice: null,
};

const notesView = atom({ plugin: "prompt-buttons", key: "notesView" } as const, EMPTY);

interface FullNote {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
}

const CHOOSE_FIRST = "Choose Keep mine or Load theirs first.";

async function setView($: $, change: (v: NotesView) => NotesView): Promise<void> {
  await update($, notesView, (v) => change(v ?? EMPTY));
}

async function loadList($: $): Promise<void> {
  const { notes } = await callTool<{ notes: NoteSummary[] }>($, "notes_list");
  await setView($, (v) => ({ ...v, list: notes }));
}

/** Text in the editor that isn't saved anywhere yet. */
function hasUnsaved(v: NotesView): boolean {
  return v.dirty || (v.selectedId === null && v.draft.trim() !== "");
}

/**
 * Loads a note from ccb-mcp (which first picks up edits made to its Markdown file) into
 * the editor. Unsaved text is never replaced: if the open note changed elsewhere
 * meanwhile, the newer text is offered as "theirs"; unsaved text of another note or of a
 * new note is left alone.
 */
async function loadNote($: $, id: string): Promise<void> {
  const { note } = await callTool<{ note: FullNote }>($, "notes_read", { id });
  await setView($, (v) => {
    if (hasUnsaved(v)) {
      if (v.selectedId !== id) return v;
      return note.body === v.base || note.body === v.draft ? v : { ...v, theirs: note.body };
    }
    const same = v.selectedId === id;
    return {
      ...v,
      selectedId: id,
      title: note.title,
      draft: note.body,
      base: note.body,
      dirty: false,
      theirs: null,
      ...(same ? {} : { confirmDelete: false, renaming: null, editor: v.editor + 1 }),
    };
  });
}

/** Reloads the list and the open note. Errors become a notice. */
export async function refreshNotes($: $): Promise<void> {
  try {
    await loadList($);
    const v = await read($, notesView);
    if (v.selectedId === null && hasUnsaved(v)) return; // a new note is being written
    const id = v.selectedId ?? v.list[0]?.id ?? null;
    if (id === null) return;
    if (v.list.some((n) => n.id === id)) await loadNote($, id);
    else await lostNote($);
  } catch (error) {
    await setView($, (v) => ({ ...v, notice: `Couldn't load notes: ${errorText(error)}` }));
  }
}

/** The open note was deleted elsewhere: keep unsaved text as a new note, else clear. */
async function lostNote($: $): Promise<void> {
  await setView($, (v) =>
    hasUnsaved(v)
      ? { ...v, selectedId: null, title: "", base: "", dirty: true, theirs: null, renaming: null, confirmDelete: false, editor: v.editor + 1, notice: "This note was deleted elsewhere. Your text is kept; saving makes it a new note." }
      : { ...EMPTY, list: v.list, editor: v.editor + 1, notice: "This note was deleted elsewhere." },
  );
}

/** After a turn: re-check the open note, so a change made elsewhere is noticed. */
export async function refreshOpenNote($: $): Promise<void> {
  const { selectedId } = await read($, notesView);
  if (selectedId === null) return;
  try {
    await loadList($);
    const { list } = await read($, notesView);
    if (list.some((n) => n.id === selectedId)) await loadNote($, selectedId);
    else await lostNote($);
  } catch {
    // the pane shows what it has; the next open reloads
  }
}

export async function openNotes($: $): Promise<void> {
  await $.ui.open({ id: NOTES_PANE, title: "Notes", focus: true });
  await refreshNotes($);
  // Opening Notes pulls other computers' changes at once, without holding up the pane.
  $.clock.after(0, async () => {
    try {
      await callTool($, "sync_now");
      await refreshClient($);
      await refreshNotes($);
    } catch {
      // sync not available, or offline: the status shows why
    }
  });
}

/** Settles the open conflict copy: keep its text, the other version, or both. */
async function settle($: $, keep: "copy" | "original" | "both"): Promise<void> {
  const v = await read($, notesView);
  const copy = v.list.find((n) => n.id === v.selectedId);
  if (!copy?.conflictOf) return;
  if (hasUnsaved(v)) return void (await setView($, (cur) => ({ ...cur, notice: "Save or undo your changes to this copy first." })));
  try {
    const { kept } = await callTool<{ kept: { id: string; title: string } }>($, "conflict_resolve", { collection: "notes", copyId: copy.id, keep });
    // Clear the editor first, so the version kept loads in place of the copy's text.
    await setView($, (cur) => ({ ...cur, selectedId: null, draft: "", base: "", dirty: false, theirs: null, editor: cur.editor + 1, notice: keep === "both" ? `Kept both versions of "${kept.title}".` : `Kept one version of "${kept.title}".` }));
    await loadList($);
    await loadNote($, kept.id);
    await refreshClient($);
  } catch (error) {
    await setView($, (cur) => ({ ...cur, notice: `Couldn't resolve the conflict: ${errorText(error)}` }));
  }
}

// One save at a time: a second save waits for the first, so a new note is never created twice.
let saving: Promise<boolean> = Promise.resolve(true);

/**
 * Saves the editor's text now, creating the note if it is new. Returns false if the
 * text is still unsaved afterwards (the save failed, or a change made elsewhere must
 * be resolved first).
 */
export function saveNote($: $): Promise<boolean> {
  const run = saving.then(() => saveNow($));
  saving = run.catch(() => false);
  return run;
}

async function saveNow($: $): Promise<boolean> {
  const v = await read($, notesView);
  if (!hasUnsaved(v)) return true;
  if (v.theirs !== null) {
    await setView($, (cur) => ({ ...cur, notice: CHOOSE_FIRST }));
    return false;
  }
  const draft = v.draft;
  try {
    const { saved } = await callTool<{ saved: { id: string; title: string } }>($, "notes_write", {
      ...(v.selectedId !== null ? { id: v.selectedId } : {}),
      body: draft,
    });
    await setView($, (cur) =>
      cur.editor !== v.editor
        ? cur // the editor moved on; the list reload below shows the save
        : {
            ...cur,
            selectedId: saved.id,
            title: saved.title,
            base: draft,
            // Typing that happened while saving stays unsaved.
            dirty: cur.draft !== draft,
            notice: null,
          },
    );
    await loadList($);
    return true;
  } catch (error) {
    await setView($, (cur) => ({ ...cur, notice: `Not saved: ${errorText(error)}` }));
    return false;
  }
}

async function edit($: $, text: string): Promise<void> {
  let token = 0;
  await setView($, (v) => {
    token = v.saveToken + 1;
    return { ...v, draft: text, dirty: text !== v.base, saveToken: token };
  });
  const wait = await autosaveMs($);
  $.clock.after(wait, async () => {
    const v = await read($, notesView);
    // A change made elsewhere waits for the person's choice; autosave never decides it.
    if (v.saveToken === token && v.theirs === null && hasUnsaved(v)) await saveNote($);
  });
}

async function select($: $, id: string): Promise<void> {
  if (!(await saveNote($))) return; // never lose the text of the note being left
  await setView($, (v) => ({ ...v, selectedId: id, dirty: false, draft: "", base: "", theirs: null, renaming: null, confirmDelete: false, editor: v.editor + 1 }));
  try {
    await loadNote($, id);
  } catch (error) {
    await setView($, (v) => ({ ...v, notice: `Couldn't open that note: ${errorText(error)}` }));
  }
}

async function newNote($: $): Promise<void> {
  if (!(await saveNote($))) return;
  await setView($, (v) => ({ ...v, selectedId: null, title: "", draft: "", base: "", dirty: false, theirs: null, renaming: null, confirmDelete: false, editor: v.editor + 1, notice: null }));
}

/** Appends text to the open note, or starts a new note with it. Returns a message. */
export async function appendToNote($: $, text: string): Promise<string> {
  const v = await read($, notesView);
  if (v.theirs !== null) return `Not added: ${CHOOSE_FIRST}`;
  try {
    if (hasUnsaved(v)) {
      // Keep the unsaved text (of this note, or of a new one) and add to it.
      await edit($, v.draft.endsWith("\n") || v.draft === "" ? v.draft + text : `${v.draft}\n${text}`);
      if (!(await saveNote($))) return "Added to the open note, but not saved yet.";
      const after = await read($, notesView);
      return `Added to "${after.title}".`;
    }
    if (v.selectedId !== null) {
      await callTool($, "notes_append", { id: v.selectedId, text });
      await loadNote($, v.selectedId);
      await loadList($);
      return `Added to "${v.title}".`;
    }
    const { saved } = await callTool<{ saved: { id: string; title: string } }>($, "notes_write", { body: text });
    await loadList($);
    await loadNote($, saved.id);
    return `Started a new note: "${saved.title}".`;
  } catch (error) {
    return `Not saved: ${errorText(error)}`;
  }
}

async function rename($: $, title: string): Promise<void> {
  const v = await read($, notesView);
  if (v.selectedId === null || title.trim() === "") return;
  if (v.theirs !== null) return void (await setView($, (cur) => ({ ...cur, notice: CHOOSE_FIRST })));
  try {
    await callTool($, "notes_write", { id: v.selectedId, title: title.trim(), body: v.draft });
    await setView($, (cur) => (cur.editor !== v.editor ? cur : { ...cur, title: title.trim(), base: v.draft, dirty: cur.draft !== v.draft, renaming: null }));
    await loadList($);
  } catch (error) {
    await setView($, (cur) => ({ ...cur, notice: `Not renamed: ${errorText(error)}` }));
  }
}

async function togglePin($: $): Promise<void> {
  const v = await read($, notesView);
  const current = v.list.find((n) => n.id === v.selectedId);
  if (!current) return;
  if (v.theirs !== null) return void (await setView($, (cur) => ({ ...cur, notice: CHOOSE_FIRST })));
  try {
    await callTool($, "notes_write", { id: current.id, body: v.draft, pinned: !current.pinned });
    await setView($, (cur) => (cur.editor !== v.editor ? cur : { ...cur, base: v.draft, dirty: cur.draft !== v.draft }));
    await loadList($);
  } catch (error) {
    await setView($, (cur) => ({ ...cur, notice: `Couldn't pin: ${errorText(error)}` }));
  }
}

async function remove($: $): Promise<void> {
  const v = await read($, notesView);
  if (v.selectedId === null) return;
  try {
    await callTool($, "notes_delete", { id: v.selectedId });
    await setView($, (cur) => ({ ...EMPTY, list: cur.list, editor: cur.editor + 1, notice: `Deleted "${v.title}".` }));
    await refreshNotes($);
  } catch (error) {
    await setView($, (cur) => ({ ...cur, notice: `Couldn't delete: ${errorText(error)}` }));
  }
}

export function registerNotes(on: On): void {

  on("ui.render", { component: "Pane", requestId: NOTES_PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e);
    const v = await read($, notesView);
    const sync = (await readClient($))?.sync ?? null;
    // A dot marks notes changed here and not uploaded yet (only once sync is set up).
    const tracking = sync !== null && (sync.state === "idle" || sync.state === "offline" || sync.state === "syncing");
    const waiting = new Set(tracking ? sync.pendingKeys : []);
    const selected = v.list.find((n) => n.id === v.selectedId);
    const rows = Math.max(4, Math.min(20, (e.viewport?.rows ?? 24) - 12));

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Button key="ccb-note-new" label="New note" onPress={() => newNote($)} />
          {v.list.map((n) => (
            <Button
              key={`ccb-note-${n.id}`}
              label={`${waiting.has(`notes/${n.id}`) ? "• " : ""}${n.pinned ? "* " : ""}${n.title}${n.conflictOf && !n.title.endsWith(" (conflict)") ? " (conflict)" : ""}`}
              {...(n.id === v.selectedId ? { variant: "primary" as const } : {})}
              onPress={() => select($, n.id)}
            />
          ))}
        </Box>
        {v.notice ? <Text>{v.notice}</Text> : null}
        {selected?.conflictOf ? (
          <Box flexDirection="row" gap={1}>
            <Text>This copy was made because the note was changed on two computers at once.</Text>
            <Button key="ccb-note-keep-copy" label="Keep this" onPress={() => settle($, "copy")} />
            <Button key="ccb-note-keep-original" label="Keep other" onPress={() => settle($, "original")} />
            <Button key="ccb-note-keep-both" label="Keep both" onPress={() => settle($, "both")} />
          </Box>
        ) : null}
        {tracking ? <Text dimColor>{sync.line}{waiting.size ? " · • not uploaded yet" : ""}</Text> : null}
        {v.theirs !== null ? (
          <Box flexDirection="column">
            <Text>This note was changed elsewhere while you had unsaved edits.</Text>
            <Box flexDirection="row" gap={1}>
              <Button
                key="ccb-note-keep-mine"
                label="Keep mine"
                variant="primary"
                onPress={() => setView($, (cur) => ({ ...cur, base: cur.theirs ?? cur.base, theirs: null, dirty: true })).then(() => saveNote($))}
              />
              <Button
                key="ccb-note-load-theirs"
                label="Load theirs"
                onPress={() => setView($, (cur) => ({ ...cur, draft: cur.theirs ?? cur.draft, base: cur.theirs ?? cur.base, theirs: null, dirty: false }))}
              />
            </Box>
          </Box>
        ) : null}
        {v.renaming !== null ? (
          <Input
            key="ccb-note-title"
            label="Title"
            value={v.renaming}
            onInput={(t: string) => setView($, (cur) => ({ ...cur, renaming: t }))}
            onSubmit={(t: string) => rename($, t)}
          />
        ) : (
          <Text bold>{v.selectedId === null ? "New note" : v.title}</Text>
        )}
        <Input
          key="ccb-note-body"
          rows={rows}
          value={v.draft}
          placeholder="Type a note. It saves on its own; Enter saves now."
          submitLabel="save"
          onInput={(t: string) => edit($, t)}
          onSubmit={(t: string) => edit($, t).then(() => saveNote($))}
        />
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{v.dirty ? "Unsaved" : v.selectedId ? "Saved" : ""}</Text>
          <Button key="ccb-note-save" label="Save" onPress={() => saveNote($)} />
          {selected ? (
            <Box flexDirection="row" gap={1}>
              <Button key="ccb-note-rename" label="Rename" onPress={() => setView($, (cur) => ({ ...cur, renaming: cur.title }))} />
              <Button key="ccb-note-pin" label={selected.pinned ? "Unpin" : "Pin"} onPress={() => togglePin($)} />
              <Button
                key="ccb-note-copy"
                label="Copy"
                onPress={(press: { surface?: "terminal" | "desktop" | "vscode" | "mobile" }) => void $.ui.copy({ text: v.draft, ...(press.surface ? { surface: press.surface } : {}) })}
              />
              <Button key="ccb-note-insert" label="Insert into prompt" onPress={() => $.prompt.fill({ text: v.draft, mode: "insert" })} />
              {v.confirmDelete ? (
                <Box flexDirection="row" gap={1}>
                  <Button key="ccb-note-del-confirm" label="Confirm delete" variant="primary" onPress={() => remove($)} />
                  <Button key="ccb-note-del-keep" label="Keep" onPress={() => setView($, (cur) => ({ ...cur, confirmDelete: false }))} />
                </Box>
              ) : (
                <Button key="ccb-note-del" label="Delete" onPress={() => setView($, (cur) => ({ ...cur, confirmDelete: true }))} />
              )}
            </Box>
          ) : null}
        </Box>
      </Box>
    );
  });
}
