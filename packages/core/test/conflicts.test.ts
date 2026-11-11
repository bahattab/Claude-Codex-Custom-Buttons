import { describe, expect, it } from "vitest";

import { emptyLibrary, live, merge, emptyBase, resolveConflict, saveNote, savePrompt, toDeviceFile, type Library } from "@ccb/core";

import { ctx, seededRandom } from "./helpers.js";

function ok<T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
}

/** A library holding a note edited on two devices at once, so it has one conflict copy. */
function conflicted(kind: "notes" | "prompts"): { lib: Library; id: string; copyId: string } {
  const rnd = seededRandom();
  const a0 = ctx("dev_aaaaaa1", 0);
  let lib = emptyLibrary();
  let id: string;
  if (kind === "notes") {
    const r = ok(saveNote(lib, { body: "Plan\nbase" }, a0, rnd));
    lib = r.library;
    id = r.record.id;
  } else {
    const r = ok(savePrompt(lib, { title: "Plan", body: "base" }, a0, rnd));
    lib = r.library;
    id = r.record.id;
  }
  const other = structuredClone(lib);
  lib = kind === "notes" ? ok(saveNote(lib, { id, body: "Plan\nmine" }, ctx("dev_aaaaaa1", 2), rnd)).library : ok(savePrompt(lib, { id, title: "Plan", body: "mine" }, ctx("dev_aaaaaa1", 2), rnd)).library;
  const theirs = kind === "notes" ? ok(saveNote(other, { id, body: "Plan\ntheirs" }, ctx("dev_bbbbbb1", 1), rnd)).library : ok(savePrompt(other, { id, title: "Plan", body: "theirs" }, ctx("dev_bbbbbb1", 1), rnd)).library;
  const m = merge({ local: lib, remotes: [toDeviceFile(theirs, { deviceId: "dev_bbbbbb1", deviceName: "B", now: ctx("dev_bbbbbb1", 3).now })], base: emptyBase(), now: ctx("dev_aaaaaa1", 4).now, deviceId: "dev_aaaaaa1" });
  lib = { ...lib, ...m.data };
  const records = (kind === "notes" ? lib.notes : lib.prompts) as Array<{ id: string; conflictOf: string | null; deletedAt: string | null }>;
  const copy = records.find((r) => r.conflictOf === id && r.deletedAt === null);
  if (!copy) throw new Error("no conflict copy");
  return { lib, id, copyId: copy.id };
}

describe("resolveConflict", () => {
  const c = ctx("dev_aaaaaa1", 10);

  it("keep original: the copy goes, the note stays as it was", () => {
    const { lib, id, copyId } = conflicted("notes");
    const before = lib.notes.find((n) => n.id === id)?.body;
    const r = ok(resolveConflict(lib, "notes", copyId, "original", c));
    expect(live(r.library.notes).map((n) => n.id)).toEqual([id]);
    expect(r.library.notes.find((n) => n.id === id)?.body).toBe(before);
  });

  it("keep copy: the copy's text replaces the original, without the (conflict) title", () => {
    const { lib, id, copyId } = conflicted("prompts");
    const copy = lib.prompts.find((p) => p.id === copyId);
    const r = ok(resolveConflict(lib, "prompts", copyId, "copy", c));
    const original = r.library.prompts.find((p) => p.id === id);
    expect(original?.body).toBe(copy?.body);
    expect(original?.title).toBe("Plan");
    expect(live(r.library.prompts).some((p) => p.id === copyId)).toBe(false);
  });

  it("keep both: the copy becomes an ordinary note", () => {
    const { lib, copyId } = conflicted("notes");
    const r = ok(resolveConflict(lib, "notes", copyId, "both", c));
    const copy = r.library.notes.find((n) => n.id === copyId);
    expect(copy?.conflictOf).toBeNull();
    expect(live(r.library.notes)).toHaveLength(2);
  });

  it("keep copy when the original was deleted keeps the copy as the note", () => {
    const { lib, id, copyId } = conflicted("notes");
    const withoutOriginal = { ...lib, notes: lib.notes.filter((n) => n.id !== id) };
    const r = ok(resolveConflict(withoutOriginal, "notes", copyId, "copy", c));
    expect(r.record.id).toBe(copyId);
    expect(r.record.title).toBe("Plan");
    expect(r.library.notes.find((n) => n.id === copyId)?.conflictOf).toBeNull();
  });

  it("refuses something that isn't a conflict copy", () => {
    const { lib, id } = conflicted("notes");
    expect(resolveConflict(lib, "notes", id, "original", c).ok).toBe(false);
    expect(resolveConflict(lib, "notes", "01JC8Z5K2V9Q4W7E3R6T1Y0V8K", "both", c).ok).toBe(false);
  });
});
