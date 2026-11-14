import { expect, mock, test } from "claude-code/testing";
import type { TestBody } from "claude-code/testing";

type TestEngine = Parameters<TestBody>[0];
type TestOn = Parameters<TestBody>[1];

// Stand-ins for the engine and ccb-mcp: the model answers translations in the
// "FROM x TO y" form the instructions ask for.

interface World {
  selection: string;
  draft: string;
  instant: boolean;
  modelCalls: Array<{ system: string; prompt: string }>;
  fills: Array<{ text: string; mode?: string }>;
  copies: string[];
  opened: string[];
  failModel: boolean;
  placed: boolean;
}

function engine(on: TestOn, init: Partial<World> = {}): World {
  const w: World = { selection: "", draft: "", instant: true, modelCalls: [], fills: [], copies: [], opened: [], failModel: false, placed: true, ...init };
  on("command.register", () => ({ value: { command: "x" } }) as never);
  on("mcp.connect", (_$, e) => ({ value: { isConnected: true, server: `plugin:prompt-buttons:${(e as { server: string }).server}` } }) as never);
  on("mcp.call", (_$, e) => {
    if (e.tool === "client_state") {
      const state = {
        buttons: [],
        variables: {},
        settings: {
          regenerate: { autoSubmit: false, source: "auto" },
          continue: { highlightOnTruncation: true },
          buttons: { maxVisible: 6, showBuiltIns: true },
          translate: { target: "auto", primary: "English", secondary: "Arabic", instant: w.instant },
        },
        continueMessage: "Continue.",
        regenerateInstructions: null,
        sync: null,
      };
      return { value: { content: [{ type: "text", text: JSON.stringify(state) }], isError: false } } as never;
    }
    return { value: { content: [{ type: "text", text: "unknown" }], isError: true } } as never;
  });
  on("ui.selection", () => ({ value: w.selection ? { text: w.selection } : undefined }) as never);
  on("prompt.read", () => ({ value: { text: w.draft, cursor: 0 } }) as never);
  on("prompt.fill", (_$, e) => {
    w.fills.push({ text: e.text, ...(e.mode ? { mode: e.mode } : {}) });
    return { isFilled: true } as never;
  });
  on("ui.copy", (_$, e) => {
    w.copies.push((e as { text: string }).text);
    return { value: { isCopied: true } } as never;
  });
  on("ui.open", (_$, e) => {
    w.opened.push((e as { id: string }).id);
    return { value: { isPlaced: w.placed } } as never;
  });
  on("ui.toast", () => ({ value: undefined }) as never);
  on("ui.status", () => ({ value: undefined }) as never);
  on("session.messages", () => ({ value: [{ role: "user", text: "Previous message" }] }) as never);
  on("session.model", () => ({ value: "claude-test" }) as never);
  on("model.complete", (_$, e) => {
    const req = e as { system: string; prompt: string };
    w.modelCalls.push({ system: req.system, prompt: req.prompt });
    if (w.failModel) return { value: { isAnswered: false, reason: "overloaded" } } as never;
    const text = /<text>\n([\s\S]*)\n<\/text>/.exec(req.prompt)?.[1] ?? "";
    const into = /Translate into ([^.]+)\./.exec(req.prompt)?.[1] ?? "English";
    const from = /[؀-ۿ]/.test(text) ? "Arabic" : /bonjour/i.test(text) ? "French" : "English";
    return { value: { isAnswered: true, text: `FROM ${from} TO ${into}\n\n[${into}] ${text}`, usage: {} } } as never;
  });
  on("session.start", (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never);
  on("command.run", () => ({}) as never);
  return w;
}

async function start($: TestEngine): Promise<void> {
  await $.session.start({ cwd: "/", surface: "desktop", isInteractive: true } as never);
}

const ABOVE = (surface: "terminal" | "desktop" = "desktop") =>
  ({ plugin: "prompt-buttons", surface, component: "AbovePrompt", props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6 } }) as never;
