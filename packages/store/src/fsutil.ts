// Small file-system helpers: crash-safe writes, a cross-process lock and secure randomness.
import { randomBytes } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Uniform random numbers in [0, 1) from the operating system's secure generator. */
export function secureRandom(): number {
  return randomBytes(4).readUInt32BE(0) / 2 ** 32;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Writes a file so that readers see either the old content or the new content, never a
 * mix: write a temporary file in the same folder, flush it to disk, then rename it over
 * the target. `mode` applies to new files (0o600 = readable only by this user).
 */
export async function writeFileAtomic(path: string, text: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const handle = await open(tmp, "w", mode);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export class LockTimeoutError extends Error {
  constructor(readonly lockPath: string) {
    super(`Timed out waiting for the library lock (${lockPath}). Another ccb process may be stuck; run "ccb doctor".`);
    this.name = "LockTimeoutError";
  }
}

export interface LockOptions {
  /** Give up after this long. */
  timeoutMs?: number;
  /** A lock older than this, or held by a process that no longer exists, is broken. */
  staleMs?: number;
}

interface LockInfo {
  pid: number;
  at: number;
  token: string;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * True when the lock at `path` is held. A lock is abandoned when its holder process no
 * longer exists, or when the holder stopped refreshing it for `staleMs` (holders refresh
 * the file's modification time every few seconds, so a slow but live holder keeps it).
 */
export async function lockIsHeld(path: string, staleMs = 30_000): Promise<boolean> {
  return (await lockState(path, staleMs)).held;
}

interface LockState {
  /** False when there is no lock file at all (just try to create it again). */
  exists: boolean;
  held: boolean;
  token: string | null;
}

async function lockState(path: string, staleMs: number): Promise<LockState> {
  let ageMs: number;
  try {
    ageMs = Date.now() - (await stat(path)).mtimeMs;
  } catch {
    return { exists: false, held: false, token: null };
  }
  const text = await readText(path);
  if (text === null) return { exists: false, held: false, token: null };
  const fresh = ageMs < staleMs;
  try {
    const info = JSON.parse(text) as LockInfo;
    return { exists: true, held: fresh && processAlive(info.pid), token: info.token };
  } catch {
    // Unreadable (for example mid-write on a file system without hard links): judge by age.
    return { exists: true, held: fresh, token: null };
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Creates the lock file with its full content in one step (no empty-file window). */
async function tryCreateLock(path: string, content: string): Promise<boolean> {
  const tmp = `${path}.new-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, content, { mode: 0o600 });
  try {
    await link(tmp, path); // fails with EEXIST if the lock exists
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    if (code === "EPERM" || code === "ENOTSUP" || code === "EXDEV") {
      // File systems without hard links: fall back to exclusive create.
      try {
        await writeFile(path, content, { flag: "wx", mode: 0o600 });
        return true;
      } catch (inner) {
        if ((inner as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw inner;
      }
    }
    throw error;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/** How long a "breaker" lock may exist before it is itself considered abandoned. */
const BREAKER_STALE_MS = 5_000;

/**
 * Removes an abandoned lock. Breakers take turns through a short-lived second lock file
 * and re-check the lock while holding it. Only breakers ever remove a lock someone else
 * created, and a new lock can only be created while none exists, so the lock removed is
 * always the one found abandoned. Returns true if it removed the lock.
 */
async function breakStaleLock(path: string, staleMs: number): Promise<boolean> {
  const breaker = `${path}.break`;
  const breakerToken = randomBytes(8).toString("hex");
  if (!(await tryCreateLock(breaker, JSON.stringify({ pid: process.pid, at: Date.now(), token: breakerToken })))) {
    const b = await lockState(breaker, BREAKER_STALE_MS);
    if (b.exists && !b.held) await unlink(breaker).catch(() => undefined);
    return false;
  }
  try {
    const state = await lockState(path, staleMs);
    if (!state.exists || state.held) return false;
    const aside = `${path}.stale-${process.pid}-${randomBytes(4).toString("hex")}`;
    try {
      await rename(path, aside);
    } catch {
      return false; // released meanwhile, or the file system refused (e.g. open on Windows)
    }
    const text = await readText(aside);
    let token: string | null;
    try {
      token = text === null ? null : (JSON.parse(text) as LockInfo).token;
    } catch {
      token = null;
    }
    if (token !== state.token) {
      // Defensive: the lock changed between our check and the move. Put it back.
      await link(aside, path).catch(() => undefined);
      await unlink(aside).catch(() => undefined);
      return false;
    }
    await unlink(aside).catch(() => undefined);
    return true;
  } finally {
    const text = await readText(breaker);
    if (text !== null && text.includes(breakerToken)) await unlink(breaker).catch(() => undefined);
  }
}

/**
 * Runs `fn` while holding an exclusive lock file, so that only one process (of any
 * ccb tool) changes the library at a time. While `fn` runs, the lock file's modification
 * time is refreshed so other processes know the holder is alive.
 */
export async function withLock<T>(path: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const staleMs = opts.staleMs ?? 30_000;
  const token = randomBytes(8).toString("hex");
  const deadline = Date.now() + timeoutMs;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const content = JSON.stringify({ pid: process.pid, at: Date.now(), token } satisfies LockInfo);

  while (!(await tryCreateLock(path, content))) {
    const state = await lockState(path, staleMs);
    if (!state.exists) continue; // released between our attempt and our look: try again
    if (!state.held && (await breakStaleLock(path, staleMs))) continue;
    if (Date.now() > deadline) throw new LockTimeoutError(path);
    await sleep(5 + Math.floor(Math.random() * 20));
  }

  const beat = setInterval(() => {
    const now = new Date();
    utimes(path, now, now).catch(() => undefined);
  }, Math.max(50, Math.floor(staleMs / 3)));
  beat.unref();
  try {
    return await fn();
  } finally {
    clearInterval(beat);
    const text = await readText(path);
    if (text !== null && text.includes(token)) await unlink(path).catch(() => undefined);
  }
}
