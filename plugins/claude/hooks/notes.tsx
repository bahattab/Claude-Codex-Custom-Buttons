// The Notes pane: a scratchpad beside the chat. Notes are synced library records in
// ccb-mcp. Typing saves on its own after a pause; text you haven't saved is never
// replaced by a reload. This file owns its $.state atom.
import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { NoteSummary, NotesView } from "../types";
import { autosaveMs } from "./client.js";
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
  notice: null,
};

const notesView = atom({ plugin: "prompt-buttons", key: "notesView" } as const, EMPTY);

interface FullNote {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
}


async function setView($: $, change: (v: NotesView) => NotesView): Promise<void> {
  await update($, notesView, (v) => change(v ?? EMPTY));
}

async function loadList($: $): Promise<void> {
  const { notes } = await callTool<{ notes: NoteSummary[] }>($, "notes_list");
  await setView($, (v) => ({ ...v, list: notes }));
}

/**
 * Loads the selected note from ccb-mcp (which first picks up edits made to its Markdown
 * file). Unsaved text here is kept: if the note changed elsewhere meanwhile, the newer
 * text is offered as "theirs" instead of replacing it.
 */
async function loadNote($: $, id: string): Promise<void> {
  const { note } = await callTool<{ note: FullNote }>($, "notes_read", { id });
  await setView($, (v) => {
    if (v.selectedId === id && v.dirty) {
      return note.body === v.base || note.body === v.draft ? v : { ...v, theirs: note.body };
    }
    return { ...v, selectedId: id, title: note.title, draft: note.body, base: note.body, dirty: false, theirs: null, confirmDelete: false, renaming: null };
  });
}

/** Reloads the list and the open note. Errors become a notice. */
export async function refreshNotes($: $): Promise<void> {
  try {
    await loadList($);
    const { selectedId, list } = await read($, notesView);
    const id = selectedId ?? list[0]?.id ?? null;
    if (id !== null && list.some((n) => n.id === id)) await loadNote($, id);
  } catch (error) {
    await setView($, (v) => ({ ...v, notice: `Couldn't load notes: ${errorText(error)}` }));
  }
}

/** After a turn: re-check the open note, so a change made elsewhere is noticed. */
export async function refreshOpenNote($: $): Promise<void> {
  const { selectedId } = await read($, notesView);
  if (selectedId === null) return;
  try {
    await loadNote($, selectedId);
  } catch {
    // the pane shows what it has; the next open reloads
  }
}

export async function openNotes($: $): Promise<void> {
  await $.ui.open({ id: NOTES_PANE, title: "Notes", focus: true });
  await refreshNotes($);
}

/** Saves the editor's text now. Creates the note if none is selected. */
export async function saveNote($: $): Promise<void> {
  const v = await read($, notesView);
  if (!v.dirty && v.selectedId !== null) return;
  if (v.selectedId === null && v.draft.trim() === "") return;
  const draft = v.draft;
  try {
    const { saved } = await callTool<{ saved: { id: string; title: string } }>($, "notes_write", {
      ...(v.selectedId !== null ? { id: v.selectedId } : {}),
      body: draft,
    });
    await setView($, (cur) => ({
      ...cur,
      selectedId: saved.id,
      title: saved.title,
      base: draft,
      // Typing that happened while saving stays unsaved.
      dirty: cur.draft !== draft,
      theirs: null,
      notice: null,
    }));
    await loadList($);
  } catch (error) {
    await setView($, (cur) => ({ ...cur, notice: `Not saved: ${errorText(error)}` }));
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
    if (v.saveToken === token && v.dirty) await saveNote($);
  });
}

async function select($: $, id: string): Promise<void> {
  await saveNote($); // never lose the text of the note being left
  await setView($, (v) => ({ ...v, selectedId: id, dirty: false }));
  try {
    await loadNote($, id);
  } catch (error) {
    await setView($, (v) => ({ ...v, notice: `Couldn't open that note: ${errorText(error)}` }));
  }
}

async function newNote($: $): Promise<void> {
  await saveNote($);
  await setView($, (v) => ({ ...v, selectedId: null, title: "", draft: "", base: "", dirty: false, theirs: null, renaming: null, confirmDelete: false }));
}

/** Appends text to the open note, or starts a new note with it. Returns a message. */
export async function appendToNote($: $, text: string): Promise<string> {
  const v = await read($, notesView);
  try {
    if (v.selectedId !== null && !v.dirty) {
      await callTool($, "notes_append", { id: v.selectedId, text });
      await loadNote($, v.selectedId);
      await loadList($);
      return `Added to "${v.title}".`;
    }
    if (v.selectedId !== null && v.dirty) {
      // Keep the unsaved text and add to it.
      await edit($, v.draft.endsWith("\n") || v.draft === "" ? v.draft + text : `${v.draft}\n${text}`);
      await saveNote($);
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
  try {
    await callTool($, "notes_write", { id: v.selectedId, title: title.trim(), body: v.draft });
    await setView($, (cur) => ({ ...cur, title: title.trim(), base: v.draft, dirty: cur.draft !== v.draft, renaming: null }));
    await loadList($);
  } catch (error) {
    await setView($, (cur) => ({ ...cur, notice: `Not renamed: ${errorText(error)}` }));
  }
}

async function togglePin($: $): Promise<void> {
  const v = await read($, notesView);
  const current = v.list.find((n) => n.id === v.selectedId);
  if (!current) return;
  try {
    await callTool($, "notes_write", { id: current.id, body: v.draft, pinned: !current.pinned });
    await setView($, (cur) => ({ ...cur, base: v.draft, dirty: cur.draft !== v.draft }));
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
    await setView($, (cur) => ({ ...EMPTY, list: cur.list, notice: `Deleted "${v.title}".` }));
    await refreshNotes($);
  } catch (error) {
    await setView($, (cur) => ({ ...cur, notice: `Couldn't delete: ${errorText(error)}` }));
  }
}

export function registerNotes(on: On): void {

  on("ui.render", { component: "Pane", requestId: NOTES_PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e);
    const v = await read($, notesView);
    const selected = v.list.find((n) => n.id === v.selectedId);
    const rows = Math.max(4, Math.min(20, (e.viewport?.rows ?? 24) - 12));

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Button key="ccb-note-new" label="New note" onPress={() => newNote($)} />
          {v.list.map((n) => (
            <Button
              key={`ccb-note-${n.id}`}
              label={`${n.pinned ? "* " : ""}${n.title}${n.conflictOf ? " (conflict)" : ""}`}
              {...(n.id === v.selectedId ? { variant: "primary" as const } : {})}
              onPress={() => select($, n.id)}
            />
          ))}
        </Box>
        {v.notice ? <Text>{v.notice}</Text> : null}
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
