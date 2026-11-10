// The local library on disk: ~/.claude-codex-buttons (or $CCB_HOME).
// Every change goes through LibraryStore.update, which holds the lock, re-reads the
// latest file, applies the change, validates it and writes it crash-safely. Two processes
// changing the library at the same time therefore never lose each other's changes.
import { readdir, rename, rm, stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import {
  DATA_DIR_NAME,
  DEVICE_ID_RE,
  applyEdit,
  canonicalJson,
  emptyLibrary,
  loadLibrary,
  newDeviceId,
  seedStarterPack,
  slugify,
  type EditContext,
  type Library,
  type Note,
} from "@ccb/core";
import { exists, readText, secureRandom, withLock, writeFileAtomic, type LockOptions } from "./fsutil.js";

export interface StorePaths {
  home: string;
  library: string;
  backup: string;
  device: string;
  lock: string;
  notes: string;
}

/** The data folder: $CCB_HOME if set, else ~/.claude-codex-buttons. */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env["CCB_HOME"]?.trim();
  return fromEnv ? fromEnv : join(homedir(), DATA_DIR_NAME);
}

export function storePaths(home: string): StorePaths {
  return {
    home,
    library: join(home, "library.json"),
    backup: join(home, "library.bak.json"),
    device: join(home, "device.json"),
    lock: join(home, ".lock"),
    notes: join(home, "notes"),
  };
}

export interface Device {
  deviceId: string;
  deviceName: string;
}

export class ReadOnlyLibraryError extends Error {
  constructor(readonly foundVersion: number) {
    super(`library.json uses schema version ${foundVersion}, which is newer than this version understands. Update Claude Codex Custom Buttons to make changes.`);
    this.name = "ReadOnlyLibraryError";
  }
}

export class InvalidChangeError extends Error {
  constructor(readonly errors: string[]) {
    super(`The change was rejected: ${errors.join("; ")}`);
    this.name = "InvalidChangeError";
  }
}

/** What happened when the library was read. */
export type ReadStatus =
  | { kind: "ok" }
  | { kind: "created" }
  | { kind: "recovered"; brokenFile: string; errors: string[] }
  | { kind: "reset"; brokenFile: string; errors: string[] }
  | { kind: "read-only"; foundVersion: number };

export interface ReadResult {
  /** Null only when the library is read-only (a newer schema version). */
  library: Library | null;
  status: ReadStatus;
}

export interface StoreOptions {
  home?: string;
  now?: () => Date;
  random?: () => number;
  lock?: LockOptions;
}

function serialise(library: Library): string {
  return `${JSON.stringify(library, null, 2)}\n`;
}

function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

/** The Markdown mirror file name of a note: "<slug>--<id>.md". */
export function noteFileName(note: Pick<Note, "id" | "title">): string {
  return `${slugify(note.title)}--${note.id}.md`;
}

const NOTE_FILE_RE = /--([0-7][0-9A-HJKMNP-TV-Z]{25})\.md$/;

export class LibraryStore {
  readonly paths: StorePaths;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly lockOptions: LockOptions;
  private device: Device | null = null;

  constructor(opts: StoreOptions = {}) {
    this.paths = storePaths(opts.home ?? resolveHome());
    this.now = opts.now ?? (() => new Date());
    this.random = opts.random ?? secureRandom;
    this.lockOptions = opts.lock ?? {};
  }

