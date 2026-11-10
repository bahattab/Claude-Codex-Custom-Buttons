import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STARTER_PROMPTS,
  emptyLibrary,
  loadLibrary,
  seedStarterPack,
  validateLibrary,
  type Library,
} from "../src/index.js";
import { deleteRecord } from "../src/records.js";
import { ctx } from "./helpers.js";

describe("loadLibrary", () => {
  it("loads a current library", () => {
    const result = loadLibrary({ schemaVersion: 1 });
    expect(result).toMatchObject({ ok: true, readOnly: false, migratedFrom: null });
  });

  it("opens a newer library read-only", () => {
    expect(loadLibrary({ schemaVersion: 99 })).toEqual({ ok: true, library: null, readOnly: true, foundVersion: 99 });
  });

  it("rejects a missing schema version", () => {
    expect(loadLibrary({}).ok).toBe(false);
    expect(loadLibrary([]).ok).toBe(false);
  });

  it("runs migrations in order", () => {
    const migrations = {
      1: (doc: Record<string, unknown>) => ({ ...doc, step1: true }),
      2: (doc: Record<string, unknown>) => ({ ...doc, step2: doc["step1"] === true }),
    };
    const result = loadLibrary({ schemaVersion: 1 }, migrations, 3);
    expect(result).toMatchObject({ ok: true, migratedFrom: 1, library: { schemaVersion: 3, step1: true, step2: true } });
  });

  it("fails when a migration step is missing", () => {
    expect(loadLibrary({ schemaVersion: 1 }, {}, 2).ok).toBe(false);
  });
});

describe("seedStarterPack", () => {
  it("adds the starter pack once, and it validates", () => {
    const once = seedStarterPack(emptyLibrary());
    const twice = seedStarterPack(once);
    expect(twice).toEqual(once);
    expect(once.prompts).toHaveLength(STARTER_PROMPTS.length);
    expect(validateLibrary(once).ok).toBe(true);
  });

  it("does not bring back a starter prompt the user deleted", () => {
    const seeded = seedStarterPack(emptyLibrary());
    const first = seeded.prompts[0]!;
    const withDeleted: Library = {
      ...seeded,
      prompts: seeded.prompts.map((p) => (p.id === first.id ? deleteRecord(p, ctx("dev_laptop01", 0)) : p)),
    };
    const reseeded = seedStarterPack(withDeleted);
    expect(reseeded.prompts.find((p) => p.id === first.id)?.deletedAt).not.toBeNull();
  });

  it("gives every device identical starter records", () => {
    expect(JSON.stringify(seedStarterPack(emptyLibrary()))).toBe(JSON.stringify(seedStarterPack(emptyLibrary())));
  });
});

describe("source hygiene", () => {
  it("contains no invisible or bidirectional-control characters in source files", () => {
    const dir = join(import.meta.dirname, "..", "src");
    const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".ts"));
    // eslint-disable-next-line no-control-regex -- this test exists to find control characters
    const hidden = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069]/;
    for (const file of files) {
      const text = readFileSync(join(dir, String(file)), "utf8");
      expect(hidden.test(text), `hidden character in src/${String(file)}`).toBe(false);
    }
  });
});
