// The local library on disk: ~/.claude-codex-buttons (or $CCB_HOME).
// Every change goes through LibraryStore.update, which holds the lock, re-reads the
// latest file, applies the change, validates it and writes it crash-safely. Two processes
// changing the library at the same time therefore never lose each other's changes.
import { readdir, rm, stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import {
  DATA_DIR_NAME,
  DEVICE_ID_RE,
  applyEdit,
  canonicalJson,
  hash,
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
  /** What was last written to each note's Markdown file, to recognise edits made elsewhere. */
  mirrorState: string;
}

/**
 * The data folder: $CCB_HOME if set, else ~/.claude-codex-buttons. An unfilled template
 * such as "${user_config.data_folder}" (an optional Claude Desktop setting left empty)
 * counts as unset.
 */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env["CCB_HOME"]?.trim();
  return fromEnv && !fromEnv.includes("${") ? fromEnv : join(homedir(), DATA_DIR_NAME);
}

export function storePaths(home: string): StorePaths {
  return {
    home,
    library: join(home, "library.json"),
    backup: join(home, "library.bak.json"),
    device: join(home, "device.json"),
    lock: join(home, ".lock"),
    notes: join(home, "notes"),
    mirrorState: join(home, "notes-mirror.json"),
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
  | { kind: "recovered"; brokenFile: string | null; errors: string[] }
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
        const { library } = await this.changeLocked(change, ctx);
        return library;
      },
      this.lockOptions,
    );
  }

  /**
   * Picks up notes edited directly in their Markdown files (in another editor) and
   * recreates mirror files that were deleted. Returns the number of notes imported.
   * update() does the same before every change, so an edit made in a file is never
   * overwritten by an unrelated change.
   */
  async importNoteEdits(): Promise<number> {
    const ctx = await this.editContext();
    return withLock(this.paths.lock, async () => (await this.changeLocked((lib) => lib, ctx)).imported, this.lockOptions);
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
    const backupText = await readText(this.paths.backup);
    const backup = backupText === null ? null : this.parse(backupText);

    if (text === null) {
      // No library.json. A valid backup means data exists: restore it rather than
      // starting over (and later overwriting that backup).
      if (backup?.kind === "ok") {
        await writeFileAtomic(this.paths.library, serialise(backup.library));
        return { library: backup.library, status: { kind: "recovered", brokenFile: null, errors: ["library.json was missing"] } };
      }
      if (backup?.kind === "read-only") return { library: null, status: backup };
      const library = seedStarterPack(emptyLibrary());
      await this.writeLibrary(library, null);
      await this.getDeviceUnlocked();
      return { library, status: { kind: "created" } };
    }

    const parsed = this.parse(text);
    if (parsed.kind === "ok") return { library: parsed.library, status: { kind: "ok" } };
    if (parsed.kind === "read-only") return { library: null, status: parsed };

    // Damaged. A backup from a newer version: change nothing, and open read-only.
    if (backup?.kind === "read-only") return { library: null, status: backup };
    // Keep a copy of the damaged file first; library.json is replaced atomically, so
    // there is never a moment without one.
    const brokenFile = join(this.paths.home, `library.broken-${timestampForFile(this.now())}.json`);
    await writeFileAtomic(brokenFile, text);
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

  /** The whole change cycle, with the lock held: read, import file edits, change, save, mirror. */
  private async changeLocked(
    change: (library: Library, ctx: EditContext) => Library | Promise<Library>,
    ctx: EditContext,
  ): Promise<{ library: Library; imported: number }> {
    const current = await this.readLocked();
    if (current.library === null) throw new ReadOnlyLibraryError((current.status as { foundVersion: number }).foundVersion);
    const { library: withImports, imported } = await this.importMirrorLocked(current.library, ctx);
    const checked = loadLibrary(await change(withImports, ctx));
    if (!checked.ok) throw new InvalidChangeError(checked.errors);
    if (checked.library === null) throw new InvalidChangeError(["schemaVersion must not be newer than this version"]);
    const next = checked.library;
    if (canonicalJson({ ...next, revision: 0 }) === canonicalJson({ ...current.library, revision: 0 })) {
      await this.mirrorNotes(current.library);
      return { library: current.library, imported };
    }
    const saved: Library = { ...next, revision: current.library.revision + 1 };
    await this.writeLibrary(saved, current.library);
    await this.mirrorNotes(saved);
    return { library: saved, imported };
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

  private async readMirrorState(): Promise<Record<string, string>> {
    const text = await readText(this.paths.mirrorState);
    if (text === null) return {};
    try {
      const parsed = JSON.parse(text) as { hashes?: Record<string, string> };
      return parsed.hashes && typeof parsed.hashes === "object" ? parsed.hashes : {};
    } catch {
      return {};
    }
  }

  /**
   * With the lock held: imports note files whose content differs from what was last
   * written to them (so they were edited elsewhere). Without a record of the last write
   * (older data folder), a file counts as edited only if it is newer than the note.
   */
  private async importMirrorLocked(library: Library, ctx: EditContext): Promise<{ library: Library; imported: number }> {
    if (!library.settings.notes.mirrorFiles) return { library, imported: 0 };
    const files = await this.listNoteFiles();
    const written = await this.readMirrorState();
    const edits = new Map<string, string>();
    for (const note of library.notes) {
      if (note.deletedAt !== null) continue;
      const file = files.get(note.id);
      if (!file) continue;
      const body = await readText(file);
      if (body === null || body === note.body) continue;
      const lastWritten = written[note.id];
      const editedElsewhere =
        lastWritten !== undefined ? hash(body) !== lastWritten : (await stat(file)).mtimeMs > Date.parse(note.updatedAt);
      if (editedElsewhere) edits.set(note.id, body);
    }
    if (edits.size === 0) return { library, imported: 0 };
    const notes = library.notes.map((n) => {
      const body = edits.get(n.id);
      return body !== undefined ? applyEdit(n, { ...n, body }, ctx) : n;
    });
    return { library: { ...library, notes }, imported: edits.size };
  }

  /**
   * With the lock held: writes each live note to its Markdown file, removes files of
   * deleted or renamed notes, and records what was written.
   */
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
    const before = await this.readMirrorState();
    const hashes: Record<string, string> = {};
    for (const note of library.notes) {
      const existing = byId.get(note.id) ?? [];
      const wanted = note.deletedAt === null ? noteFileName(note) : null;
      for (const name of existing) {
        if (name !== wanted) await rm(join(this.paths.notes, name), { force: true });
      }
      if (wanted === null) continue;
      const path = join(this.paths.notes, wanted);
      if ((await readText(path)) !== note.body) await writeFileAtomic(path, note.body);
      hashes[note.id] = hash(note.body);
    }
    if (canonicalJson(hashes) !== canonicalJson(before)) {
      await writeFileAtomic(this.paths.mirrorState, `${JSON.stringify({ hashes }, null, 2)}\n`);
    }
  }
}