  /** This computer's device identity, created on first use. */
  async getDevice(): Promise<Device> {
    if (this.device) return this.device;
    const text = await readText(this.paths.device);
    if (text !== null) {
      try {
        const parsed = JSON.parse(text) as Partial<Device>;
        if (typeof parsed.deviceId === "string" && DEVICE_ID_RE.test(parsed.deviceId)) {
          this.device = { deviceId: parsed.deviceId, deviceName: parsed.deviceName?.trim() || hostname() };
          return this.device;
        }
      } catch {
        // fall through: replace an unreadable device file
      }
    }
    return withLock(this.paths.lock, async () => {
      const again = await readText(this.paths.device);
      if (again !== null) {
        try {
          const parsed = JSON.parse(again) as Device;
          if (DEVICE_ID_RE.test(parsed.deviceId)) return (this.device = parsed);
        } catch {
          // replace below
        }
      }
      const device: Device = { deviceId: newDeviceId(this.random), deviceName: hostname().slice(0, 60) || "Computer" };
      await writeFileAtomic(this.paths.device, `${JSON.stringify(device, null, 2)}\n`);
      return (this.device = device);
    }, this.lockOptions);
  }

  /** Who is editing, and when. */
  async editContext(): Promise<EditContext> {
    return { deviceId: (await this.getDevice()).deviceId, now: this.now().toISOString() };
  }

  randomSource(): () => number {
    return this.random;
  }

  /**
   * Reads the library. Creates it (with the starter pack) on first run, recovers from the
   * backup if the file is damaged, and reports a newer schema as read-only.
   */
  async read(): Promise<ReadResult> {
    const text = await readText(this.paths.library);
    if (text === null) return withLock(this.paths.lock, () => this.readLocked(), this.lockOptions);
    const parsed = this.parse(text);
    if (parsed.kind === "ok") return { library: parsed.library, status: { kind: "ok" } };
    if (parsed.kind === "read-only") return { library: null, status: parsed };
    // Damaged: repair under the lock (another process may be repairing too).
    return withLock(this.paths.lock, () => this.readLocked(), this.lockOptions);
  }

  /**
   * Applies `change` to the latest library while holding the lock, validates the result,
   * and saves it. Returns the saved library. `change` may throw to cancel.
   */
  async update(change: (library: Library, ctx: EditContext) => Library | Promise<Library>): Promise<Library> {
    const ctx = await this.editContext();
    return withLock(
      this.paths.lock,
      async () => {
        const current = await this.readLocked();
        if (current.library === null) throw new ReadOnlyLibraryError((current.status as { foundVersion: number }).foundVersion);
        const changed = await change(current.library, ctx);
        const checked = loadLibrary(changed);
        if (!checked.ok) throw new InvalidChangeError(checked.errors);
        if (checked.library === null) throw new InvalidChangeError(["schemaVersion must not be newer than this version"]);
        const next = checked.library;
        if (canonicalJson({ ...next, revision: 0 }) === canonicalJson({ ...current.library, revision: 0 })) {
          return current.library;
        }
        const saved: Library = { ...next, revision: current.library.revision + 1 };
        await this.writeLibrary(saved, current.library);
        await this.mirrorNotes(saved);
        return saved;
      },
      this.lockOptions,
    );
  }

  /**
   * Picks up notes edited directly in their Markdown files (in another editor) and
   * recreates mirror files that were deleted. Returns the number of notes imported.
   */
  async importNoteEdits(): Promise<number> {
    const { library } = await this.read();
    if (library === null || !library.settings.notes.mirrorFiles) return 0;
    const files = await this.listNoteFiles();
    const edits: Array<{ id: string; body: string }> = [];
    for (const note of library.notes) {
      if (note.deletedAt !== null) continue;
      const file = files.get(note.id);
      if (!file) continue;
      const info = await stat(file);
      if (info.mtimeMs <= Date.parse(note.updatedAt)) continue;
      const body = (await readText(file)) ?? note.body;
      if (body !== note.body) edits.push({ id: note.id, body });
    }
    if (edits.length > 0) {
      await this.update((lib, ctx) => ({
        ...lib,
        notes: lib.notes.map((n) => {
          const edit = edits.find((e) => e.id === n.id);
          return edit && n.deletedAt === null ? applyEdit(n, { ...n, body: edit.body }, ctx) : n;
        }),
      }));
    } else {
      await this.mirrorNotes(library);
    }
    return edits.length;
  }

  // --- internals ----------------------------------------------------------------------