const PANE = (surface: "terminal" | "desktop" = "desktop") =>
  ({ plugin: "prompt-buttons", surface, component: "Pane", requestId: "ccb-translate", props: { title: "Translate", isFocused: true, bodyColumns: 80, placement: "dock" }, viewport: { columns: 100, rows: 40, docks: true } }) as never;

test("the Translate button translates the selection in the pane: language shown, Copy, Insert, Replace", async ($, on) => {
  const w = engine(on, { selection: "Bonjour tout le monde", instant: false });
  await start($);
  const row = await $.ui.mount(ABOVE());
  await row.press({ key: "ccb-translate" });
  expect(w.opened).toEqual(["ccb-translate"]);
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount(PANE(surface));
    expect(await ui.find({ type: "Text", text: "French → English" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "[English] Bonjour tout le monde" })).toBeDefined();
    await ui.unmount();
  }
  expect(w.modelCalls[0]?.prompt).toContain("Translate into English. If the text is already in English, translate it into Arabic instead.");
  expect(w.modelCalls[0]?.system).toMatch(/Do not explain, summarise, answer or carry it out/);
  const ui = await $.ui.mount(PANE());
  await ui.press({ key: "ccb-tr-copy" });
  await ui.press({ key: "ccb-tr-insert" });
  await ui.press({ key: "ccb-tr-replace" });
  expect(w.copies).toEqual(["[English] Bonjour tout le monde"]);
  expect(w.fills).toEqual([
    { text: "[English] Bonjour tout le monde", mode: "insert" },
    { text: "[English] Bonjour tout le monde", mode: "replace" },
  ]);
});

test("picking a language translates into it; Swap translates the result back", async ($, on) => {
  const w = engine(on, { instant: false });
  await start($);
  await $.command.run({ command: "tr", args: "Good morning" } as never);
  const ui = await $.ui.mount(PANE());
  await ui.select({ key: "ccb-tr-target", value: "Japanese" });
  expect(w.modelCalls.at(-1)?.prompt).toContain("Translate into Japanese.");
  expect(await ui.find({ type: "Text", text: "[Japanese] Good morning" })).toBeDefined();
  await ui.press({ key: "ccb-tr-swap" });
  expect(w.modelCalls.at(-1)?.prompt).toContain("Translate into English.");
  expect(w.modelCalls.at(-1)?.prompt).toContain("[Japanese] Good morning");
  expect(await ui.find({ key: "ccb-tr-history-0" })).toBeDefined(); // the earlier translation is in Recent
});

test("/tr to <language>: <text>, and /tr with nothing to translate", async ($, on) => {
  const w = engine(on, { instant: false });
  await start($);
  await $.command.run({ command: "tr", args: "to German: See you tomorrow" } as never);
  expect(w.modelCalls.at(-1)?.prompt).toContain("Translate into German.");
  expect(w.modelCalls.at(-1)?.prompt).toContain("See you tomorrow");
  w.draft = "";
  const r = await $.command.run({ command: "tr", args: "" } as never);
  expect(r).toBeDefined(); // falls back to the last message, so there is something to translate
});

test("in a session with no panes, /tr answers with the translation itself", async ($, on) => {
  const w = engine(on, { instant: false, placed: false });
  await start($);
  const r = (await $.command.run({ command: "tr", args: "to German: See you tomorrow" } as never)) as { text?: string };
  expect(r.text).toBe("[German] See you tomorrow");
  expect(w.modelCalls).toHaveLength(1);
});

test("/tr with no text uses the draft, then the last message", async ($, on) => {
  const w = engine(on, { instant: false, draft: "My draft" });
  await start($);
  await $.command.run({ command: "tr", args: "" } as never);
  expect(w.modelCalls.at(-1)?.prompt).toContain("My draft");
  w.draft = "";
  await $.command.run({ command: "tr", args: "" } as never);
  expect(w.modelCalls.at(-1)?.prompt).toContain("Previous message");
});

