import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STARTER_PROMPTS, saveNote, savePrompt, setVariable, deleteNote, type Library } from "@ccb/core";
import {
  InvalidChangeError,
  LibraryStore,
  LockTimeoutError,
  ReadOnlyLibraryError,
  lockIsHeld,
  noteFileName,
  resolveHome,
  withLock,
} from "@ccb/store";

const run = promisify(execFile);
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ccb-store-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function expectOk<T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
}

describe("first run", () => {
  it("creates the library with the starter pack and a device identity", async () => {
    const store = new LibraryStore({ home });
    const { library, status } = await store.read();
    expect(status.kind).toBe("created");
    expect(library?.prompts).toHaveLength(STARTER_PROMPTS.length);
    const device = JSON.parse(await readFile(join(home, "device.json"), "utf8"));
    expect(device.deviceId).toMatch(/^dev_[a-z0-9]{12}$/);
    expect((await store.read()).status.kind).toBe("ok");
    expect(await store.getDevice()).toEqual(device);
  });

  it("uses $CCB_HOME, else the home folder", () => {
    expect(resolveHome({ CCB_HOME: "/tmp/x" })).toBe("/tmp/x");
    expect(resolveHome({})).toMatch(/\.claude-codex-buttons$/);
  });
});

describe("updates", () => {
  it("validates, bumps the revision and keeps the previous version as a backup", async () => {
    const store = new LibraryStore({ home });
    await store.read();
    const saved = await store.update((lib, ctx) => expectOk(setVariable(lib, "project", "Billing", ctx)).library);
    expect(saved.revision).toBe(1);
    const backup = JSON.parse(await readFile(join(home, "library.bak.json"), "utf8")) as Library;
    expect(backup.revision).toBe(0);
  });

  it("does not write when nothing changed", async () => {
    const store = new LibraryStore({ home });
    await store.read();
    const same = await store.update((lib) => lib);
    expect(same.revision).toBe(0);
  });

  it("rejects an invalid change and leaves the file untouched", async () => {
    const store = new LibraryStore({ home });
    await store.read();
    const before = await readFile(join(home, "library.json"), "utf8");
    await expect(store.update((lib) => ({ ...lib, settings: { ...lib.settings, buttons: { maxVisible: 99, showBuiltIns: true } } }))).rejects.toBeInstanceOf(InvalidChangeError);
    expect(await readFile(join(home, "library.json"), "utf8")).toBe(before);
  });

  it("cancels when the change function throws", async () => {
    const store = new LibraryStore({ home });
    await store.read();
    await expect(store.update(() => { throw new Error("nope"); })).rejects.toThrow("nope");
    expect(await lockIsHeld(join(home, ".lock"))).toBe(false);
  });
});

