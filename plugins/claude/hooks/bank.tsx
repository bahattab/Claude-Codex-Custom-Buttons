// The Prompt Bank pane: search and use saved prompts, edit them, and manage variables and
// custom buttons. All data goes through ccb-mcp. This file owns its $.state atoms.
import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { BankData, BankView, ButtonDraft, ButtonView, PromptDraft, PromptSummary } from "../types";
import { dateBuiltIns, slugify } from "./core/index.js";
import { refreshClient } from "./client.js";
import { builtIns, callTool, errorText } from "./mcp.js";

type $ = EngineInterface;

export const BANK_PANE = "ccb-bank";
const SEARCH_DELAY_MS = 150;

const EMPTY_VIEW: BankView = {
  tab: "prompts",
  query: "",
  category: null,
  favoritesOnly: false,
  editing: null,
  confirmDelete: null,
  lastDeleted: null,
  variableDraft: { name: "", value: "" },
  buttonDraft: null,
  notice: null,
};
const EMPTY_DATA: BankData = { results: [], categories: [], variables: {}, buttons: [], counts: null };

const bankView = atom({ plugin: "prompt-buttons", key: "bankView" } as const, EMPTY_VIEW);
const bankData = atom({ plugin: "prompt-buttons", key: "bankData" } as const, EMPTY_DATA);

let searchToken = 0;

async function setView($: $, change: (v: BankView) => BankView): Promise<void> {
  await update($, bankView, (v) => change(v ?? EMPTY_VIEW));
}

async function notice($: $, text: string | null): Promise<void> {
  await setView($, (v) => ({ ...v, notice: text }));
}

// --- loading --------------------------------------------------------------------------

async function loadPrompts($: $): Promise<void> {
  const view = await read($, bankView);
  const { results } = await callTool<{ results: PromptSummary[] }>($, "bank_search", {
    query: view.query,
    ...(view.category !== null ? { category: view.category } : {}),
    ...(view.favoritesOnly ? { favoritesOnly: true } : {}),
    limit: 50,
  });
  await update($, bankData, (d) => ({ ...d, results }));
}

/** Reloads everything the pane shows. Errors become a notice, not a crash. */
export async function refreshBank($: $): Promise<void> {
  try {
    const [status, cats, vars, buttons] = await Promise.all([
      callTool<{ counts: BankData["counts"] }>($, "library_status"),
      callTool<{ categories: BankData["categories"] }>($, "bank_list_categories"),
      callTool<{ variables: Record<string, string> }>($, "variables_list"),
      callTool<{ buttons: ButtonView[] }>($, "buttons_list"),
    ]);
    await update($, bankData, (d) => ({
      ...d,
      counts: status.counts,
      categories: cats.categories,
      variables: vars.variables,
      buttons: buttons.buttons,
    }));
    await loadPrompts($);
  } catch (error) {
    await notice($, `Couldn't load the Prompt Bank: ${errorText(error)}`);
  }
}

/** Opens the Prompt Bank pane, optionally searching or filtering. */
export async function openBank($: $, opts: { search?: string; category?: string | null } = {}): Promise<void> {
  const searching = opts.search !== undefined || opts.category !== undefined;
  await setView($, (v) => ({
    ...v,
    tab: "prompts",
    ...(opts.search !== undefined ? { query: opts.search } : {}),
    ...(opts.category !== undefined ? { category: opts.category } : {}),
    // The edit form hides the results; say so rather than dropping the edit.
    notice: searching && v.editing ? "Save or cancel the prompt you're editing to see the search results." : null,
  }));
  await $.ui.open({ id: BANK_PANE, title: "Prompt Bank", focus: true });
  await refreshBank($);
}

// --- prompt actions -------------------------------------------------------------------

interface Expanded {
  text: string;
  unanswered: string[];
}

