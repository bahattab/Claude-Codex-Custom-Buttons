// Merges this device's data with the other devices' files from Drive.
// Rules: docs/google-drive-sync.md#merge-rules.
import { canonicalJson, deterministicUlid } from "../ids.js";
import { contentHash } from "../records.js";
import { DEVICE_FILE_FORMAT, LIMITS, SCHEMA_VERSION } from "../schema.js";
import {
  COLLECTIONS,
  type CollectionName,
  type DeviceFile,
  type Iso,
  type Note,
  type Prompt,
  type SyncMeta,
  type SyncedData,
} from "../types.js";

/** Tombstones, and device files not updated, are kept or trusted for this long. */
export const RETENTION_DAYS = 180;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Collections where a concurrent edit is kept as a visible conflict copy. */
const COPY_ON_CONFLICT: ReadonlySet<CollectionName> = new Set(["prompts", "notes"]);

/** What this device remembers from its last successful sync. */
export interface SyncBase {
  /** When this device last merged other devices' files. */
  lastPullAt: Iso | null;
  /** Content hash of each record as of the last sync, keyed "collection/id". */
  hashes: Record<string, string>;
}

export interface MergeInput {
  local: SyncedData;
  /** Other devices' files from Drive. This device's own file, if passed, is ignored. */
  remotes: readonly DeviceFile[];
  base: SyncBase;
  now: Iso;
  deviceId: string;
}

export interface ConflictCopy {
  collection: "prompts" | "notes";
  /** The record both devices edited. */
  id: string;
  /** The copy holding the version that lost. */
  copyId: string;
}

export interface MergeResult {
  data: SyncedData;
  base: SyncBase;
  /** Conflict copies created by this merge (or already present from another device). */
  conflicts: ConflictCopy[];
  /** True when `data` differs from `local`. */
  changed: boolean;
  /** Device files ignored because they were not updated for RETENTION_DAYS. */
  staleDevices: string[];
}

export function emptyBase(): SyncBase {
  return { lastPullAt: null, hashes: {} };
}

const key = (collection: CollectionName, id: string): string => `${collection}/${id}`;

