// The sync engine: keeps this computer's library and every other device's file in step,
// automatically. One run = pull what changed, merge it in (core's merge), and upload this
// device's own file when its data differs from what was last uploaded.
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  COLLECTIONS,
  contentHash,
  emptyBase,
  merge,
  toDeviceFile,
  validateDeviceFile,
  type DeviceFile,
  type Iso,
  type Library,
  type SyncBase,
  type SyncedData,
} from "@ccb/core";
import { LockTimeoutError, readText, withLock, writeFileAtomic, type LibraryStore } from "@ccb/store";

import { AuthError, OfflineError, type Remote } from "./remote.js";

/** Why sync can't run right now, as shown to the person. */
export type Unavailable =
  | { state: "off" }
  | { state: "not-set-up"; reason: string }
  | { state: "signed-out"; reason: string }
  | { state: "no-credential-store"; reason: string };

/** Picks the remote for the library's settings, or says why there is none. */
export type RemoteProvider = (library: Library) => Promise<Remote | Unavailable>;

export type SyncState = "off" | "not-set-up" | "signed-out" | "no-credential-store" | "idle" | "syncing" | "offline" | "error";

export interface SyncStatus {
  mode: Library["settings"]["sync"]["mode"];
  state: SyncState;
  /** Records changed here since the last upload. */
  pending: number;
  /** Which records are pending, as "collection/id" (at most 500), for per-note indicators. */
  pendingKeys: string[];
  /** Conflict copies waiting to be resolved. */
  conflicts: number;
  lastPullAt: Iso | null;
  lastPushAt: Iso | null;
  /** Set while offline or after an error: when the next attempt runs. */
  nextRetryAt: Iso | null;
  /** The last problem, in words. */
  message: string | null;
  /** Other devices seen in the last pull. */
  devices: Array<{ deviceId: string; deviceName: string; syncedAt: Iso }>;
  /** Device files ignored because they were not updated for 180 days. */
  staleDevices: string[];
  /** Device files that failed validation (never merged). */
  invalidDevices: Array<{ deviceId: string; error: string }>;
}

/** What is remembered between runs, in sync-state.json. */
interface StateFile {
  version: 1;
  /** The remote the cursor and cache belong to. */
  location: string | null;
  cursor: string | null;
  base: SyncBase;
  /** Content hash of each record as last uploaded, keyed "collection/id"; null before the first upload. */
  pushed: Record<string, string> | null;
  lastPullAt: Iso | null;
  lastPushAt: Iso | null;
  /** Last outcome, so every process on this computer can report it. */
  outcome: { state: SyncState; message: string | null; at: Iso; nextRetryAt: Iso | null } | null;
  devices: SyncStatus["devices"];
  staleDevices: string[];
  invalidDevices: SyncStatus["invalidDevices"];
}

function freshState(): StateFile {
  return {
    version: 1,
    location: null,
    cursor: null,
    base: emptyBase(),
    pushed: null,
    lastPullAt: null,
    lastPushAt: null,
    outcome: null,
    devices: [],
    staleDevices: [],
    invalidDevices: [],
  };
}

