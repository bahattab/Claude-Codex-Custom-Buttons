import { expect, test } from "claude-code/testing";
import type { TestBody } from "claude-code/testing";

type TestEngine = Parameters<TestBody>[0];
type TestOn = Parameters<TestBody>[1];

// A stand-in for the engine and the bundled ccb-mcp server: every hook below sits
// beneath the plugin and answers what the plugin asks.
type Recorded = { submits: string[]; fills: Array<{ text: string; mode?: string }>; toasts: string[]; mcp: Array<{ tool: string; args: Record<string, unknown> }> };

const STATE = {
  buttons: [
    { id: "btn_plan", label: "Plan", icon: "📅", action: { type: "submit", promptId: "01JC8Z5K2V9Q4W7E3R6T1Y0U8I" }, order: 0, targetMissing: false },
    { id: "btn_hello", label: "Hello", icon: null, action: { type: "fill", text: "Hello {{project}} on {{date}}", mode: "append" }, order: 1, targetMissing: false },
    { id: "btn_ask", label: "Ask", icon: null, action: { type: "submit", text: "Explain {{?topic}}" }, order: 2, targetMissing: false },
    { id: "btn_gone", label: "Gone", icon: null, action: { type: "submit", promptId: "01JC8Z5K2V9Q4W7E3R6T1Y0U8J" }, order: 3, targetMissing: true },
  ],
  variables: { project: "Billing API" },
  settings: {
    regenerate: { autoSubmit: false, source: "auto" },
    continue: { highlightOnTruncation: true },
    buttons: { maxVisible: 6, showBuiltIns: true },
  },
  continueMessage: "Keep going.",
  regenerateInstructions: null,
};

function engine(on: TestOn, opts: { state?: unknown; draft?: string; selection?: string; messages?: Array<{ role: string; text: string }>; rewrite?: string; onModel?: (e: { prompt: string }) => unknown; mcpDown?: boolean } = {}): Recorded {
  const rec: Recorded = { submits: [], fills: [], toasts: [], mcp: [] };
  const state = opts.state ?? STATE;
  on("command.register", () => ({ value: { command: "x" } }) as never);
  on("mcp.call", (_$, e) => {
    rec.mcp.push({ tool: e.tool, args: e.args });
    if (opts.mcpDown) return { value: { content: [{ type: "text", text: "not connected" }], isError: true } } as never;
    const reply = (data: unknown) => ({ value: { content: [{ type: "text", text: JSON.stringify(data) }], isError: false } }) as never;
    if (e.tool === "client_state") return reply(state);
    if (e.tool === "bank_get") return reply({ expanded: { text: "Plan my day for Billing API", unknown: [], unavailable: [], unanswered: [] } });
    return { value: { content: [{ type: "text", text: "unknown tool" }], isError: true } } as never;
  });
  on("prompt.submit", (_$, e) => {
    rec.submits.push(e.text);
    return { text: e.text } as never;
  });
  on("prompt.fill", (_$, e) => {
    rec.fills.push({ text: e.text, ...(e.mode ? { mode: e.mode } : {}) });
    return { isFilled: true } as never;
  });
  on("prompt.read", () => ({ value: { text: opts.draft ?? "", cursor: 0 } }) as never);
  on("ui.selection", () => ({ value: opts.selection !== undefined ? { text: opts.selection } : undefined }) as never);
  on("session.messages", () => ({ value: opts.messages ?? [] }) as never);
  on("session.model", () => ({ value: "claude-test" }) as never);
  on("model.complete", (_$, e) =>
    ({ value: opts.onModel ? opts.onModel(e as { prompt: string }) : { isAnswered: true, text: opts.rewrite ?? "A clearer prompt.", usage: {} } }) as never,
  );
  on("ui.toast", (_$, e) => {
    rec.toasts.push(JSON.stringify(e));
    return { value: undefined } as never;
  });
  on("session.start", (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never);
  on("command.run", () => ({}) as never);
  on("turn.complete", (_$, e) => ({ text: (e as { answer: string }).answer }) as never);
  return rec;
}

const TURN_DONE = { turnId: "t1", answer: "done", durationMs: 10, isAborted: false, reason: "answer" } as never;

async function start($: TestEngine): Promise<void> {
  await $.session.start({ cwd: "/", surface: "desktop", isInteractive: true } as never);
}

test("/cont sends the configured Continue message", async ($, on) => {
  const rec = engine(on);
  await start($);
  await $.command.run({ command: "cont", args: "" } as never);
  expect(rec.submits).toEqual([]); // a command can't submit inside its own turn...
  await $.turn.complete(TURN_DONE);
  expect(rec.submits).toEqual(["Keep going."]); // ...so it is sent when that turn ends
});

const ABOVE = (surface: "terminal" | "desktop", hasSurvey = false) =>
  ({
    plugin: "prompt-buttons",
    surface,
    component: "AbovePrompt",
    props: { hasSurvey, isCollapsed: false, isWorking: false, maxRows: 4 },
  }) as never;

test("the button row shows Continue, Regenerate and user buttons on terminal and desktop", async ($, on) => {
  engine(on);
  await start($);
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount(ABOVE(surface));
    expect(await ui.find({ key: "ccb-continue" })).toBeDefined();
    expect(await ui.find({ key: "ccb-regenerate" })).toBeDefined();
    expect(await ui.find({ key: "ccb-btn-btn_plan" })).toBeDefined();
    expect(await ui.find({ key: "ccb-btn-btn_gone" })).toBeDefined();
    expect(await ui.find({ key: "ccb-more" })).toBeUndefined();
    await ui.unmount();
  }
});

