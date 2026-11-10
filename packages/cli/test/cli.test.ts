import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STARTER_PROMPTS, savePrompt, saveNote } from "@ccb/core";
import { LibraryStore } from "@ccb/store";
import { CLI_VERSION, EXPORT_FORMAT, run, settingKeys } from "@ccb/cli";

let home: string;
let other: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ccb-cli-"));
  other = await mkdtemp(join(tmpdir(), "ccb-cli-other-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(other, { recursive: true, force: true });
});

async function ccb(args: string[], dir = home): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { env: { CCB_HOME: dir }, out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("help and version", () => {
  it("prints help with no command, and the version", async () => {
    expect((await ccb([])).out).toMatch(/Usage:/);
    expect((await ccb(["--help"])).out).toMatch(/ccb doctor/);
    expect((await ccb(["--version"])).out).toBe(CLI_VERSION);
  });

  it("rejects unknown commands and options", async () => {
    expect((await ccb(["frobnicate"])).code).toBe(2);
    expect((await ccb(["--nope"])).code).toBe(2);
  });
});

describe("config", () => {
  it("lists every local and shared setting", async () => {
    const { out, code } = await ccb(["config", "list"]);
    expect(code).toBe(0);
    for (const key of settingKeys()) expect(out).toContain(`${key} = `);
    expect(out).toContain("continue.message = null");
  });

  it("gets and sets typed values", async () => {
    expect((await ccb(["config", "set", "regenerate.autoSubmit", "true"])).code).toBe(0);
    expect((await ccb(["config", "get", "regenerate.autoSubmit"])).out).toBe("true");
    expect((await ccb(["config", "set", "sync.intervalSeconds", "120"])).code).toBe(0);
    expect((await ccb(["config", "get", "sync.intervalSeconds"])).out).toBe("120");
    expect((await ccb(["config", "set", "sync.folderPath", "G:\\My Drive\\CCB"])).code).toBe(0);
    expect((await ccb(["config", "get", "sync.folderPath"])).out).toBe(JSON.stringify("G:\\My Drive\\CCB"));
    expect((await ccb(["config", "set", "sync.folderPath", "null"])).code).toBe(0);
    expect((await ccb(["config", "get", "sync.folderPath"])).out).toBe("null");
  });

  it("sets shared settings with spaces in the value", async () => {
    expect((await ccb(["config", "set", "continue.message", "Keep", "going", "please"])).code).toBe(0);
    expect((await ccb(["config", "get", "continue.message"])).out).toBe('"Keep going please"');
  });

  it("refuses unknown keys, wrong types and out-of-range values", async () => {
    expect((await ccb(["config", "get", "nope.key"])).code).toBe(2);
    expect((await ccb(["config", "set", "regenerate.autoSubmit", "yes"])).code).toBe(2);
    expect((await ccb(["config", "set", "sync.intervalSeconds", "abc"])).code).toBe(2);
    const range = await ccb(["config", "set", "sync.intervalSeconds", "5"]);
    expect(range.code).toBe(1);
    expect(range.err).toMatch(/intervalSeconds/);
    expect((await ccb(["config", "set", "sync.mode", "carrier-pigeon"])).code).toBe(1);
    expect((await ccb(["config", "set"])).code).toBe(2);
    expect((await ccb(["config", "set", "sync.mode"])).code).toBe(2);
    expect((await ccb(["config", "frob", "x"])).code).toBe(2);
  });
});

describe("export and import", () => {
  async function seed(dir: string): Promise<void> {
    const store = new LibraryStore({ home: dir });
    await store.update((lib, ctx) => {
      const p = savePrompt(lib, { title: "Exported prompt", body: "Hello {{project}}" }, ctx, store.randomSource());
      if (!p.ok) throw new Error(p.errors.join());
      const n = saveNote(p.value.library, { body: "# Exported note" }, ctx, store.randomSource());
      if (!n.ok) throw new Error(n.errors.join());
      return n.value.library;
    });
  }

  it("exports to stdout and to a file", async () => {
    await seed(home);
    const doc = JSON.parse((await ccb(["export"])).out);
    expect(doc.format).toBe(EXPORT_FORMAT);
    expect(doc.prompts.some((p: { title: string }) => p.title === "Exported prompt")).toBe(true);
    const file = join(home, "out.json");
    expect((await ccb(["export", file])).out).toMatch(/Exported 5 prompts/);
    expect(JSON.parse(await readFile(file, "utf8")).notes).toHaveLength(1);
  });

  it("imports another computer's export by merging, and importing twice changes nothing", async () => {
    await seed(other);
    const file = join(other, "export.json");
    await ccb(["export", file], other);
    const first = await ccb(["import", file]);
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/prompts 4 → 5/);
    expect(first.out).toMatch(/notes 0 → 1/);
    const second = await ccb(["import", file]);
    expect(second.out).toMatch(/prompts 5 → 5/);
    const lib = (await new LibraryStore({ home }).read()).library!;
    expect(lib.prompts.filter((p) => p.title === "Exported prompt")).toHaveLength(1);
    expect(lib.prompts).toHaveLength(STARTER_PROMPTS.length + 1);
  });

  it("imports a library.json directly", async () => {
    await seed(other);
    const result = await ccb(["import", join(other, "library.json")]);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/prompts 4 → 5/);
  });

  it("refuses missing, non-JSON, unknown and invalid files", async () => {
    expect((await ccb(["import"])).code).toBe(2);
    expect((await ccb(["import", join(home, "missing.json")])).err).toMatch(/not found/);
    await writeFile(join(home, "bad.json"), "{");
    expect((await ccb(["import", join(home, "bad.json")])).err).toMatch(/not valid JSON/);
    await writeFile(join(home, "other.json"), JSON.stringify({ hello: "world" }));
    expect((await ccb(["import", join(home, "other.json")])).err).toMatch(/not a ccb export/);
    await writeFile(join(home, "invalid.json"), JSON.stringify({ format: EXPORT_FORMAT, schemaVersion: 1, prompts: [{ id: "x" }] }));
    const invalid = await ccb(["import", join(home, "invalid.json")]);
    expect(invalid.code).toBe(1);
    expect(invalid.err).toMatch(/was not imported/);
  });
});