/** Timers, injectable so tests control time. */
export interface Scheduler {
  now(): Date;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  now: () => new Date(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export const BACKOFF_START_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export interface EngineOptions {
  store: LibraryStore;
  remote: RemoteProvider;
  scheduler?: Scheduler;
  /** How long to wait for another process's sync on this computer (default 2 minutes). */
  lockTimeoutMs?: number;
  /** Called after every run with the new status; `merged` is true when other devices' changes came in. */
  onStatus?: (status: SyncStatus, info: { merged: boolean }) => void;
}

function pickData(library: SyncedData): SyncedData {
  return {
    prompts: library.prompts,
    categories: library.categories,
    variables: library.variables,
    buttons: library.buttons,
    notes: library.notes,
    sharedSettings: library.sharedSettings,
  };
}

function hashes(data: SyncedData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of COLLECTIONS) for (const r of data[c]) out[`${c}/${r.id}`] = contentHash(r);
  return out;
}

function pendingKeys(data: SyncedData, pushed: Record<string, string> | null): string[] {
  const now = hashes(data);
  if (pushed === null) return Object.keys(now);
  const out: string[] = [];
  for (const [k, h] of Object.entries(now)) if (pushed[k] !== h) out.push(k);
  for (const k of Object.keys(pushed)) if (!(k in now)) out.push(k);
  return out;
}

function countPending(data: SyncedData, pushed: Record<string, string> | null): number {
  return pendingKeys(data, pushed).length;
}

function countConflicts(data: SyncedData): number {
  return [...data.prompts, ...data.notes].filter((r) => r.conflictOf && r.deletedAt === null).length;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class NoChange extends Error {}

export class SyncEngine {
  private readonly store: LibraryStore;
  private readonly provider: RemoteProvider;
  private readonly clock: Scheduler;
  private readonly onStatus: ((s: SyncStatus, info: { merged: boolean }) => void) | undefined;
  private merged = false;
  private readonly lockTimeoutMs: number;
  private readonly statePath: string;
  private readonly cacheDir: string;
  private readonly lockPath: string;

  private running: Promise<SyncStatus> | null = null;
  private again = false;
  private pushTimer: unknown = null;
  private pullTimer: unknown = null;
  private retryTimer: unknown = null;
  private failures = 0;
  private delays = { pushMs: 2000, pullMs: 60_000 };
  private started = false;

  constructor(opts: EngineOptions) {
    this.store = opts.store;
    this.provider = opts.remote;
    this.clock = opts.scheduler ?? realScheduler;
    this.onStatus = opts.onStatus;
    this.lockTimeoutMs = opts.lockTimeoutMs ?? 120_000;
    this.statePath = join(this.store.paths.home, "sync-state.json");
    this.cacheDir = join(this.store.paths.home, "sync-cache");
    this.lockPath = join(this.store.paths.home, ".sync.lock");
  }

  /** Syncs now, then keeps syncing: every sync.intervalSeconds and after each change. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.run();
  }

  stop(): void {
    this.started = false;
    this.again = false; // no follow-up run after stopping
    for (const t of [this.pushTimer, this.pullTimer, this.retryTimer]) if (t !== null) this.clock.clearTimeout(t);
    this.pushTimer = this.pullTimer = this.retryTimer = null;
  }

  /** Something changed locally: upload it after sync.pushDelayMs, so a burst of edits is one upload. */
  notifyChanged(): void {
    if (!this.started) return;
    if (this.pushTimer !== null) this.clock.clearTimeout(this.pushTimer);
    this.pushTimer = this.clock.setTimeout(() => {
      this.pushTimer = null;
      void this.run();
    }, this.delays.pushMs);
  }

  /** Runs a sync now and returns the outcome. Concurrent calls share one run plus one follow-up. */
  syncNow(): Promise<SyncStatus> {
    return this.run();
  }

  /** Resolves when no run is in progress (for tests and orderly shutdown). */
  async idle(): Promise<void> {
    while (this.running) await this.running.catch(() => undefined);
  }

  /** The current status, from what is saved on this computer (shared by every process). */
  async status(): Promise<SyncStatus> {
    const { library } = await this.store.read();
    const state = await this.loadState();
    if (!library) {
      return this.describe(state, null, { state: "error", message: "The library is from a newer version; update the plugin." });
    }
    const remote = await this.provider(library);
    if (!("pull" in remote)) return this.describe(state, library, { state: remote.state, message: "reason" in remote ? remote.reason : null });
    const outcome = state.outcome ?? { state: "idle" as const, message: null };
    return this.describe(state, library, this.running ? { ...outcome, state: "syncing" } : outcome);
  }

  private run(): Promise<SyncStatus> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const go = async (): Promise<SyncStatus> => {
      let status = await this.once();
      while (this.again) {
        this.again = false;
        status = await this.once();
      }
      return status;
    };
    this.running = go().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** One pull-merge-push, holding the sync lock so this computer's processes take turns. */
  private async once(): Promise<SyncStatus> {
    let status: SyncStatus;
    this.merged = false;
    try {
      status = await withLock(this.lockPath, () => this.onceLocked(), { timeoutMs: this.lockTimeoutMs });
    } catch (error) {
      // Another process on this computer is still syncing: leave its state alone.
      if (error instanceof LockTimeoutError) status = { ...(await this.status()), state: "syncing" };
      else status = await this.record({ state: "error", message: message(error) });
    }
    this.schedule(status);
    this.onStatus?.(status, { merged: this.merged });
    return status;
  }

  private async onceLocked(): Promise<SyncStatus> {
    const { library } = await this.store.read();
    if (!library) return this.record({ state: "error", message: "The library is from a newer version; update the plugin." });
    this.noteDelays(library);
    // Notes edited in their Markdown files (in another editor) sync like any other edit.
    await this.store.importNoteEdits();
    const remote = await this.provider(library);
    if (!("pull" in remote)) return this.record({ state: remote.state, message: "reason" in remote ? remote.reason : null });

    const state = await this.loadState();
    if (state.location !== remote.location) {
      // A different Drive folder or account: start over, keeping only local data.
      Object.assign(state, { ...freshState(), location: remote.location });
      await rm(this.cacheDir, { recursive: true, force: true });
    }
    const device = await this.store.getDevice();

    try {
      // 1. Pull: update the local copy of every other device's file.
      const pulled = await remote.pull(state.cursor, device.deviceId);
      await mkdir(this.cacheDir, { recursive: true });
      if (pulled.full) {
        const keep = new Set(pulled.changed.map((f) => f.deviceId));
        for (const name of await readdir(this.cacheDir)) {
          if (!keep.has(name.replace(/\.json$/, ""))) await rm(join(this.cacheDir, name), { force: true });
        }
      }
      for (const id of pulled.removed) await rm(join(this.cacheDir, `${id}.json`), { force: true });
      for (const f of pulled.changed) {
        if (f.deviceId === device.deviceId) continue; // never merge our own file back in
        await writeFileAtomic(join(this.cacheDir, `${f.deviceId}.json`), f.text);
      }

      // 2. Merge every device file (not just the changed ones: merge needs them all).
      const { remotes, invalid } = await this.readCache(device.deviceId);
      const now = this.clock.now().toISOString();
      let result: ReturnType<typeof merge> | null = null;
      try {
        await this.store.update((lib) => {
          result = merge({ local: pickData(lib), remotes, base: state.base, now, deviceId: device.deviceId });
          if (!result.changed) throw new NoChange();
          return { ...lib, ...result.data };
        });
      } catch (error) {
        if (!(error instanceof NoChange)) throw error;
      }
      const merged = result as ReturnType<typeof merge> | null;
      if (merged) {
        state.base = merged.base;
        this.merged = merged.changed;
      }
      // Our own file is gone (deleted or trashed in Drive, or the folder is new): upload it again.
      if (pulled.ownMissing) state.pushed = null;
      state.cursor = pulled.cursor;
      state.lastPullAt = now;
      state.devices = remotes.map((r) => ({ deviceId: r.deviceId, deviceName: r.deviceName, syncedAt: r.syncedAt }));
      state.staleDevices = merged?.staleDevices ?? [];
      state.invalidDevices = invalid;
      await this.saveState(state);

      // 3. Push: upload this device's file if its data differs from the last upload.
      const after = (await this.store.read()).library ?? library;
      const data = pickData(after);
      const current = hashes(data);
      // Re-upload at least weekly even with no changes, so other devices don't take this
      // one for stale (unseen for 180 days) while it is still in use.
      const recent = state.lastPushAt !== null && Date.parse(now) - Date.parse(state.lastPushAt) < 7 * 24 * 3600_000;
      const unchanged = state.pushed !== null && countPending(data, state.pushed) === 0 && recent;
      if (!unchanged) {
        const file = toDeviceFile(data, { deviceId: device.deviceId, deviceName: device.deviceName.slice(0, 60) || "Computer", now });
        await remote.push(device.deviceId, `${JSON.stringify(file)}\n`);
        state.pushed = current;
        state.lastPushAt = now;
      }
      this.failures = 0;
      state.outcome = { state: "idle", message: null, at: now, nextRetryAt: null };
      await this.saveState(state);
      return this.describe(state, after, state.outcome);
    } catch (error) {
      await this.saveState(state); // keep the cursor and base already reached
      if (error instanceof AuthError) return this.record({ state: "signed-out", message: error.message });
      if (error instanceof OfflineError) return this.record({ state: "offline", message: error.message }, true);
      return this.record({ state: "error", message: message(error) }, true);
    }
  }

  private async readCache(ownId: string): Promise<{ remotes: DeviceFile[]; invalid: SyncStatus["invalidDevices"] }> {
    const remotes: DeviceFile[] = [];
    const invalid: SyncStatus["invalidDevices"] = [];
    let names: string[] = [];
    try {
      names = (await readdir(this.cacheDir)).filter((n) => n.endsWith(".json")).sort();
    } catch {
      // no cache yet
    }
    for (const name of names) {
      const deviceId = name.replace(/\.json$/, "");
      if (deviceId === ownId) continue;
      const text = await readText(join(this.cacheDir, name));
      if (text === null) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        invalid.push({ deviceId, error: "not valid JSON" });
        continue;
      }
      const checked = validateDeviceFile(raw);
      if (!checked.ok) invalid.push({ deviceId, error: checked.errors.slice(0, 3).join("; ") });
      else if (checked.value.deviceId !== deviceId) invalid.push({ deviceId, error: `file names device ${checked.value.deviceId}` });
      else remotes.push(checked.value);
    }
    return { remotes, invalid };
  }

  /** Saves a failed or unavailable outcome; `retry` schedules the next attempt with backoff. */
  private async record(outcome: { state: SyncState; message: string | null }, retry = false): Promise<SyncStatus> {
    const state = await this.loadState();
    let nextRetryAt: Iso | null = null;
    if (retry) {
      this.failures++;
      nextRetryAt = new Date(this.clock.now().getTime() + this.backoffMs()).toISOString();
    }
    state.outcome = { ...outcome, at: this.clock.now().toISOString(), nextRetryAt };
    await this.saveState(state).catch(() => undefined);
    const { library } = await this.store.read().catch(() => ({ library: null }));
    return this.describe(state, library, state.outcome);
  }

  /** 2 s, 4 s, 8 s ... capped at 5 minutes. */
  backoffMs(): number {
    return Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** Math.max(0, this.failures - 1));
  }