test("buttons beyond maxVisible go into a More list", async ($, on) => {
  engine(on, { state: { ...STATE, settings: { ...STATE.settings, buttons: { maxVisible: 2, showBuiltIns: true } } } });
  await start($);
  const ui = await $.ui.mount(ABOVE("desktop"));
  expect(await ui.find({ key: "ccb-btn-btn_hello" })).toBeDefined();
  expect(await ui.find({ key: "ccb-btn-btn_ask" })).toBeUndefined();
  expect(await ui.find({ key: "ccb-more" })).toBeDefined();
  await ui.unmount();
});

test("the row stays out of the way during a survey", async ($, on) => {
  engine(on);
  await start($);
  const ui = await $.ui.mount(ABOVE("desktop", true));
  expect(await ui.find({ key: "ccb-continue" })).toBeUndefined();
  await ui.unmount();
});

test("pressing Continue submits the Continue message at once", async ($, on) => {
  const rec = engine(on);
  await start($);
  const ui = await $.ui.mount(ABOVE("desktop"));
  await ui.press({ key: "ccb-continue" });
  expect(rec.submits).toEqual(["Keep going."]);
  await ui.unmount();
});

test("Regenerate rewrites the draft into the prompt box, and Undo puts it back", async ($, on) => {
  const rec = engine(on, { draft: "make login faster pls", rewrite: "Make the login flow faster." });
  await start($);
  const ui = await $.ui.mount(ABOVE("desktop"));
  await ui.press({ key: "ccb-regenerate" });
  expect(rec.fills).toEqual([{ text: "Make the login flow faster.", mode: "replace" }]);
  expect(rec.submits).toEqual([]);
  await ui.press({ key: "ccb-undo" });
  expect(rec.fills.at(-1)).toEqual({ text: "make login faster pls", mode: "replace" });
  await ui.unmount();
});

test("Regenerate prefers the selection, then the draft, then the last message", async ($, on) => {
  const prompts: string[] = [];
  const rec = engine(on, {
    selection: "selected words",
    draft: "a draft",
    messages: [{ role: "user", text: "last message" }],
    onModel: (e) => (prompts.push(String(e.prompt)), { isAnswered: true, text: "Rewritten.", usage: {} }),
  });
  await start($);
  await $.command.run({ command: "regen", args: "" } as never);
  expect(prompts[0]).toContain("selected words");
  expect(rec.fills).toHaveLength(1);
});

test("Regenerate falls back to the last user message, and says when there is nothing", async ($, on) => {
  const prompts: string[] = [];
  engine(on, {
    messages: [{ role: "user", text: "the last thing I asked" }, { role: "assistant", text: "an answer" }],
    onModel: (e) => (prompts.push(String(e.prompt)), { isAnswered: true, text: "Rewritten.", usage: {} }),
  });
  await start($);
  await $.command.run({ command: "regen", args: "" } as never);
  expect(prompts[0]).toContain("the last thing I asked");
});

test("Regenerate with nothing to work on explains why", async ($, on) => {
  const rec = engine(on);
  await start($);
  await $.command.run({ command: "regen", args: "" } as never);
  expect(rec.fills).toEqual([]);
  expect(rec.toasts.join()).toMatch(/Nothing to regenerate/);
});

test("Regenerate warns when the rewrite dropped code, paths or numbers", async ($, on) => {
  const rec = engine(on, { draft: "fix src/api/users.ts to return 200", rewrite: "Fix the users endpoint." });
  await start($);
  await $.command.run({ command: "regen", args: "" } as never);
  expect(rec.toasts.join()).toMatch(/dropped .*src\/api\/users\.ts/);
});

test("Regenerate submits after the command's turn when autoSubmit is on", async ($, on) => {
  const rec = engine(on, {
    draft: "rough",
    rewrite: "Clear.",
    state: { ...STATE, settings: { ...STATE.settings, regenerate: { autoSubmit: true, source: "auto" } } },
  });
  await start($);
  await $.command.run({ command: "regen", args: "" } as never);
  expect(rec.fills).toEqual([]);
  await $.turn.complete(TURN_DONE);
  expect(rec.submits).toEqual(["Clear."]);
});

