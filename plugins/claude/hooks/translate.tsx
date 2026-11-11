// Translate: instant translation of selected text (a bubble above the prompt box), a
// Translate pane with a language picker, Swap, Copy, Insert and history, and /tr. The
// model is the one the session already uses; nothing is sent anywhere else.
// This file owns its $.state atoms.
import { atom, read, update } from "claude-code";
import type { EngineInterface, On, RenderChildren, RenderInput } from "claude-code";

import type { BubbleView, TranslateSettings, TranslateView, TranslationView } from "../types";
import { TRANSLATE_LANGUAGES, buildTranslateRequest, parseTranslation, worthTranslating } from "./core/index.js";
import { readClient } from "./client.js";
import { errorText, lastUserMessage } from "./mcp.js";

type $ = EngineInterface;

export const TRANSLATE_PANE = "ccb-translate";
/** How often the selection is checked for instant translation. */
export const SELECTION_POLL_MS = 700;
const MAX_TOKENS = 4000;
/** The bubble is for short selections: a smaller answer limit keeps instant translation cheap. */
const BUBBLE_MAX_TOKENS = 1500;
/** Instant translation handles selections up to this long; longer ones go through the pane. */
const BUBBLE_MAX_CHARS = 2000;
const HISTORY = 20;

const DEFAULTS: TranslateSettings = { target: "auto", primary: "English", secondary: "Arabic", instant: true };
const EMPTY: TranslateView = { source: "", target: "auto", result: null, busy: false, error: null, history: [] };

const translateView = atom({ plugin: "prompt-buttons", key: "translateView" } as const, EMPTY);
const bubble = atom({ plugin: "prompt-buttons", key: "bubble" } as const, null);

async function settings($: $): Promise<TranslateSettings> {
  return (await readClient($))?.settings.translate ?? DEFAULTS;
}

async function setView($: $, change: (v: TranslateView) => TranslateView): Promise<void> {
  await update($, translateView, (v) => change(v ?? EMPTY));
}

// Recent results, so selecting the same text again costs nothing.
const cache = new Map<string, TranslationView>();

/** Translates with the session's model. Throws with a reason when there's no answer. */
export async function translateText($: $, text: string, target?: string, maxTokens = MAX_TOKENS): Promise<TranslationView> {
  const s = await settings($);
  const into = target && target.trim() ? target.trim() : s.target;
  const key = `${into}\n${s.primary}\n${s.secondary}\n${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const request = buildTranslateRequest(text, { ...s, target: into });
  const result = await $.model.complete({ model: await $.session.model(), system: request.system, prompt: request.user, maxTokens });
  if (!("text" in result) || typeof result.text !== "string" || result.text.trim() === "") {
    throw new Error("reason" in result ? String((result as { reason?: unknown }).reason) : "no reply");
  }
  const parsed = parseTranslation(result.text);
  if (parsed.text.trim() === "") throw new Error("the model sent an empty translation");
  const view: TranslationView = { source: text, text: parsed.text, from: parsed.from, to: parsed.to };
  cache.set(key, view);
  if (cache.size > 50) cache.delete(cache.keys().next().value as string);
  return view;
}

// --- the pane --------------------------------------------------------------------------

/** Translates the pane's source text into the pane's target, and records it in the history. */
async function translatePane($: $): Promise<void> {
  const v = await read($, translateView);
  if (v.source.trim() === "" || v.busy) return; // one request at a time
  await setView($, (cur) => ({ ...cur, busy: true, error: null }));
  try {
    const result = await translateText($, v.source, v.target);
    await setView($, (cur) => ({
      ...cur,
      busy: false,
      result,
      history: [result, ...cur.history.filter((h) => h.source !== result.source || h.to !== result.to)].slice(0, HISTORY),
    }));
  } catch (error) {
    await setView($, (cur) => ({ ...cur, busy: false, error: `Couldn't translate: ${errorText(error)}` }));
  }
}

/** The text to translate when none is given: the selection, else the draft, else the last message. */
async function defaultSource($: $): Promise<string> {
  const selection = (await $.ui.selection())?.text ?? "";
  if (selection.trim()) return selection;
  const draft = (await $.prompt.read()).text;
  if (draft.trim()) return draft;
  return lastUserMessage($);
}