describe("doctor", () => {
  it("passes on a fresh data folder", async () => {
    const { code, out } = await ccb(["doctor"]);
    expect(code).toBe(0);
    expect(out).toMatch(/\[ok\]\s+Library created/);
    expect(out).toMatch(/Device dev_/);
    expect(out).not.toMatch(/FAIL/);
  });

  it("warns after recovering a damaged library from the backup", async () => {
    await ccb(["config", "set", "sync.intervalSeconds", "90"]);
    await ccb(["config", "set", "sync.intervalSeconds", "95"]);
    await writeFile(join(home, "library.json"), "garbage");
    const { code, out } = await ccb(["doctor"]);
    expect(code).toBe(0);
    expect(out).toMatch(/\[warn\].*restored from the backup/);
  });

  it("warns about a stale lock and missing note files", async () => {
    await seed();
    await writeFile(join(home, ".lock"), JSON.stringify({ pid: 999_999_999, at: Date.now(), token: "dead" }));
    await rm(join(home, "notes"), { recursive: true, force: true });
    const { out } = await ccb(["doctor"]);
    expect(out).toMatch(/stale lock/);
    expect(out).toMatch(/note file\(s\) missing/);

    async function seed(): Promise<void> {
      const store = new LibraryStore({ home });
      await store.update((lib, ctx) => {
        const n = saveNote(lib, { body: "x" }, ctx, store.randomSource());
        if (!n.ok) throw new Error(n.errors.join());
        return n.value.library;
      });
    }
  });

  it("fails on a library from a newer version", async () => {
    await writeFile(join(home, "library.json"), JSON.stringify({ schemaVersion: 99 }));
    const { code, out } = await ccb(["doctor"]);
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL.*schema version 99/);
    expect((await ccb(["config", "list"])).code).toBe(1);
  });
});

describe("as a real process", () => {
  it("runs the compiled ccb", async () => {
    const bin = join(import.meta.dirname, "..", "dist", "bin.js");
    const { stdout } = await promisify(execFile)(process.execPath, [bin, "config", "get", "sync.mode"], { env: { ...process.env, CCB_HOME: home } });
    expect(stdout.trim()).toBe('"drive-api"');
  });
});
