// Creating, editing and deleting synced records. Every change goes through applyEdit so
// the sync metadata (updatedAt, updatedBy, ancestors) stays correct.
import { canonicalJson, hash } from "./ids.js";
import { LIMITS } from "./schema.js";
import type { EditContext, Iso, Prompt, SyncMeta } from "./types.js";

/**
 * Hash of a record's content: everything except sync metadata and usage statistics.
 * Two devices that make the same edit get the same hash.
 */
export function contentHash(record: SyncMeta): string {
  const rest: Record<string, unknown> = { ...record };
  delete rest["updatedAt"];
  delete rest["updatedBy"];
  delete rest["ancestors"];
  delete rest["deletedAt"];
  delete rest["useCount"];
  delete rest["lastUsedAt"];
  return hash(canonicalJson({ ...rest, deleted: record.deletedAt !== null }));
}

function plusOneMs(iso: Iso): Iso {
  return new Date(Date.parse(iso) + 1).toISOString();
}

/** The later of `now` and 1 ms after `previous`, so a new version is always newer than its parent. */
function nextTimestamp(now: Iso, previous: Iso): Iso {
  return Date.parse(now) > Date.parse(previous) ? now : plusOneMs(previous);
}

/** Sync metadata for a brand-new record. */
export function newMeta(id: string, ctx: EditContext): SyncMeta {
  return { id, updatedAt: ctx.now, updatedBy: ctx.deviceId, deletedAt: null, ancestors: [] };
}

/**
 * Returns `next` stamped as an edit of `prev` by this device. If nothing in the content
 * changed, returns `prev` unchanged so no sync traffic is created.
 *
 * When `prev` was written by another device, its hash is added to `ancestors`: that is
 * how other devices learn this version replaces theirs rather than competing with it.
 */
export function applyEdit<T extends SyncMeta>(prev: T, next: T, ctx: EditContext): T {
  const candidate = { ...next, id: prev.id, ancestors: prev.ancestors };
  if (contentHash(candidate) === contentHash(prev)) return prev;
  const ancestors =
    prev.updatedBy === ctx.deviceId ? prev.ancestors : [contentHash(prev), ...prev.ancestors];
  return {
    ...next,
    id: prev.id,
    updatedAt: nextTimestamp(ctx.now, prev.updatedAt),
    updatedBy: ctx.deviceId,
    ancestors: [...new Set(ancestors)].slice(0, LIMITS.ancestors),
  };
}

/** Marks a record deleted, keeping a tombstone so the deletion syncs. */
export function deleteRecord<T extends SyncMeta>(prev: T, ctx: EditContext): T {
  if (prev.deletedAt !== null) return prev;
  const edited = applyEdit(prev, { ...prev, deletedAt: ctx.now }, ctx);
  return { ...edited, deletedAt: edited.updatedAt };
}

/** Restores a deleted record. */
export function restoreRecord<T extends SyncMeta>(prev: T, ctx: EditContext): T {
  if (prev.deletedAt === null) return prev;
  return applyEdit(prev, { ...prev, deletedAt: null }, ctx);
}

/**
 * Records that a prompt was used. Statistics are not content edits: they don't change
 * `updatedAt` and never cause conflicts (the largest value wins when merging).
 */
export function recordUse(prompt: Prompt, now: Iso): Prompt {
  return { ...prompt, useCount: prompt.useCount + 1, lastUsedAt: now };
}

/** Records still live (not deleted). */
export function live<T extends SyncMeta>(records: readonly T[]): T[] {
  return records.filter((r) => r.deletedAt === null);
}