/** Opens the Translate pane and translates `text` (or the selection, draft or last message). */
export async function openTranslate($: $, opts: { text?: string; target?: string } = {}): Promise<void> {
  const source = opts.text && opts.text.trim() ? opts.text : await defaultSource($);
  const s = await settings($);
  await setView($, (v) => ({ ...v, source, target: opts.target ?? (v.target === "auto" ? s.target : v.target), error: null, result: null }));
  await $.ui.open({ id: TRANSLATE_PANE, title: "Translate", focus: true });
  if (source.trim()) await translatePane($);
}

/** /tr [to <language>:] [text]: returns a message for the command, or "". */
export async function translateCommand($: $, args: string): Promise<string> {
  const m = /^to\s+([^:]+?)\s*(?::\s*([\s\S]*))?$/i.exec(args.trim());
  const target = m?.[1]?.trim();
  const text = m ? (m[2] ?? "") : args;
  if (!(text.trim() || (await defaultSource($)).trim())) return "Nothing to translate: select some text, type a draft, or write /tr <text>.";
  await openTranslate($, { text, ...(target ? { target } : {}) });
  return "";
}

/** Swap: translate the result back, from the language it's now in into the one it came from. */
async function swap($: $): Promise<void> {
  const v = await read($, translateView);
  if (!v.result?.from) return; // the source language is unknown: nothing to swap back to
  const back = v.result.from;
  await setView($, (cur) => ({ ...cur, source: v.result?.text ?? cur.source, target: back, result: null }));
  await translatePane($);
}

// --- instant translation of the selection -------------------------------------------------

let polling: unknown = null;
let lastSeen = "";
let lastDone = "";

/** Starts watching the selection (called at session start). Safe to call again. */
export function startInstant($: $): void {
  if (polling) return;
  polling = $.clock.every(SELECTION_POLL_MS, () => {
    checkSelection($).catch(() => undefined); // a failed check just waits for the next one
  });
}

/**
 * A selection that stays the same for one poll interval (so a drag in progress isn't
 * translated) is translated and shown in the bubble, when translate.instant is on.
 */
async function checkSelection($: $): Promise<void> {
  const s = await settings($);
  if (!s.instant) return;
  const text = ((await $.ui.selection())?.text ?? "").trim();
  const previous = lastSeen;
  lastSeen = text;
  if (text === "") lastDone = ""; // after the selection is cleared, the same text may be shown again
  if (!text || text !== previous || text === lastDone || !worthTranslating(text) || text.length > BUBBLE_MAX_CHARS) return;
  if (await isOwnText($, text)) return; // selecting a translation (to copy it) isn't a new request
  lastDone = text;
  await update($, bubble, (): BubbleView => ({ state: "translating", source: text, result: null, error: null }));
  try {
    const result = await translateText($, text, undefined, BUBBLE_MAX_TOKENS);
    await update($, bubble, (b): BubbleView => (b?.source === text ? { state: "done", source: text, result, error: null } : b));
  } catch (error) {
    await update($, bubble, (b): BubbleView => (b?.source === text ? { state: "failed", source: text, result: null, error: errorText(error) } : b));
  }
}

/** True when the text is a translation already shown, or the pane's own text. */
async function isOwnText($: $, text: string): Promise<boolean> {
  for (const hit of cache.values()) if (hit.text.trim() === text) return true;
  const v = await read($, translateView);
  const b = (await read($, bubble)) as BubbleView;
  return [v.source, v.result?.text, b?.result?.text].some((t) => t !== undefined && t.trim() === text);
}

async function closeBubble($: $): Promise<void> {
  await update($, bubble, () => null);
}