/** Puts a saved prompt in the prompt box (insert) or sends it (send), with variables filled in. */
export async function usePrompt($: $, id: string, how: "insert" | "send"): Promise<void> {
  try {
    const values = await builtIns($, dateBuiltIns(new Date()));
    const { expanded } = await callTool<{ expanded: Expanded }>($, "bank_get", { id, expand: true, builtIns: values, markUsed: true });
    if (how === "send" && expanded.unanswered.length === 0) {
      await $.prompt.submit({ text: expanded.text });
      return;
    }
    await $.prompt.fill({ text: expanded.text, mode: how === "send" ? "replace" : "insert" });
    if (expanded.unanswered.length > 0) {
      $.ui.toast(`Fill in ${expanded.unanswered.map((n) => `{{?${n}}}`).join(", ")}, then send.`);
    }
  } catch (error) {
    $.ui.toast(`Couldn't use that prompt: ${errorText(error)}`);
  }
}

interface FullPrompt {
  id: string;
  title: string;
  body: string;
  category: string | null;
  tags: string[];
  favorite: boolean;
}

async function getPrompt($: $, id: string): Promise<FullPrompt> {
  const { prompt } = await callTool<{ prompt: FullPrompt }>($, "bank_get", { id });
  return prompt;
}

async function startEdit($: $, id: string | null, preset?: Partial<PromptDraft>): Promise<void> {
  try {
    const base: PromptDraft =
      id === null
        ? { id: null, title: "", body: "", tags: "", category: null, favorite: false }
        : await getPrompt($, id).then((p) => ({ id: p.id, title: p.title, body: p.body, tags: p.tags.join(", "), category: p.category, favorite: p.favorite }));
    await setView($, (v) => ({ ...v, tab: "prompts", editing: { ...base, ...preset }, notice: null }));
  } catch (error) {
    await notice($, `Couldn't open that prompt: ${errorText(error)}`);
  }
}

async function saveEdit($: $): Promise<void> {
  const { editing } = await read($, bankView);
  if (!editing) return;
  try {
    const tags = editing.tags.split(",").map((t) => t.trim()).filter(Boolean);
    await callTool($, "bank_save", {
      ...(editing.id !== null ? { id: editing.id } : {}),
      title: editing.title,
      body: editing.body,
      category: editing.category,
      tags,
      favorite: editing.favorite,
    });
    await setView($, (v) => ({ ...v, editing: null, notice: `Saved "${editing.title.trim()}".` }));
    await loadPrompts($);
    await refreshClient($); // the button row shows buttons and variables
  } catch (error) {
    // Keep the draft so nothing typed is lost.
    await notice($, `Not saved: ${errorText(error)}`);
  }
}

async function duplicate($: $, id: string): Promise<void> {
  try {
    const p = await getPrompt($, id);
    await callTool($, "bank_save", { title: `${p.title} (copy)`.slice(0, 120), body: p.body, category: p.category, tags: p.tags });
    await notice($, `Duplicated "${p.title}".`);
    await loadPrompts($);
  } catch (error) {
    await notice($, `Couldn't duplicate: ${errorText(error)}`);
  }
}

async function remove($: $, id: string): Promise<void> {
  try {
    const p = await getPrompt($, id);
    await callTool($, "bank_delete", { id });
    await setView($, (v) => ({ ...v, confirmDelete: null, lastDeleted: p, notice: `Deleted "${p.title}".` }));
    await loadPrompts($);
    await refreshClient($); // the button row shows buttons and variables
  } catch (error) {
    await notice($, `Couldn't delete: ${errorText(error)}`);
  }
}

async function undoDelete($: $): Promise<void> {
  const { lastDeleted } = await read($, bankView);
  if (!lastDeleted) return;
  try {
    // Saving a deleted prompt again under its ID restores it everywhere.
    await callTool($, "bank_save", { ...lastDeleted });
    await setView($, (v) => ({ ...v, lastDeleted: null, notice: `Restored "${lastDeleted.title}".` }));
    await loadPrompts($);
    await refreshClient($); // the button row shows buttons and variables
  } catch (error) {
    await notice($, `Couldn't restore: ${errorText(error)}`);
  }
}