/** Sorts records by ID so equal data always looks the same. */
function sortById<T extends SyncMeta>(records: T[]): T[] {
  return [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Newest first: by updatedAt, then device ID, then content hash, so every device agrees. */
function compareVersions(a: SyncMeta, b: SyncMeta): number {
  const t = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  if (t !== 0) return t;
  if (a.updatedBy !== b.updatedBy) return a.updatedBy < b.updatedBy ? 1 : -1;
  const ha = contentHash(a);
  const hb = contentHash(b);
  return ha === hb ? 0 : ha < hb ? 1 : -1;
}

/** True when version `w` is known to replace version `v`. */
function dominates(w: SyncMeta, v: SyncMeta, vHash: string): boolean {
  if (w === v) return false;
  if (w.ancestors.includes(vHash)) return true;
  // A device's own versions form a line: its later version replaces its earlier one.
  return w.updatedBy === v.updatedBy && Date.parse(w.updatedAt) > Date.parse(v.updatedAt);
}

function maxIso(a: Iso | null, b: Iso | null): Iso | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Usage statistics: largest value wins, from every version seen. */
function withStats<T extends SyncMeta>(winner: T, all: readonly T[]): T {
  if (!("useCount" in winner)) return winner;
  const prompts = all as unknown as Prompt[];
  return {
    ...winner,
    useCount: Math.max(...prompts.map((p) => p.useCount)),
    lastUsedAt: prompts.map((p) => p.lastUsedAt).reduce(maxIso, null),
  };
}

function conflictCopy<T extends SyncMeta>(collection: CollectionName, loser: T, loserHash: string): T {
  const record = loser as unknown as Prompt | Note;
  const suffix = " (conflict)";
  const title = record.title.slice(0, LIMITS.promptTitle - suffix.length) + suffix;
  const copyId = deterministicUlid(Date.parse(loser.updatedAt), `${key(collection, loser.id)}/${loserHash}`);
  return {
    ...loser,
    id: copyId,
    title,
    conflictOf: loser.id,
    ancestors: [],
    deletedAt: null,
  } as T;
}

interface Resolved<T> {
  records: T[];
  conflicts: ConflictCopy[];
}

/** Picks the result for one record ID from all versions seen. */
function resolve<T extends SyncMeta>(collection: CollectionName, versions: readonly T[]): Resolved<T> {
  // 1. Identical content counts once: keep the newest stamp, and everything any copy knew.
  const byHash = new Map<string, T>();
  for (const v of versions) {
    const h = contentHash(v);
    const seen = byHash.get(h);
    if (!seen) {
      byHash.set(h, v);
      continue;
    }
    const newer = compareVersions(v, seen) < 0 ? v : seen;
    const ancestors = [...new Set([...seen.ancestors, ...v.ancestors])].slice(0, LIMITS.ancestors);
    byHash.set(h, { ...newer, ancestors });
  }

  // 2. Drop versions another version is known to replace.
  const distinct = [...byHash.entries()];
  const survivors = distinct.filter(([h, v]) => !distinct.some(([, w]) => dominates(w, v, h)));
  survivors.sort(([, a], [, b]) => compareVersions(a, b));

  const [first, ...rest] = survivors;
  if (!first) return { records: [], conflicts: [] };
  const [, winnerVersion] = first;

  // 3. Concurrent edits: newest wins; the winner now also replaces the others.
  const absorbed = rest.flatMap(([h, v]) => [h, ...v.ancestors]);
  const winner = withStats(
    {
      ...winnerVersion,
      ancestors: [...new Set([...winnerVersion.ancestors, ...absorbed])].slice(0, LIMITS.ancestors),
    },
    versions,
  );

  const records: T[] = [winner];
  const conflicts: ConflictCopy[] = [];
  if (COPY_ON_CONFLICT.has(collection)) {
    for (const [h, loser] of rest) {
      if (loser.deletedAt !== null) continue; // a competing deletion leaves nothing to keep
      const copy = conflictCopy(collection, loser, h);
      records.push(copy);
      conflicts.push({ collection: collection as "prompts" | "notes", id: winner.id, copyId: copy.id });
    }
  }
  return { records, conflicts };
}

/**
 * Merges local data with other devices' files. Pure: the caller saves `data` and `base`
 * and, when `data` differs from this device's file in Drive, uploads a new one.
 */
export function merge(input: MergeInput): MergeResult {
  const nowMs = Date.parse(input.now);
  const remotes = input.remotes.filter((r) => r.deviceId !== input.deviceId);
  const fresh = remotes.filter((r) => nowMs - Date.parse(r.syncedAt) <= RETENTION_MS);
  const staleDevices = remotes.filter((r) => !fresh.includes(r)).map((r) => r.deviceId);
  const lastPull = input.base.lastPullAt === null ? -Infinity : Date.parse(input.base.lastPullAt);
  const anyNewerRemote = fresh.some((r) => Date.parse(r.syncedAt) > lastPull);

  const data = {} as Record<CollectionName, SyncMeta[]>;
  const hashes: Record<string, string> = {};
  const conflicts: ConflictCopy[] = [];

  for (const collection of COLLECTIONS) {
    const versionsById = new Map<string, SyncMeta[]>();
    const add = (record: SyncMeta): void => {
      const list = versionsById.get(record.id);
      if (list) list.push(record);
      else versionsById.set(record.id, [record]);
    };
    const localById = new Map(input.local[collection].map((r) => [r.id, r as SyncMeta]));
    for (const r of input.local[collection]) add(r);
    for (const remote of fresh) for (const r of remote[collection]) add(r);

    const out: SyncMeta[] = [];
    for (const [id, versions] of versionsById) {
      const local = localById.get(id);
      const onlyLocal = local !== undefined && versions.length === 1;
      if (onlyLocal && anyNewerRemote) {
        // Known at the last sync, unchanged here, and now gone from every newer device
        // file: another device deleted it and its tombstone has since been cleaned up.
        const baseHash = input.base.hashes[key(collection, id)];
        if (baseHash !== undefined && baseHash === contentHash(local)) continue;
      }
      for (const record of resolve(collection, versions).records) {
        if (record.deletedAt !== null && nowMs - Date.parse(record.deletedAt) > RETENTION_MS) continue;
        out.push(record);
      }
    }

    // Deduplicate conflict copies that arrived both from this merge and from another device.
    const unique = new Map<string, SyncMeta>();
    for (const record of out) {
      const seen = unique.get(record.id);
      unique.set(record.id, seen ? resolve(collection, [seen, record]).records[0] ?? record : record);
    }
    data[collection] = sortById([...unique.values()]);
    for (const record of data[collection]) {
      hashes[key(collection, record.id)] = contentHash(record);
      const original = (record as Partial<Prompt>).conflictOf;
      if (COPY_ON_CONFLICT.has(collection) && original && record.deletedAt === null) {
        conflicts.push({ collection: collection as "prompts" | "notes", id: original, copyId: record.id });
      }
    }
  }

  const merged = data as unknown as SyncedData;
  return {
    data: merged,
    base: { lastPullAt: fresh.length > 0 ? input.now : input.base.lastPullAt, hashes },
    conflicts,
    changed: !sameData(merged, input.local),
    staleDevices,
  };
}

/** True when two sets of synced data hold the same records (order ignored). */
export function sameData(a: SyncedData, b: SyncedData): boolean {
  return COLLECTIONS.every(
    (c) =>
      canonicalJson(sortById(a[c] as SyncMeta[])) === canonicalJson(sortById(b[c] as SyncMeta[])),
  );
}

/** This device's file for Drive. */
export function toDeviceFile(
  data: SyncedData,
  device: { deviceId: string; deviceName: string; now: Iso },
): DeviceFile {
  const pick = {} as SyncedData;
  for (const c of COLLECTIONS) (pick as unknown as Record<string, SyncMeta[]>)[c] = sortById(data[c] as SyncMeta[]);
  return {
    format: DEVICE_FILE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    syncedAt: device.now,
    ...pick,
  };
}

/** True when this device should upload a new file: its data differs from what Drive has. */
export function needsPush(data: SyncedData, ownFile: DeviceFile | null): boolean {
  return ownFile === null || !sameData(data, ownFile);
}
