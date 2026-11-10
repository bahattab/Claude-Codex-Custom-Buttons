// Upgrading older library files, and refusing to modify newer ones.
// See docs/data-model.md#schema-versions-and-migration.
import { SCHEMA_VERSION, validateLibrary } from "./schema.js";
import type { Library } from "./types.js";

type Doc = Record<string, unknown>;

/**
 * Migrations keyed by the version they upgrade FROM. Each returns a document at the next
 * version. Version 1 is the first, so the table is empty for now.
 */
export const MIGRATIONS: Readonly<Record<number, (doc: Doc) => Doc>> = {};

export type LoadResult =
  | { ok: true; library: Library; readOnly: false; migratedFrom: number | null }
  | { ok: true; library: null; readOnly: true; foundVersion: number }
  | { ok: false; errors: string[] };

/** Migrates (if needed) and validates a parsed library.json. */
export function loadLibrary(raw: unknown, migrations = MIGRATIONS, target = SCHEMA_VERSION): LoadResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["library: must be a JSON object"] };
  }
  let doc = raw as Doc;
  const found = doc["schemaVersion"];
  if (typeof found !== "number" || !Number.isInteger(found) || found < 1) {
    return { ok: false, errors: ["schemaVersion: missing or invalid"] };
  }
  if (found > target) return { ok: true, library: null, readOnly: true, foundVersion: found };

  for (let v = found; v < target; v++) {
    const step = migrations[v];
    if (!step) return { ok: false, errors: [`no migration from schema version ${v}`] };
    doc = { ...step(doc), schemaVersion: v + 1 };
  }
  const result = target === SCHEMA_VERSION ? validateLibrary(doc) : { ok: true as const, value: doc as unknown as Library };
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, library: result.value, readOnly: false, migratedFrom: found === target ? null : found };
}