  private parse(
    text: string,
  ):
    | { kind: "ok"; library: Library }
    | { kind: "read-only"; foundVersion: number }
    | { kind: "invalid"; errors: string[] } {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return { kind: "invalid", errors: [`library.json is not valid JSON: ${(error as Error).message}`] };
    }
    const loaded = loadLibrary(raw);
    if (!loaded.ok) return { kind: "invalid", errors: loaded.errors };
    if (loaded.readOnly) return { kind: "read-only", foundVersion: loaded.foundVersion };
    return { kind: "ok", library: loaded.library };
  }

  /** Read with the lock already held: create, recover or reset as needed. */
  private async readLocked(): Promise<ReadResult> {
    const text = await readText(this.paths.library);
    if (text === null) {
      const library = seedStarterPack(emptyLibrary());
      await this.writeLibrary(library, null);
      await this.getDeviceUnlocked();
      return { library, status: { kind: "created" } };
    }
    const parsed = this.parse(text);
    if (parsed.kind === "ok") return { library: parsed.library, status: { kind: "ok" } };
    if (parsed.kind === "read-only") return { library: null, status: parsed };

    const brokenFile = join(this.paths.home, `library.broken-${timestampForFile(this.now())}.json`);
    await rename(this.paths.library, brokenFile);
    const backupText = await readText(this.paths.backup);
    const backup = backupText === null ? null : this.parse(backupText);
    if (backup?.kind === "ok") {
      await writeFileAtomic(this.paths.library, serialise(backup.library));
      return { library: backup.library, status: { kind: "recovered", brokenFile, errors: parsed.errors } };
    }
    const fresh = seedStarterPack(emptyLibrary());
    await writeFileAtomic(this.paths.library, serialise(fresh));
    return { library: fresh, status: { kind: "reset", brokenFile, errors: parsed.errors } };
  }

  /** Device creation for use while the lock is already held. */
  private async getDeviceUnlocked(): Promise<void> {
    if (await exists(this.paths.device)) return;
    const device: Device = { deviceId: newDeviceId(this.random), deviceName: hostname().slice(0, 60) || "Computer" };
    await writeFileAtomic(this.paths.device, `${JSON.stringify(device, null, 2)}\n`);
    this.device = device;
  }

  /** Saves the library; the previous valid version becomes the backup. */
  private async writeLibrary(library: Library, previous: Library | null): Promise<void> {
    if (previous !== null) await writeFileAtomic(this.paths.backup, serialise(previous));
    await writeFileAtomic(this.paths.library, serialise(library));
  }

  private async listNoteFiles(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    let names: string[];
    try {
      names = await readdir(this.paths.notes);
    } catch {
      return files;
    }
    for (const name of names) {
      const match = NOTE_FILE_RE.exec(name);
      if (match?.[1]) files.set(match[1], join(this.paths.notes, name));
    }
    return files;
  }

  /** Writes each live note to its Markdown file and removes files of deleted or renamed notes. */
  private async mirrorNotes(library: Library): Promise<void> {
    if (!library.settings.notes.mirrorFiles) return;
    let names: string[] = [];
    try {
      names = await readdir(this.paths.notes);
    } catch {
      // created on first write
    }
    const byId = new Map<string, string[]>();
    for (const name of names) {
      const match = NOTE_FILE_RE.exec(name);
      if (!match?.[1]) continue;
      byId.set(match[1], [...(byId.get(match[1]) ?? []), name]);
    }
    for (const note of library.notes) {
      const existing = byId.get(note.id) ?? [];
      const wanted = note.deletedAt === null ? noteFileName(note) : null;
      for (const name of existing) {
        if (name !== wanted) await rm(join(this.paths.notes, name), { force: true });
      }
      if (wanted === null) continue;
      const path = join(this.paths.notes, wanted);
      if ((await readText(path)) !== note.body) await writeFileAtomic(path, note.body);
    }
  }
}