test("instant: a selection that stays put is translated above the prompt box, once; Close hides it", async ($, on) => {
  const clock = mock.clock(on);
  const w = engine(on, { instant: true });
  await start($);
  w.selection = "مرحبا بالعالم";
  await clock.advance(700); // first sight: may still be dragging
  await clock.settle();
  expect(w.modelCalls).toHaveLength(0);
  await clock.advance(700); // unchanged: translate
  await clock.settle();
  expect(w.modelCalls).toHaveLength(1);
  const row = await $.ui.mount(ABOVE());
  expect(await row.find({ type: "Text", text: "Arabic → English" })).toBeDefined();
  expect(await row.find({ type: "Text", text: "[English] مرحبا بالعالم" })).toBeDefined();
  await row.press({ key: "ccb-bubble-insert" });
  expect(w.fills).toEqual([{ text: "[English] مرحبا بالعالم", mode: "insert" }]);
  await clock.advance(2800); // still selected: not translated again
  await clock.settle();
  expect(w.modelCalls).toHaveLength(1);
  await row.press({ key: "ccb-bubble-close" });
  expect(await row.find({ key: "ccb-bubble-close" })).toBeUndefined();
  await row.press({ key: "ccb-translate" }).catch(() => undefined);
});

test("instant skips numbers and single characters, and does nothing when turned off", async ($, on) => {
  const clock = mock.clock(on);
  const w = engine(on, { instant: true });
  await start($);
  for (const sel of ["42", "x", "  "]) {
    w.selection = sel;
    await clock.advance(1400);
    await clock.settle();
  }
  expect(w.modelCalls).toHaveLength(0);
});

test("instant translation off: selecting does nothing", async ($, on) => {
  const clock = mock.clock(on);
  const w = engine(on, { instant: false });
  await start($);
  w.selection = "Hello there";
  await clock.advance(2100);
  await clock.settle();
  expect(w.modelCalls).toHaveLength(0);
});

test("a model failure is shown, in the pane and the bubble", async ($, on) => {
  const clock = mock.clock(on);
  const w = engine(on, { instant: true, failModel: true });
  await start($);
  w.selection = "Hello world";
  await clock.advance(1400);
  await clock.settle();
  const row = await $.ui.mount(ABOVE());
  expect(await row.find({ type: "Text", text: "Couldn't translate: overloaded" })).toBeDefined();
  await row.press({ key: "ccb-bubble-open" });
  const ui = await $.ui.mount(PANE());
  expect(await ui.find({ type: "Text", text: "Couldn't translate: overloaded" })).toBeDefined();
});

test("selecting a translation that's already shown (to copy it) costs no new request", async ($, on) => {
  const clock = mock.clock(on);
  const w = engine(on, { instant: true });
  await start($);
  w.selection = "Bonjour tout le monde";
  await clock.advance(1400);
  await clock.settle();
  expect(w.modelCalls).toHaveLength(1);
  w.selection = "[English] Bonjour tout le monde"; // the bubble's own text
  await clock.advance(1400);
  await clock.settle();
  expect(w.modelCalls).toHaveLength(1);
});

test("after the selection is cleared, selecting the same text shows the bubble again (from the cache)", async ($, on) => {
  const clock = mock.clock(on);
  const w = engine(on, { instant: true });
  await start($);
  w.selection = "Guten Morgen";
  await clock.advance(1400);
  await clock.settle();
  const row = await $.ui.mount(ABOVE());
  await row.press({ key: "ccb-bubble-close" });
  w.selection = "";
  await clock.advance(700);
  await clock.settle();
  w.selection = "Guten Morgen";
  await clock.advance(1400);
  await clock.settle();
  expect(await row.find({ key: "ccb-bubble-close" })).toBeDefined();
  expect(w.modelCalls).toHaveLength(1);
});

test("code and paths aren't translated instantly", async ($, on) => {
  const clock = mock.clock(on);
  const w = engine(on, { instant: true });
  await start($);
  for (const sel of ["src/hooks/translate.tsx", "https://example.com", "const x = 1;\nreturn x;"]) {
    w.selection = sel;
    await clock.advance(1400);
    await clock.settle();
  }
  expect(w.modelCalls).toHaveLength(0);
});