/** The bubble, for the row above the prompt box to draw; null when there's nothing to show. */
export async function translateBubble($: $, e: RenderInput): Promise<RenderChildren | null> {
  const b = (await read($, bubble)) as BubbleView;
  if (!b) return null;
  const { Box, Button, Text } = $.ui.resolve(e);
  const result = b.result;
  return (
    <Box key="ccb-bubble" flexDirection="column">
      {b.state === "translating" ? <Text dimColor>Translating the selection...</Text> : null}
      {b.state === "failed" ? <Text>{`Couldn't translate: ${b.error ?? ""}`}</Text> : null}
      {result ? (
        <Box flexDirection="column">
          <Text dimColor>{`${result.from ?? "?"} → ${result.to ?? "?"}`}</Text>
          <Text>{result.text}</Text>
        </Box>
      ) : null}
      <Box flexDirection="row" gap={1}>
        {result ? (
          <Button
            key="ccb-bubble-copy"
            label="Copy"
            onPress={(press: { surface?: "terminal" | "desktop" | "vscode" | "mobile" }) => void $.ui.copy({ text: result.text, ...(press.surface ? { surface: press.surface } : {}) })}
          />
        ) : null}
        {result ? <Button key="ccb-bubble-insert" label="Insert" onPress={() => $.prompt.fill({ text: result.text, mode: "insert" })} /> : null}
        <Button key="ccb-bubble-open" label="Open in Translate" onPress={() => openTranslate($, { text: b.source })} />
        <Button key="ccb-bubble-close" label="Close" onPress={() => closeBubble($)} />
      </Box>
    </Box>
  );
}

// --- drawing the pane --------------------------------------------------------------------

export function registerTranslate(on: On): void {
  on("ui.render", { component: "Pane", requestId: TRANSLATE_PANE }, async ($, e) => {
    const { Box, Button, Input, Select, Text } = $.ui.resolve(e);
    const v = await read($, translateView);
    const s = await settings($);
    const languages = [...new Set<string>([...TRANSLATE_LANGUAGES, s.primary, s.secondary, ...(v.target !== "auto" ? [v.target] : [])])].sort();
    const r = v.result;
    const rows = Math.max(3, Math.min(10, Math.floor(((e.viewport?.rows ?? 24) - 14) / 2)));
    return (
      <Box flexDirection="column" gap={1}>
        <Input
          key="ccb-tr-source"
          label="Text"
          rows={rows}
          value={v.source}
          placeholder="Type or paste text; Enter translates"
          submitLabel="translate"
          onInput={(t: string) => setView($, (cur) => ({ ...cur, source: t }))}
          onSubmit={(t: string) => setView($, (cur) => ({ ...cur, source: t })).then(() => translatePane($))}
        />
        <Box flexDirection="row" gap={1}>
          <Select
            key="ccb-tr-target"
            label="Into"
            value={v.target}
            options={[{ label: `Automatic (${s.primary} / ${s.secondary})`, value: "auto" }, ...languages.map((l) => ({ label: l, value: l }))]}
            onSelect={(value: string) => void setView($, (cur) => ({ ...cur, target: value })).then(() => translatePane($))}
          />
          <Button key="ccb-tr-go" label={v.busy ? "Translating..." : "Translate"} variant="primary" onPress={() => translatePane($)} />
          {r?.from ? <Button key="ccb-tr-swap" label="Swap" onPress={() => swap($)} /> : null}
        </Box>
        {v.error ? <Text>{v.error}</Text> : null}
        {r ? (
          <Box flexDirection="column">
            <Text dimColor>{`${r.from ?? "?"} → ${r.to ?? "?"}`}</Text>
            <Text>{r.text}</Text>
            <Box flexDirection="row" gap={1}>
              <Button
                key="ccb-tr-copy"
                label="Copy"
                onPress={(press: { surface?: "terminal" | "desktop" | "vscode" | "mobile" }) => void $.ui.copy({ text: r.text, ...(press.surface ? { surface: press.surface } : {}) })}
              />
              <Button key="ccb-tr-insert" label="Insert into prompt" onPress={() => $.prompt.fill({ text: r.text, mode: "insert" })} />
              <Button key="ccb-tr-replace" label="Replace prompt" onPress={() => $.prompt.fill({ text: r.text, mode: "replace" })} />
            </Box>
          </Box>
        ) : null}
        {v.history.length > 1 ? (
          <Box flexDirection="column">
            <Text dimColor>Recent</Text>
            {v.history.slice(1, 8).map((item, i) => (
              <Button
                key={`ccb-tr-history-${i}`}
                label={`${item.source.slice(0, 40)}${item.source.length > 40 ? "..." : ""} → ${item.to ?? "?"}`}
                onPress={() => setView($, (cur) => ({ ...cur, source: item.source, result: item, error: null }))}
              />
            ))}
          </Box>
        ) : null}
        <Text dimColor>{s.instant ? "Instant: selecting text translates it above the prompt box (translate.instant)." : "Instant translation is off (ccb config set translate.instant true)."}</Text>
      </Box>
    );
  });
}