describe("recovery", () => {
  it("recovers from the backup when library.json is damaged, keeping the broken file", async () => {
    const store = new LibraryStore({ home });
    await store.read();
    await store.update((lib, ctx) => expectOk(setVariable(lib, "a", "1", ctx)).library);
    await store.update((lib, ctx) => expectOk(setVariable(lib, "b", "2", ctx)).library);
    await writeFile(join(home, "library.json"), "{ not json");
    const result = await store.read();
    expect(result.status.kind).toBe("recovered");
    expect(result.library?.variables.some((v) => v.id === "a")).toBe(true);
    const files = await readdir(home);
    expect(files.some((f) => f.startsWith("library.broken-"))).toBe(true);
  });

  it("starts fresh, keeping the broken file, when there is no usable backup", async () => {
    await writeFile(join(home, "library.json"), JSON.stringify({ schemaVersion: 1, prompts: "wrong" }));
    const result = await new LibraryStore({ home }).read();
    expect(result.status.kind).toBe("reset");
    expect(result.library?.prompts.length).toBe(STARTER_PROMPTS.length);
  });

  it("restores from the backup when library.json is missing, instead of starting over (review finding #3)", async () => {
    const store = new LibraryStore({ home });
    await store.read();
    await store.update((lib, ctx) => expectOk(setVariable(lib, "keep", "me", ctx)).library);
    await store.update((lib, ctx) => expectOk(setVariable(lib, "keep2", "me too", ctx)).library);
    await rm(join(home, "library.json"));
    const result = await new LibraryStore({ home }).read();
    expect(result.status).toMatchObject({ kind: "recovered", brokenFile: null });
    expect(result.library?.variables.some((v) => v.id === "keep")).toBe(true);
  });

  it("never leaves the folder without library.json while recovering", async () => {
    const store = new LibraryStore({ home });
    await store.read();
    await store.update((lib, ctx) => expectOk(setVariable(lib, "a", "1", ctx)).library);
    await store.update((lib, ctx) => expectOk(setVariable(lib, "b", "2", ctx)).library);
    await writeFile(join(home, "library.json"), "{ damaged");
    await store.read();
    const files = await readdir(home);
    expect(files).toContain("library.json");
    expect(files.filter((f) => f.startsWith("library.broken-"))).toHaveLength(1);
  });

  it("keeps a damaged library read-only when the backup is from a newer version (review finding #7)", async () => {
    await writeFile(join(home, "library.json"), "{ damaged");
    await writeFile(join(home, "library.bak.json"), JSON.stringify({ schemaVersion: 99 }));
    const store = new LibraryStore({ home });
    expect((await store.read()).status).toEqual({ kind: "read-only", foundVersion: 99 });
    await expect(store.update((lib) => lib)).rejects.toBeInstanceOf(ReadOnlyLibraryError);
    expect(await readFile(join(home, "library.bak.json"), "utf8")).toBe(JSON.stringify({ schemaVersion: 99 }));
  });

  it("opens a newer library read-only and refuses changes", async () => {
    await writeFile(join(home, "library.json"), JSON.stringify({ schemaVersion: 99 }));
    const store = new LibraryStore({ home });
    expect((await store.read()).status).toEqual({ kind: "read-only", foundVersion: 99 });
    await expect(store.update((lib) => lib)).rejects.toBeInstanceOf(ReadOnlyLibraryError);
  });
});

describe("locking", () => {
  it("serialises work inside one process", async () => {
    const lock = join(home, ".lock");
    const order: string[] = [];
    await Promise.all([
      withLock(lock, async () => { order.push("a1"); await new Promise((r) => setTimeout(r, 30)); order.push("a2"); }),
      withLock(lock, async () => { order.push("b1"); order.push("b2"); }),
    ]);
    expect(order.join()).toMatch(/^(a1,a2,b1,b2|b1,b2,a1,a2)$/);
  });

  it("breaks a stale lock left by a process that no longer exists", async () => {
    const lock = join(home, ".lock");
    await writeFile(lock, JSON.stringify({ pid: 999_999_999, at: Date.now(), token: "dead" }));
    expect(await withLock(lock, async () => "got it")).toBe("got it");
  });

  it("times out while another live holder keeps the lock", async () => {
    const lock = join(home, ".lock");
    await writeFile(lock, JSON.stringify({ pid: process.pid, at: Date.now(), token: "held" }));
    await expect(withLock(lock, async () => "never", { timeoutMs: 100 })).rejects.toBeInstanceOf(LockTimeoutError);
  });

  it("two or more processes writing at once never lose a change", async () => {
    await new LibraryStore({ home }).read();
    const writer = join(import.meta.dirname, "fixtures", "writer.mjs");
    const workers = 6;
    const each = 40;
    await Promise.all(
      Array.from({ length: workers }, (_, w) => run(process.execPath, [writer, home, String(w), String(each)])),
    );
    const { library } = await new LibraryStore({ home }).read();
    const written = library!.variables.filter((v) => /^w\d+_\d+$/.test(v.id));
    expect(written).toHaveLength(workers * each);
    expect(library!.revision).toBe(workers * each);
  }, 60_000);
});