test("Regenerate reports a failed model call and leaves the prompt alone", async ($, on) => {
  const rec = engine(on, { draft: "rough", onModel: () => ({ isAnswered: false, reason: "api-error" }) });
  await start($);
  await $.command.run({ command: "regen", args: "" } as never);
  expect(rec.fills).toEqual([]);
  expect(rec.toasts.join()).toMatch(/Regenerate failed/);
});

test("/regen undo with nothing to undo says so", async ($, on) => {
  engine(on);
  await start($);
  const result = (await $.command.run({ command: "regen", args: "undo" } as never)) as { text?: string };
  expect(result.text).toBe("Nothing to undo.");
});

test("a prompt button fetches the prompt with variables filled in, marks it used, and sends it", async ($, on) => {
  const rec = engine(on);
  await start($);
  const ui = await $.ui.mount(ABOVE("desktop"));
  await ui.press({ key: "ccb-btn-btn_plan" });
  expect(rec.mcp.find((c) => c.tool === "bank_get")?.args).toMatchObject({ id: "01JC8Z5K2V9Q4W7E3R6T1Y0U8I", expand: true, markUsed: true });
  expect(rec.submits).toEqual(["Plan my day for Billing API"]);
  await ui.unmount();
});

test("a text button expands variables locally and fills with its mode", async ($, on) => {
  const rec = engine(on);
  await start($);
  const ui = await $.ui.mount(ABOVE("terminal"));
  await ui.press({ key: "ccb-btn-btn_hello" });
  expect(rec.fills).toHaveLength(1);
  expect(rec.fills[0]?.mode).toBe("append");
  expect(rec.fills[0]?.text).toMatch(/^Hello Billing API on \d{4}-\d{2}-\d{2}$/);
  await ui.unmount();
});

test("a submit button with an unanswered {{?ask}} fills the box instead and says what to fill in", async ($, on) => {
  const rec = engine(on);
  await start($);
  const ui = await $.ui.mount(ABOVE("desktop"));
  await ui.press({ key: "ccb-btn-btn_ask" });
  expect(rec.submits).toEqual([]);
  expect(rec.fills).toEqual([{ text: "Explain {{?topic}}", mode: "replace" }]);
  expect(rec.toasts.join()).toMatch(/\{\{\?topic\}\}/);
  await ui.unmount();
});

test("a button whose prompt was deleted explains instead of sending", async ($, on) => {
  const rec = engine(on);
  await start($);
  const ui = await $.ui.mount(ABOVE("desktop"));
  await ui.press({ key: "ccb-btn-btn_gone" });
  expect(rec.submits).toEqual([]);
  expect(rec.toasts.join()).toMatch(/was deleted/);
  await ui.unmount();
});

test("/btn runs a button after its turn, and explains unknown or missing ids", async ($, on) => {
  const rec = engine(on);
  await start($);
  await $.command.run({ command: "btn", args: "btn_plan" } as never);
  await $.turn.complete(TURN_DONE);
  expect(rec.submits).toEqual(["Plan my day for Billing API"]);
  const unknown = (await $.command.run({ command: "btn", args: "btn_nope" } as never)) as { text?: string };
  expect(unknown.text).toMatch(/No button "btn_nope".*btn_plan/);
  const usage = (await $.command.run({ command: "btn", args: "" } as never)) as { text?: string };
  expect(usage.text).toMatch(/Usage: \/btn <id>/);
});

test("the buttons still work, with defaults, when ccb-mcp is unavailable", async ($, on) => {
  const rec = engine(on, { mcpDown: true });
  await start($);
  const ui = await $.ui.mount(ABOVE("desktop"));
  expect(await ui.find({ key: "ccb-continue" })).toBeDefined();
  await ui.press({ key: "ccb-continue" });
  expect(rec.submits[0]).toMatch(/^Continue exactly where you stopped/);
  await ui.unmount();
});

test("Continue is highlighted after a reply hit the output limit, and cleared by the next prompt", async ($, on) => {
  engine(on);
  let stop = "max_tokens";
  // eslint-disable-next-line require-yield -- stands in for the engine: answers the step without streaming chunks
  on("turn.step", async function* () {
    return { turnId: "t1", index: 0, answer: "partial", toolUses: [], stopReason: stop, usage: null } as never;
  });
  await start($);
  const step = { turnId: "t1", index: 0, model: "claude-test", messageCount: 2 } as never;
  for await (const _chunk of $.turn.step(step) as AsyncIterable<unknown>) {
    // drain the stream
  }
  const ui = await $.ui.mount(ABOVE("desktop"));
  expect((await ui.find({ key: "ccb-continue" }))?.text).toMatch(/cut off/);
  await $.prompt.submit({ text: "next question" } as never);
  expect((await ui.find({ key: "ccb-continue" }))?.text).not.toMatch(/cut off/);
  stop = "end_turn";
  for await (const _chunk of $.turn.step(step) as AsyncIterable<unknown>) {
    // a normal ending does not highlight
  }
  expect((await ui.find({ key: "ccb-continue" }))?.text).not.toMatch(/cut off/);
  await ui.unmount();
});