/** Saves the prompt box text as a new prompt: directly with a title, else via the edit form. */
export async function saveDraftAsPrompt($: $, title?: string): Promise<string> {
  const draft = (await $.prompt.read()).text;
  if (draft.trim() === "") return "The prompt box is empty: type the prompt first.";
  if (!(title && title.trim()) && (await read($, bankView)).editing) {
    await openBank($);
    return "Save or cancel the prompt you're editing first.";
  }
  if (title && title.trim()) {
    try {
      await callTool($, "bank_save", { title: title.trim(), body: draft });
      return `Saved "${title.trim()}" to the Prompt Bank.`;
    } catch (error) {
      return `Not saved: ${errorText(error)}`;
    }
  }
  await openBank($);
  const firstLine = draft.split("\n").find((l) => l.trim() !== "") ?? "";
  await startEdit($, null, { title: firstLine.trim().slice(0, 60), body: draft });
  return "";
}

// --- variables and buttons ------------------------------------------------------------

async function setVariable($: $, name: string, value: string): Promise<void> {
  try {
    const { saved } = await callTool<{ saved: { name: string } }>($, "variables_set", { name, value });
    await setView($, (v) => ({ ...v, variableDraft: { name: "", value: "" }, notice: `Saved {{${saved.name}}}.` }));
    await refreshBank($);
    await refreshClient($); // the button row shows buttons and variables
  } catch (error) {
    await notice($, `Not saved: ${errorText(error)}`);
  }
}

async function deleteVariable($: $, name: string): Promise<void> {
  try {
    await callTool($, "variables_delete", { name });
    await refreshBank($);
    await refreshClient($); // the button row shows buttons and variables
  } catch (error) {
    await notice($, `Couldn't delete: ${errorText(error)}`);
  }
}

const NEW_BUTTON: ButtonDraft = { id: "", label: "", icon: "", type: "submit", promptId: "", text: "", mode: "replace", category: "" };

/** The ccb-mcp action for a button draft. */
export function draftAction(d: ButtonDraft): Record<string, unknown> {
  switch (d.type) {
    case "submit":
      return d.promptId ? { type: "submit", promptId: d.promptId } : { type: "submit", text: d.text };
    case "fill":
      return d.promptId ? { type: "fill", promptId: d.promptId, mode: d.mode } : { type: "fill", text: d.text, mode: d.mode };
    case "open-notes":
      return { type: "open-pane", pane: "notes" };
    case "open-prompt-bank":
      return { type: "open-pane", pane: "prompt-bank" };
    case "insert-prompt":
      return { type: "insert-prompt", category: d.category || null, search: d.text.trim() || null };
    default:
      return { type: d.type };
  }
}

/**
 * A new button's ID, from the typed ID or else the label, made unique among `taken`
 * (saving under an existing ID would replace that button). Labels with no Latin
 * letters or digits, such as Arabic or an emoji, become btn_button, btn_button_2, ...
 */
export function buttonId(d: ButtonDraft, taken: readonly string[]): string {
  const raw = (d.id.trim() || d.label).toLowerCase();
  const slugged = slugify(raw.replace(/^btn_/, ""));
  const slug = (slugged === "untitled" ? "button" : slugged).replace(/-/g, "_").slice(0, 56);
  let id = `btn_${slug}`;
  for (let n = 2; taken.includes(id); n++) id = `btn_${slug}_${n}`;
  return id;
}

async function saveButton($: $): Promise<void> {
  const { buttonDraft } = await read($, bankView);
  if (!buttonDraft) return;
  try {
    const { buttons } = await callTool<{ buttons: ButtonView[] }>($, "buttons_list");
    await callTool($, "buttons_save", {
      id: buttonId(buttonDraft, buttons.map((b) => b.id)),
      label: buttonDraft.label,
      icon: buttonDraft.icon.trim() || null,
      action: draftAction(buttonDraft),
    });
    await setView($, (v) => ({ ...v, buttonDraft: null, notice: `Saved button "${buttonDraft.label}".` }));
    await refreshBank($);
    await refreshClient($); // the button row shows buttons and variables
  } catch (error) {
    await notice($, `Button not saved: ${errorText(error)}`);
  }
}

async function deleteButton($: $, id: string): Promise<void> {
  try {
    await callTool($, "buttons_delete", { id });
    await refreshBank($);
    await refreshClient($); // the button row shows buttons and variables
  } catch (error) {
    await notice($, `Couldn't delete: ${errorText(error)}`);
  }
}

function describeAction(b: ButtonView): string {
  const a = b.action;
  if (a.type === "submit" || a.type === "fill") return "promptId" in a ? `${a.type} a saved prompt` : `${a.type} text`;
  if (a.type === "open-pane") return `open ${a.pane}`;
  return a.type;
}