describe("notes mirror", () => {
  async function withNote(store: LibraryStore, body: string): Promise<string> {
    let id = "";
    await store.update((lib, ctx) => {
      const r = expectOk(saveNote(lib, { body }, ctx, store.randomSource()));
      id = r.record.id;
      return r.library;
    });
    return id;
  }

  it("writes each note to <slug>--<id>.md", async () => {
    const store = new LibraryStore({ home });
    const id = await withNote(store, "# Release checklist\n- bump version");
    const name = noteFileName({ id, title: "Release checklist" });
    expect(name).toBe(`release-checklist--${id}.md`);
    expect(await readFile(join(home, "notes", name), "utf8")).toBe("# Release checklist\n- bump version");
  });

  it("imports an edit made to the file in another editor", async () => {
    const store = new LibraryStore({ home });
    const id = await withNote(store, "Draft");
    const file = join(home, "notes", noteFileName({ id, title: "Draft" }));
    await writeFile(file, "Draft, edited in another editor");
    const future = new Date(Date.now() + 5_000);
    await utimes(file, future, future);
    expect(await store.importNoteEdits()).toBe(1);
    const { library } = await store.read();
    expect(library!.notes.find((n) => n.id === id)?.body).toBe("Draft, edited in another editor");
  });

  it("keeps an edit made in the file when an unrelated change is saved (review finding #1)", async () => {
    const store = new LibraryStore({ home });
    const id = await withNote(store, "Original");
    const file = join(home, "notes", noteFileName({ id, title: "Original" }));
    await writeFile(file, "Edited in another editor");
    await store.update((lib, ctx) => expectOk(setVariable(lib, "unrelated", "x", ctx)).library);
    expect(await readFile(file, "utf8")).toBe("Edited in another editor");
    const { library } = await store.read();
    expect(library!.notes.find((n) => n.id === id)?.body).toBe("Edited in another editor");
  });

  it("imports file edits even when the file system's timestamps are coarse or behind", async () => {
    const store = new LibraryStore({ home });
    const id = await withNote(store, "Original");
    const file = join(home, "notes", noteFileName({ id, title: "Original" }));
    await writeFile(file, "Edited, old timestamp");
    const past = new Date(Date.now() - 3_600_000);
    await utimes(file, past, past);
    expect(await store.importNoteEdits()).toBe(1);
    expect((await store.read()).library!.notes.find((n) => n.id === id)?.body).toBe("Edited, old timestamp");
  });

  it("does not bring back old file text after a newer save through the store (review finding #2)", async () => {
    const store = new LibraryStore({ home });
    const id = await withNote(store, "Version 1");
    await store.update((lib, ctx) => expectOk(saveNote(lib, { id, body: "Version 2" }, ctx, store.randomSource())).library);
    expect(await store.importNoteEdits()).toBe(0);
    expect((await store.read()).library!.notes.find((n) => n.id === id)?.body).toBe("Version 2");
  });

  it("recreates a deleted mirror file and removes the file of a deleted note", async () => {
    const store = new LibraryStore({ home });
    const id = await withNote(store, "Keep me");
    const file = join(home, "notes", noteFileName({ id, title: "Keep me" }));
    await rm(file);
    expect(await store.importNoteEdits()).toBe(0);
    expect(await readFile(file, "utf8")).toBe("Keep me");
    await store.update((lib, ctx) => expectOk(deleteNote(lib, id, ctx)).library);
    expect(await readdir(join(home, "notes"))).toEqual([]);
  });

  it("renames the file when the note is renamed", async () => {
    const store = new LibraryStore({ home });
    const id = await withNote(store, "Old name");
    await store.update((lib, ctx) => expectOk(saveNote(lib, { id, title: "New name", body: "Old name" }, ctx, store.randomSource())).library);
    expect(await readdir(join(home, "notes"))).toEqual([`new-name--${id}.md`]);
  });

  it("writes nothing when mirror files are turned off", async () => {
    const store = new LibraryStore({ home });
    await store.read();
    await store.update((lib) => ({ ...lib, settings: { ...lib.settings, notes: { ...lib.settings.notes, mirrorFiles: false } } }));
    await withNote(store, "Private");
    await expect(readdir(join(home, "notes"))).rejects.toThrow();
    expect(await store.importNoteEdits()).toBe(0);
  });
});

describe("prompts through the store", () => {
  it("saves a prompt with this device as editor", async () => {
    const store = new LibraryStore({ home, now: () => new Date("2026-11-10T09:00:00.000Z") });
    const saved = await store.update((lib, ctx) => expectOk(savePrompt(lib, { title: "T", body: "B" }, ctx, store.randomSource())).library);
    const prompt = saved.prompts.find((p) => p.title === "T")!;
    expect(prompt.updatedBy).toBe((await store.getDevice()).deviceId);
    expect(prompt.updatedAt).toBe("2026-11-10T09:00:00.000Z");
  });
});
