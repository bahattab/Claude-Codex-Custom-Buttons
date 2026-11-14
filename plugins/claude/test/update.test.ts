import { expect, mock, test } from "claude-code/testing";
import type { TestBody } from "claude-code/testing";

import { cloneRoot } from "../hooks/update.js";

type TestOn = Parameters<TestBody>[1];

interface World {
  marker: boolean;
  heads: string[];
  pullExit: number;
  runs: string[][];
  toasts: string[];
}

function engine(on: TestOn, init: Partial<World> = {}): World {
  const w: World = { marker: true, heads: ["aaa", "bbb"], pullExit: 0, runs: [], toasts: [], ...init };
  on("command.register", () => ({ value: { command: "x" } }) as never);
  on("mcp.connect", () => ({ value: { isConnected: false, message: "offline" } }) as never);
  on("ui.status", () => ({ value: undefined }) as never);
  on("ui.selection", () => ({ value: undefined }) as never);
  on("ui.toast", (_$, e) => {
    w.toasts.push((e as { text: string }).text);
    return { value: undefined } as never;
  });
  on("fs.read", (_$, e) => {
    const path = (e as { path: string }).path;
    if (path.endsWith("/.ccb-auto-update") && w.marker) return { value: "" } as never;
    throw new Error(`ENOENT: ${path}`);
  });
  on("process.run", (_$, e) => {
    const argv = (e as { argv: string[] }).argv;
    w.runs.push(argv);
    if (argv.includes("rev-parse")) return { value: { exitCode: 0, stdout: `${w.heads.shift() ?? "bbb"}\n`, stderr: "" } } as never;
    return { value: { exitCode: w.pullExit, stdout: "", stderr: "" } } as never;
  });
  on("session.start", (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never);
  return w;
}

test("cloneRoot finds the clone above plugins/claude", () => {
  expect(cloneRoot("/opt/ccb/plugins/claude")).toBe("/opt/ccb");
  expect(cloneRoot("/opt/ccb/plugins/claude/")).toBe("/opt/ccb");
});

test("with the marker file, session start pulls the clone and says when a new version came", async ($, on) => {
  const clock = mock.clock(on);
  const w = engine(on);
  await $.session.start({ cwd: "/", surface: "desktop", isInteractive: true } as never);
  await clock.settle();
  expect(w.runs.some((argv) => argv.includes("pull") && argv.includes("--ff-only"))).toBe(true);
  expect(w.toasts.some((t) => t.includes("Prompt Buttons updated"))).toBe(true);
});

test("already current: pulls, says nothing", async ($, on) => {
  const clock = mock.clock(on);
  const w = engine(on, { heads: ["aaa", "aaa"] });
  await $.session.start({ cwd: "/", surface: "desktop", isInteractive: true } as never);
  await clock.settle();
  expect(w.runs.some((argv) => argv.includes("pull"))).toBe(true);
  expect(w.toasts.filter((t) => t.includes("updated"))).toEqual([]);
});

test("without the marker file (a working copy or a marketplace install), nothing is pulled", async ($, on) => {
  const clock = mock.clock(on);
  const w = engine(on, { marker: false });
  await $.session.start({ cwd: "/", surface: "desktop", isInteractive: true } as never);
  await clock.settle();
  expect(w.runs).toEqual([]);
});

test("a failed pull (offline) is quiet and the session starts as usual", async ($, on) => {
  const clock = mock.clock(on);
  const w = engine(on, { pullExit: 1 });
  await $.session.start({ cwd: "/", surface: "desktop", isInteractive: true } as never);
  await clock.settle();
  expect(w.toasts.filter((t) => t.includes("updated"))).toEqual([]);
});