// --- drawing --------------------------------------------------------------------------

export function registerBank(on: On): void {

  on("ui.render", { component: "Pane", requestId: BANK_PANE }, async ($, e) => {
    const { Box, Button, Input, Select, Text } = $.ui.resolve(e);
    const view = await read($, bankView);
    const data = await read($, bankData);
    const tabButton = (tab: BankView["tab"], label: string) => (
      <Button key={`ccb-tab-${tab}`} label={label} {...(view.tab === tab ? { variant: "primary" as const } : {})} onPress={() => setView($, (v) => ({ ...v, tab, notice: null }))} />
    );
    const counts = data.counts;

    let body;
    if (view.tab === "prompts" && view.editing) {
      const d = view.editing;
      const edit = (change: Partial<PromptDraft>) => setView($, (v) => (v.editing ? { ...v, editing: { ...v.editing, ...change } } : v));
      body = (
        <Box flexDirection="column" gap={1}>
          <Text bold>{d.id === null ? "New prompt" : "Edit prompt"}</Text>
          <Input key="ccb-edit-title" label="Title" value={d.title} onInput={(t: string) => edit({ title: t })} onSubmit={() => saveEdit($)} />
          <Input key="ccb-edit-body" label="Prompt" rows={6} value={d.body} placeholder="Use {{name}} for variables and {{?name}} to ask each time" onInput={(t: string) => edit({ body: t })} onSubmit={(t: string) => edit({ body: t }).then(() => saveEdit($))} />
          <Input key="ccb-edit-tags" label="Tags" value={d.tags} placeholder="comma, separated" onInput={(t: string) => edit({ tags: t })} onSubmit={() => saveEdit($)} />
          <Select
            key="ccb-edit-category"
            label="Category"
            value={d.category ?? ""}
            options={[{ label: "No category", value: "" }, ...data.categories.map((c) => ({ label: c.name, value: c.id }))]}
            onSelect={(value: string) => void edit({ category: value === "" ? null : value })}
          />
          <Box flexDirection="row" gap={1}>
            <Button key="ccb-edit-favorite" label={d.favorite ? "Favourite: yes" : "Favourite: no"} onPress={() => edit({ favorite: !d.favorite })} />
            <Button key="ccb-edit-save" label="Save" variant="primary" onPress={() => saveEdit($)} />
            <Button key="ccb-edit-cancel" label="Cancel" onPress={() => setView($, (v) => ({ ...v, editing: null, notice: null }))} />
          </Box>
        </Box>
      );
    } else if (view.tab === "prompts") {
      body = (
        <Box flexDirection="column" gap={1}>
          <Input
            key="ccb-search"
            placeholder="Search prompts"
            value={view.query}
            onInput={(t: string) => {
              const token = ++searchToken;
              void setView($, (v) => ({ ...v, query: t }));
              $.clock.after(SEARCH_DELAY_MS, () => (token === searchToken ? loadPrompts($) : undefined));
            }}
            onSubmit={(t: string) => setView($, (v) => ({ ...v, query: t })).then(() => loadPrompts($))}
          />
          <Box flexDirection="row" gap={1}>
            <Select
              key="ccb-category"
              label="Category"
              value={view.category ?? ""}
              options={[{ label: "All categories", value: "" }, ...data.categories.map((c) => ({ label: `${c.name} (${c.prompts})`, value: c.id }))]}
              onSelect={(value: string) => void setView($, (v) => ({ ...v, category: value === "" ? null : value })).then(() => loadPrompts($))}
            />
            <Button
              key="ccb-favorites"
              label={view.favoritesOnly ? "Favourites only" : "All prompts"}
              onPress={() => setView($, (v) => ({ ...v, favoritesOnly: !v.favoritesOnly })).then(() => loadPrompts($))}
            />
            <Button key="ccb-new" label="New" onPress={() => startEdit($, null)} />
            <Button key="ccb-save-draft" label="Save draft" onPress={() => saveDraftAsPrompt($).then((msg) => (msg ? notice($, msg) : undefined))} />
            {view.lastDeleted ? <Button key="ccb-undo-delete" label="Undo delete" onPress={() => undoDelete($)} /> : null}
          </Box>
          {data.results.length === 0 ? <Text dimColor>{view.query || view.category || view.favoritesOnly ? "No prompts match." : "No prompts yet. Press New to add one."}</Text> : null}
          {data.results.map((p) => (
            <Box key={`ccb-row-${p.id}`} flexDirection="column">
              <Text>
                {p.favorite ? "* " : ""}
                {p.title}
                {p.conflictOf ? "  (conflict copy)" : ""}
              </Text>
              <Text dimColor>{p.preview}</Text>
              <Box flexDirection="row" gap={1}>
                <Button key={`ccb-insert-${p.id}`} label="Insert" onPress={() => usePrompt($, p.id, "insert")} />
                <Button key={`ccb-send-${p.id}`} label="Send" onPress={() => usePrompt($, p.id, "send")} />
                <Button
                  key={`ccb-copy-${p.id}`}
                  label="Copy"
                  onPress={(press: { surface?: "terminal" | "desktop" | "vscode" | "mobile" }) =>
                    void getPrompt($, p.id).then((full) => $.ui.copy({ text: full.body, ...(press.surface ? { surface: press.surface } : {}) }))
                  }
                />
                <Button key={`ccb-edit-${p.id}`} label="Edit" onPress={() => startEdit($, p.id)} />
                <Button key={`ccb-dup-${p.id}`} label="Duplicate" onPress={() => duplicate($, p.id)} />
                {view.confirmDelete === p.id ? (
                  <Box flexDirection="row" gap={1}>
                    <Button key={`ccb-del-confirm-${p.id}`} label="Confirm delete" variant="primary" onPress={() => remove($, p.id)} />
                    <Button key={`ccb-del-keep-${p.id}`} label="Keep" onPress={() => setView($, (v) => ({ ...v, confirmDelete: null }))} />
                  </Box>
                ) : (
                  <Button key={`ccb-del-${p.id}`} label="Delete" onPress={() => setView($, (v) => ({ ...v, confirmDelete: p.id }))} />
                )}
              </Box>
            </Box>
          ))}
        </Box>
      );
    } else if (view.tab === "variables") {
      const names = Object.keys(data.variables).sort();
      body = (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>Use these in any prompt as {"{{name}}"}. Press Enter in a field to save it.</Text>
          {names.map((name) => (
            <Box key={`ccb-varrow-${name}`} flexDirection="row" gap={1}>
              <Input key={`ccb-var-${name}`} label={name} value={data.variables[name] ?? ""} onSubmit={(value: string) => setVariable($, name, value)} />
              <Button key={`ccb-var-del-${name}`} label="Delete" onPress={() => deleteVariable($, name)} />
            </Box>
          ))}
          <Box flexDirection="row" gap={1}>
            <Input key="ccb-newvar-name" label="New" placeholder="name" value={view.variableDraft.name} onInput={(t: string) => setView($, (v) => ({ ...v, variableDraft: { ...v.variableDraft, name: t } }))} onSubmit={() => undefined} />
            <Input
              key="ccb-newvar-value"
              placeholder="value"
              value={view.variableDraft.value}
              onInput={(t: string) => setView($, (v) => ({ ...v, variableDraft: { ...v.variableDraft, value: t } }))}
              onSubmit={(t: string) => (view.variableDraft.name.trim() ? setVariable($, view.variableDraft.name, t) : notice($, "Type a name first."))}
            />
            <Button
              key="ccb-newvar-add"
              label="Add"
              onPress={() => (view.variableDraft.name.trim() ? setVariable($, view.variableDraft.name, view.variableDraft.value) : notice($, "Type a name first."))}
            />
          </Box>
        </Box>
      );
    } else {
      const d = view.buttonDraft;
      const editB = (change: Partial<ButtonDraft>) => setView($, (v) => (v.buttonDraft ? { ...v, buttonDraft: { ...v.buttonDraft, ...change } } : v));
      body = (
        <Box flexDirection="column" gap={1}>
          {data.buttons.length === 0 ? <Text dimColor>No custom buttons yet.</Text> : null}
          {data.buttons.map((b) => (
            <Box key={`ccb-brow-${b.id}`} flexDirection="row" gap={1}>
              <Text>
                {b.icon ? `${b.icon} ` : ""}
                {b.label}
              </Text>
              <Text dimColor>
                {b.id}: {describeAction(b)}
                {b.targetMissing ? " (its prompt was deleted)" : ""}
              </Text>
              <Button key={`ccb-bdel-${b.id}`} label="Delete" onPress={() => deleteButton($, b.id)} />
            </Box>
          ))}
          {d === null ? (
            <Button key="ccb-new-button" label="New button" onPress={() => setView($, (v) => ({ ...v, buttonDraft: { ...NEW_BUTTON } }))} />
          ) : (
            <Box flexDirection="column" gap={1}>
              <Input key="ccb-b-label" label="Label" value={d.label} onInput={(t: string) => editB({ label: t })} onSubmit={() => saveButton($)} />
              <Input key="ccb-b-icon" label="Icon" placeholder="one emoji (optional)" value={d.icon} onInput={(t: string) => editB({ icon: t })} onSubmit={() => saveButton($)} />
              <Select
                key="ccb-b-type"
                label="Does"
                value={d.type}
                options={[
                  { label: "Send a prompt", value: "submit" },
                  { label: "Put a prompt in the box", value: "fill" },
                  { label: "Continue", value: "continue" },
                  { label: "Regenerate", value: "refine" },
                  { label: "Open Notes", value: "open-notes" },
                  { label: "Open the Prompt Bank", value: "open-prompt-bank" },
                  { label: "Search the Prompt Bank", value: "insert-prompt" },
                ]}
                onSelect={(value: string) => void editB({ type: value as ButtonDraft["type"] })}
              />
              {d.type === "submit" || d.type === "fill" ? (
                <Select
                  key="ccb-b-prompt"
                  label="Prompt"
                  value={d.promptId}
                  options={[{ label: "Use the text below", value: "" }, ...data.results.map((p) => ({ label: p.title, value: p.id }))]}
                  onSelect={(value: string) => void editB({ promptId: value })}
                />
              ) : null}
              {(d.type === "submit" || d.type === "fill") && d.promptId === "" ? (
                <Input key="ccb-b-text" label="Text" rows={3} value={d.text} onInput={(t: string) => editB({ text: t })} onSubmit={() => saveButton($)} />
              ) : null}
              {d.type === "insert-prompt" ? (
                <Box flexDirection="column" gap={1}>
                  <Input key="ccb-b-text" label="Search for" value={d.text} onInput={(t: string) => editB({ text: t })} onSubmit={() => saveButton($)} />
                  <Select
                    key="ccb-b-category"
                    label="Category"
                    value={d.category}
                    options={[{ label: "All categories", value: "" }, ...data.categories.map((c) => ({ label: c.name, value: c.id }))]}
                    onSelect={(value: string) => void editB({ category: value })}
                  />
                </Box>
              ) : null}
              {d.type === "fill" ? (
                <Select
                  key="ccb-b-mode"
                  label="Mode"
                  value={d.mode}
                  options={[
                    { label: "Replace the box", value: "replace" },
                    { label: "Add to the end", value: "append" },
                    { label: "Insert at the cursor", value: "insert" },
                  ]}
                  onSelect={(value: string) => void editB({ mode: value as ButtonDraft["mode"] })}
                />
              ) : null}
              <Box flexDirection="row" gap={1}>
                <Button key="ccb-b-save" label="Save button" variant="primary" onPress={() => saveButton($)} />
                <Button key="ccb-b-cancel" label="Cancel" onPress={() => setView($, (v) => ({ ...v, buttonDraft: null }))} />
              </Box>
            </Box>
          )}
        </Box>
      );
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          {tabButton("prompts", "Prompts")}
          {tabButton("variables", "Variables")}
          {tabButton("buttons", "Buttons")}
          {counts ? (
            <Text dimColor>
              {counts.prompts} prompts, {counts.favorites} favourites, {counts.notes} notes
              {counts.conflicts ? `, ${counts.conflicts} conflicts` : ""}
            </Text>
          ) : null}
        </Box>
        {view.notice ? <Text>{view.notice}</Text> : null}
        {body}
      </Box>
    );
  });
}
