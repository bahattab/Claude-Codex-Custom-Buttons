import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LockTimeoutError, exists, lockIsHeld, readText, secureRandom, withLock, writeFileAtomic } from "@ccb/store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccb-fs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("writes the whole file, creates folders, and leaves no temporary files", async () => {
    const path = join(dir, "a", "b", "file.json");
    await writeFileAtomic(path, "first");
    await writeFileAtomic(path, "second");
    expect(await readFile(path, "utf8")).toBe("second");
    expect(await readdir(join(dir, "a", "b"))).toEqual(["file.json"]);
  });

  it("reads missing files as null", async () => {
    expect(await readText(join(dir, "missing"))).toBeNull();
    expect(await exists(join(dir, "missing"))).toBe(false);
  });
});

describe("locks", () => {
  const lock = (): string => join(dir, ".lock");

  it("treats an unreadable lock file as held while it is new", async () => {
    await writeFile(lock(), "");
    expect(await lockIsHeld(lock())).toBe(true);
    await expect(withLock(lock(), async () => "x", { timeoutMs: 80 })).rejects.toBeInstanceOf(LockTimeoutError);
  });

  it("breaks an unreadable lock file once it is old", async () => {
    await writeFile(lock(), "garbage");
    const old = new Date(Date.now() - 60_000);
    await utimes(lock(), old, old);
    expect(await lockIsHeld(lock())).toBe(false);
    expect(await withLock(lock(), async () => "acquired")).toBe("acquired");
  });

  it("breaks a lock older than the stale limit even if its process is alive", async () => {
    await writeFile(lock(), JSON.stringify({ pid: process.pid, at: Date.now() - 60_000, token: "old" }));
    expect(await withLock(lock(), async () => "acquired")).toBe("acquired");
  });

  it("releases the lock afterwards, also when the work throws", async () => {
    await expect(withLock(lock(), async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await exists(lock())).toBe(false);
    await withLock(lock(), async () => undefined);
    expect(await exists(lock())).toBe(false);
  });

  it("does not remove a lock that another holder took over", async () => {
    await withLock(lock(), async () => {
      await writeFile(lock(), JSON.stringify({ pid: process.pid, at: Date.now(), token: "someone-else" }));
    });
    expect(await readText(lock())).toContain("someone-else");
  });

  it("leaves no temporary or moved-aside files behind", async () => {
    await writeFile(lock(), JSON.stringify({ pid: 999_999_999, at: Date.now(), token: "dead" }));
    await withLock(lock(), async () => undefined);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("secureRandom", () => {
  it("returns numbers in [0, 1)", () => {
    for (let i = 0; i < 1000; i++) {
      const n = secureRandom();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});