  private schedule(status: SyncStatus): void {
    if (!this.started) return;
    if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (status.nextRetryAt !== null) {
      const ms = Math.max(0, Date.parse(status.nextRetryAt) - this.clock.now().getTime());
      this.retryTimer = this.clock.setTimeout(() => {
        this.retryTimer = null;
        void this.run();
      }, ms);
    }
    if (this.pullTimer !== null) this.clock.clearTimeout(this.pullTimer);
    this.pullTimer = this.clock.setTimeout(() => {
      this.pullTimer = null;
      void this.run();
    }, this.delays.pullMs);
  }

  /** Remembers the timing settings, read on every run, so timers are set at once. */
  private noteDelays(library: Library): void {
    this.delays = { pushMs: library.settings.sync.pushDelayMs, pullMs: library.settings.sync.intervalSeconds * 1000 };
  }

  private describe(state: StateFile, library: Library | null, outcome: { state: SyncState; message: string | null; nextRetryAt?: Iso | null }): SyncStatus {
    return {
      mode: library?.settings.sync.mode ?? "off",
      state: outcome.state,
      pending: library ? countPending(pickData(library), state.pushed) : 0,
      pendingKeys: library ? pendingKeys(pickData(library), state.pushed).slice(0, 500) : [],
      conflicts: library ? countConflicts(library) : 0,
      lastPullAt: state.lastPullAt,
      lastPushAt: state.lastPushAt,
      nextRetryAt: outcome.nextRetryAt ?? null,
      message: outcome.message,
      devices: state.devices,
      staleDevices: state.staleDevices,
      invalidDevices: state.invalidDevices,
    };
  }

  private async loadState(): Promise<StateFile> {
    const text = await readText(this.statePath);
    if (text === null) return freshState();
    try {
      const parsed = JSON.parse(text) as Partial<StateFile>;
      if (parsed.version !== 1) return freshState();
      return { ...freshState(), ...parsed, base: { ...emptyBase(), ...(parsed.base ?? {}) } } as StateFile;
    } catch {
      return freshState(); // a damaged state file only costs a full pull
    }
  }

  private async saveState(state: StateFile): Promise<void> {
    await writeFileAtomic(this.statePath, `${JSON.stringify(state, null, 2)}\n`);
  }
}
