import { describe, expect, it } from "vitest";
import {
  applyEdit,
  contentHash,
  deleteRecord,
  deterministicUlid,
  isUlid,
  live,
  recordUse,
  restoreRecord,
  slugify,
  ulid,
} from "../src/index.js";
import { at, ctx, newNote, newPrompt, seededRandom } from "./helpers.js";

describe("applyEdit", () => {
  const A = "dev_laptop01";
  const B = "dev_desktop2";

  it("stamps the edit with this device and time", () => {
    const p = newPrompt(ctx(A, 0), "T");
    const e = applyEdit(p, { ...p, title: "T2" }, ctx(B, 5));
    expect(e).toMatchObject({ title: "T2", updatedAt: at(5), updatedBy: B });
  });

  it("records another device's version as an ancestor, but not its own", () => {
    const p = newPrompt(ctx(A, 0), "T");
    const byA = applyEdit(p, { ...p, title: "A1" }, ctx(A, 1));
    expect(byA.ancestors).toEqual([]);
    const byB = applyEdit(byA, { ...byA, title: "B1" }, ctx(B, 2));
    expect(byB.ancestors).toEqual([contentHash(byA)]);
    const byB2 = applyEdit(byB, { ...byB, title: "B2" }, ctx(B, 3));
    expect(byB2.ancestors).toEqual([contentHash(byA)]);
  });

  it("returns the same record when nothing changed", () => {
    const p = newPrompt(ctx(A, 0), "T");
    expect(applyEdit(p, { ...p }, ctx(B, 5))).toBe(p);
  });

  it("keeps a new version newer than its parent even if the clock is behind", () => {
    const p = newPrompt(ctx(A, 10), "T");
    const e = applyEdit(p, { ...p, title: "T2" }, ctx(B, 5));
    expect(Date.parse(e.updatedAt)).toBe(Date.parse(at(10)) + 1);
  });
});

describe("delete and restore", () => {
  it("keeps a tombstone and can restore it", () => {
    const n = newNote(ctx("dev_laptop01", 0), "Note");
    const d = deleteRecord(n, ctx("dev_laptop01", 5));
    expect(d.deletedAt).toBe(d.updatedAt);
    expect(live([n, d])).toEqual([n]);
    expect(deleteRecord(d, ctx("dev_laptop01", 6))).toBe(d);
    const r = restoreRecord(d, ctx("dev_laptop01", 7));
    expect(r.deletedAt).toBeNull();
    expect(contentHash(r)).toBe(contentHash(n));
  });
});

describe("recordUse", () => {
  it("counts use without changing the content hash or updatedAt", () => {
    const p = newPrompt(ctx("dev_laptop01", 0), "T");
    const used = recordUse(p, at(9));
    expect(used).toMatchObject({ useCount: 1, lastUsedAt: at(9), updatedAt: p.updatedAt });
    expect(contentHash(used)).toBe(contentHash(p));
  });
});

describe("ids", () => {
  it("makes valid, time-ordered ULIDs", () => {
    const rand = seededRandom(7);
    const a = ulid(Date.parse(at(0)), rand);
    const b = ulid(Date.parse(at(1)), rand);
    expect(isUlid(a) && isUlid(b)).toBe(true);
    expect(a < b).toBe(true);
  });

  it("makes the same deterministic ULID for the same seed", () => {
    const t = Date.parse(at(0));
    expect(deterministicUlid(t, "x")).toBe(deterministicUlid(t, "x"));
    expect(deterministicUlid(t, "x")).not.toBe(deterministicUlid(t, "y"));
    expect(isUlid(deterministicUlid(t, "x"))).toBe(true);
  });

  it("slugifies titles", () => {
    expect(slugify("Release Checklist: v1.2!")).toBe("release-checklist-v1-2");
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
    expect(slugify("مرحبا")).toBe("untitled");
  });
});
