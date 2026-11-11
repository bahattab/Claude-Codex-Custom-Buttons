// Simulated computers for sync tests: each has its own data folder, store and engine, and
// all of them share one remote and one virtual clock.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COLLECTIONS, canonicalJson, type Library, type SyncedData } from "@ccb/core";
import { LibraryStore } from "@ccb/store";
import { OfflineError, SyncEngine, type PullResult, type Remote, type RemoteProvider, type Scheduler } from "@ccb/sync";

/** A virtual clock whose timers run only when the test advances it. */
export class TestClock implements Scheduler {
  private t = Date.parse("2026-11-11T09:00:00.000Z");
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): Date {
    return new Date(this.t);
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  /** Milliseconds until each pending timer, soonest first. */
  pending(): number[] {
    return [...this.timers.values()].map((x) => x.at - this.t).sort((a, b) => a - b);
  }
  /** Moves time on by `ms`, running each timer that falls due, in order. */
  async advance(ms: number, settle: () => Promise<void>): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      await settle();
      const due = [...this.timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = Math.max(this.t, due[1].at);
      due[1].fn();
    }
    this.t = end;
    await settle();
  }
  tick(ms: number): void {
    this.t += ms;
  }
}

/** An in-memory remote with a change feed (like Drive's) and a switch to go offline. */
export class MemoryRemote {
  files = new Map<string, { text: string; version: number }>();
  version = 0;
  offline = false;
  reads = 0;
  pushes: Array<{ deviceId: string; text: string }> = [];

  for(location = "memory"): Remote {
    return {
      kind: "drive-api",
      location,
      pull: async (cursor: string | null, ownDeviceId: string): Promise<PullResult> => {
        if (this.offline) throw new OfflineError("offline");
        const since = cursor === null ? -1 : Number(cursor);
        const changed = [...this.files.entries()]
          .filter(([id, f]) => f.version > since && id !== ownDeviceId)
          .map(([deviceId, f]) => {
            this.reads++;
            return { deviceId, text: f.text };
          });
        return { changed, removed: [], cursor: String(this.version), full: cursor === null, ownMissing: !this.files.has(ownDeviceId) };
      },
      push: async (deviceId: string, text: string): Promise<void> => {
        if (this.offline) throw new OfflineError("offline");
        this.files.set(deviceId, { text, version: ++this.version });
        this.pushes.push({ deviceId, text });
      },
    };
  }
}

export interface Computer {
  home: string;
  store: LibraryStore;
  engine: SyncEngine;
  /** Applies a core op (which returns { ok, value: { library } }) through the store. */
  edit(op: (lib: Library, ctx: { now: string; deviceId: string }, random: () => number) => { ok: boolean; value?: { library: Library }; errors?: string[] }): Promise<void>;
  data(): Promise<Library>;
}

const homes: string[] = [];

export async function computer(clock: TestClock, provider: RemoteProvider): Promise<Computer> {
  const home = await mkdtemp(join(tmpdir(), "ccb-sync-"));
  homes.push(home);
  const store = new LibraryStore({ home, now: () => clock.now() });
  const engine = new SyncEngine({ store, remote: provider, scheduler: clock });
  return {
    home,
    store,
    engine,
    async edit(op) {
      await store.update((lib, ctx) => {
        const r = op(lib, ctx, store.randomSource());
        if (!r.ok || !r.value) throw new Error((r.errors ?? []).join("; "));
        return r.value.library;
      });
      clock.tick(1000);
    },
    async data() {
      const { library } = await store.read();
      if (!library) throw new Error("no library");
      return library;
    },
  };
}

export async function cleanup(): Promise<void> {
  while (homes.length) await rm(homes.pop() as string, { recursive: true, force: true });
}

/** The synced data in a form that compares equal across computers. */
export function synced(data: SyncedData): string {
  const out: Record<string, unknown> = {};
  for (const c of COLLECTIONS) out[c] = [...data[c]].sort((a, b) => a.id.localeCompare(b.id));
  return canonicalJson(out);
}
