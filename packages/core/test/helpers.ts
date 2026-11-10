import {
  applyEdit,
  deleteRecord,
  emptyLibrary,
  merge,
  newMeta,
  toDeviceFile,
  ulid,
  type DeviceFile,
  type EditContext,
  type Note,
  type Prompt,
  type SyncBase,
  type SyncedData,
} from "../src/index.js";
import { emptyBase } from "../src/sync/merge.js";

/** A seeded random source so tests are repeatable. */
export function seededRandom(seed = 42): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const rand = seededRandom();

export function at(minutes: number): string {
  return new Date(Date.parse("2026-11-10T08:00:00.000Z") + minutes * 60_000).toISOString();
}

export function ctx(deviceId: string, minutes: number): EditContext {
  return { deviceId, now: at(minutes) };
}

export function newPrompt(c: EditContext, title: string, body = `Body of ${title}`): Prompt {
  return {
    ...newMeta(ulid(Date.parse(c.now), rand), c),
    title,
    body,
    category: null,
    tags: [],
    favorite: false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: c.now,
    conflictOf: null,
  };
}

export function newNote(c: EditContext, body: string): Note {
  return {
    ...newMeta(ulid(Date.parse(c.now), rand), c),
    title: body.split("\n")[0] || "Untitled note",
    body,
    pinned: false,
    createdAt: c.now,
    conflictOf: null,
  };
}

export function emptyData(): SyncedData {
  const { prompts, categories, variables, buttons, notes, sharedSettings } = emptyLibrary();
  return { prompts, categories, variables, buttons, notes, sharedSettings };
}

/** A simulated PC: its local data, sync memory and last uploaded file. */
export class Device {
  data: SyncedData = emptyData();
  base: SyncBase = emptyBase();
  file: DeviceFile | null = null;

  constructor(readonly id: string) {}

  edit<T extends Prompt | Note>(kind: "prompts" | "notes", id: string, change: Partial<T>, minutes: number): void {
    const list = this.data[kind] as T[];
    const prev = list.find((r) => r.id === id);
    if (!prev) throw new Error(`${this.id} has no ${kind}/${id}`);
    const next = applyEdit(prev, { ...prev, ...change }, ctx(this.id, minutes));
    this.data = { ...this.data, [kind]: list.map((r) => (r.id === id ? next : r)) };
  }

  add(kind: "prompts" | "notes", record: Prompt | Note): void {
    this.data = { ...this.data, [kind]: [...(this.data[kind] as (Prompt | Note)[]), record] };
  }

  remove(kind: "prompts" | "notes", id: string, minutes: number): void {
    const list = this.data[kind] as (Prompt | Note)[];
    this.data = {
      ...this.data,
      [kind]: list.map((r) => (r.id === id ? deleteRecord(r, ctx(this.id, minutes)) : r)),
    };
  }

  /** Pull everyone else's files from the shared "Drive", merge, then push our own file. */
  sync(drive: Map<string, DeviceFile>, minutes: number): ReturnType<typeof merge> {
    const result = merge({
      local: this.data,
      remotes: [...drive.values()],
      base: this.base,
      now: at(minutes),
      deviceId: this.id,
    });
    this.data = result.data;
    this.base = result.base;
    this.file = toDeviceFile(this.data, { deviceId: this.id, deviceName: this.id, now: at(minutes) });
    drive.set(this.id, this.file);
    return result;
  }

  note(id: string): Note | undefined {
    return this.data.notes.find((n) => n.id === id);
  }

  prompt(id: string): Prompt | undefined {
    return this.data.prompts.find((p) => p.id === id);
  }
}
