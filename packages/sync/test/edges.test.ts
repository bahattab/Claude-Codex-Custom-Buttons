// Edge cases: status wording, token-store failures, setup choices, damaged state.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultSettings, emptyLibrary, type Library } from "@ccb/core";
import {
  FileTokenStore,
  FolderRemote,
  MacKeychainStore,
  SecretToolStore,
  TokenStoreError,
  WindowsDpapiStore,
  formatStatus,
  loadClient,
  realScheduler,
  remoteProvider,
  runCommand,
  saveClient,
  statusLine,
  type CommandRunner,
  type SyncStatus,
} from "@ccb/sync";

import { MemoryRemote, TestClock, cleanup, computer } from "./helpers.js";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ccb-edges-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await cleanup();
});

const base: SyncStatus = {
  mode: "drive-api",
  state: "idle",
  pending: 0,
  pendingKeys: [],
  conflicts: 0,
  lastPullAt: "2026-11-11T09:00:00.000Z",
  lastPushAt: null,
  nextRetryAt: null,
  message: null,
  devices: [],
  staleDevices: [],
  invalidDevices: [],
};

describe("status wording", () => {
  it("matches the status table for every state", () => {
    expect(statusLine({ ...base, state: "off" })).toBe("Sync off");
    expect(statusLine({ ...base, state: "not-set-up" })).toBe("Sync not set up");
    expect(statusLine({ ...base, state: "signed-out" })).toBe("Sync ⚠ sign in");
    expect(statusLine({ ...base, state: "no-credential-store" })).toBe("Sync ⚠ no credential store");
    expect(statusLine({ ...base, state: "syncing" })).toBe("Sync ↻");
    expect(statusLine({ ...base, state: "offline", pending: 3 })).toBe("Sync offline · 3 pending");
    expect(statusLine({ ...base, state: "offline" })).toBe("Sync offline");
    expect(statusLine({ ...base, state: "error" })).toBe("Sync ⚠ error");
    expect(statusLine({ ...base, conflicts: 1 })).toBe("Sync ⚠ 1 conflict");
    expect(statusLine({ ...base, conflicts: 2 })).toBe("Sync ⚠ 2 conflicts");
    expect(statusLine({ ...base, pending: 4 })).toBe("Sync · 4 pending");
    expect(statusLine(base)).toMatch(/^Sync ✓ \d\d:\d\d$/);
    expect(statusLine({ ...base, lastPullAt: null })).toBe("Sync ✓");
  });

  it("explains what to do", () => {
    const lines = formatStatus({ ...base, state: "offline", pending: 2, message: "no network", nextRetryAt: "2026-11-11T09:00:04.000Z", conflicts: 1, invalidDevices: [{ deviceId: "dev_x12345", error: "bad" }] });
    expect(lines.join("\n")).toMatch(/upload automatically/);
    expect(lines.join("\n")).toMatch(/Next try at/);
    expect(lines.join("\n")).toMatch(/choose which version/);
    expect(lines.join("\n")).toMatch(/dev_x12345/);
  });
});

describe("token store failures", () => {
  const fixed = (r: { code: number; stdout?: string; stderr?: string }): CommandRunner => async () => ({ code: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" });

  it("each OS store reports a refusal clearly", async () => {
    const refuse = fixed({ code: 1, stderr: "denied" });
    await expect(new MacKeychainStore(refuse).get()).rejects.toBeInstanceOf(TokenStoreError);
    await expect(new MacKeychainStore(refuse).set("1//abcdefghij")).rejects.toThrow(/refused/);
    await expect(new MacKeychainStore(refuse).delete()).rejects.toThrow(/couldn't be removed/);
    await expect(new MacKeychainStore(fixed({ code: 0, stderr: "security: error x" })).set("1//abcdefghij")).rejects.toThrow(/refused/);
    expect(await new MacKeychainStore(fixed({ code: 0, stdout: "1//tok\n" })).get()).toBe("1//tok");
    await expect(new SecretToolStore(refuse).get()).rejects.toThrow(/couldn't be read/);
    await expect(new SecretToolStore(refuse).set("1//abcdefghij")).rejects.toThrow(/refused/);
    await expect(new SecretToolStore(refuse).delete()).rejects.toThrow(/couldn't be removed/);
    expect(await new SecretToolStore(fixed({ code: 1 })).get()).toBeNull();
    await new SecretToolStore(fixed({ code: 1 })).delete();
    const win = new WindowsDpapiStore(home, refuse);
    await expect(win.set("1//abcdefghij")).rejects.toThrow(/encrypted/);
    await writeFile(win.path, "x");
    await expect(win.get()).rejects.toThrow(/decrypted/);
    expect(await new WindowsDpapiStore(home, fixed({ code: 0, stdout: "1//tok" })).get()).toBe("1//tok");
    await win.delete();
  });

  it("a damaged token file reads as signed out", async () => {
    const store = new FileTokenStore(home);
    await writeFile(store.path, "{not json");
    expect(await store.get()).toBeNull();
    await writeFile(store.path, JSON.stringify({ refreshToken: 5 }));
    expect(await store.get()).toBeNull();
  });

  it("runCommand runs a real program and passes standard input", async () => {
    const r = await runCommand(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { input: "hello" });
    expect(r).toMatchObject({ code: 0, stdout: "hello" });
    await expect(runCommand("ccb-no-such-program-xyz", [])).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("setup", () => {
  const lib = (change: (l: Library) => void = () => undefined): Library => {
    const l = emptyLibrary();
    change(l);
    return l;
  };

  it("chooses off, folder, not-set-up and signed-out, and reuses the remote", async () => {
    const provider = remoteProvider({ home, platform: "linux", run: async () => ({ code: 1, stdout: "", stderr: "" }) });
    expect(await provider(lib((l) => (l.settings.sync.mode = "off")))).toEqual({ state: "off" });
    expect(await provider(lib((l) => (l.settings.sync.mode = "drive-folder")))).toMatchObject({ state: "not-set-up" });
    const folder = lib((l) => Object.assign(l.settings.sync, { mode: "drive-folder", folderPath: home }));
    const r1 = await provider(folder);
    expect(r1).toBeInstanceOf(FolderRemote);
    expect(await provider(folder)).toBe(r1);
    expect(await provider(lib())).toMatchObject({ state: "not-set-up" });
    await saveClient(home, { clientId: "id", clientSecret: "s" });
    expect(await provider(lib())).toMatchObject({ state: "signed-out" });
  });

  it("reports an unreadable or wrong client file, and a token store that fails", async () => {
    const named = lib((l) => (l.settings.google.clientFile = join(home, "missing.json")));
    expect(await loadClient(home, named)).toEqual({ missing: expect.stringMatching(/can't be read/) });
    await writeFile(join(home, "web.json"), JSON.stringify({ web: {} }));
    expect(await loadClient(home, lib((l) => (l.settings.google.clientFile = join(home, "web.json"))))).toEqual({ missing: expect.stringMatching(/Desktop app/) });
    await saveClient(home, { clientId: "id", clientSecret: "s" });
    const broken = remoteProvider({ home, platform: "darwin", run: async () => ({ code: 9, stdout: "", stderr: "locked" }) });
    expect(await broken(lib())).toMatchObject({ state: "no-credential-store", reason: expect.stringMatching(/locked/) });
    const none = remoteProvider({ home, platform: "linux", run: async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" })) });
    expect(await none(lib())).toMatchObject({ state: "no-credential-store" });
    expect(defaultSettings().google.tokenStore).toBe("os");
  });
});

describe("engine edges", () => {
  it("a damaged or old sync-state file just means a full pull", async () => {
    const clock = new TestClock();
    const drive = new MemoryRemote();
    const a = await computer(clock, async () => drive.for());
    await writeFile(join(a.home, "sync-state.json"), "{damaged");
    expect((await a.engine.syncNow()).state).toBe("idle");
    await writeFile(join(a.home, "sync-state.json"), JSON.stringify({ version: 99 }));
    expect((await a.engine.syncNow()).state).toBe("idle");
  });

  it("an unexpected error is reported and retried; status shows unavailable states without running", async () => {
    const clock = new TestClock();
    let fail = true;
    const drive = new MemoryRemote();
    const a = await computer(clock, async () => {
      if (fail) {
        return {
          kind: "drive-api" as const,
          location: "x",
          pull: async () => {
            throw new Error("boom");
          },
          push: async () => undefined,
        };
      }
      return { state: "signed-out" as const, reason: "sign in" };
    });
    const s = await a.engine.syncNow();
    expect(s).toMatchObject({ state: "error", message: "boom" });
    expect(s.nextRetryAt).not.toBeNull();
    fail = false;
    expect(await a.engine.status()).toMatchObject({ state: "signed-out", message: "sign in" });
    void drive;
  });

  it("concurrent syncNow calls share a run plus one follow-up", async () => {
    const clock = new TestClock();
    const drive = new MemoryRemote();
    const a = await computer(clock, async () => drive.for());
    const runs = await Promise.all([a.engine.syncNow(), a.engine.syncNow(), a.engine.syncNow()]);
    expect(runs.every((r) => r.state === "idle")).toBe(true);
    expect(drive.pushes.length).toBe(1);
  });

  it("the real scheduler's timers don't keep the process alive and can be cancelled", async () => {
    let fired = false;
    const t = realScheduler.setTimeout(() => (fired = true), 5);
    realScheduler.clearTimeout(t);
    await new Promise((r) => setTimeout(r, 20));
    expect(fired).toBe(false);
    expect(realScheduler.now()).toBeInstanceOf(Date);
  });
});

describe("Drive and sign-in edges", () => {
  it("pages through long change feeds and follows files moved out of the folder", async () => {
    const { FakeDrive } = await import("./fake-drive.js");
    const { DriveRemote } = await import("@ccb/sync");
    const drive = new FakeDrive();
    const auth = { accessToken: async () => "token-1" };
    const remote = new DriveRemote(auth, "F", drive.fetch);
    await remote.push("dev_mine123", "{}");
    const first = await remote.pull(null, "dev_mine123");
    const devices = drive.folderNamed("devices")[0]?.id ?? "";
    const other = drive.add({ name: "dev_other12.json", parents: [devices], content: "{}" });
    for (let i = 0; i < 150; i++) drive.add({ name: `unrelated-${i}.txt`, parents: ["root"] });
    const second = await remote.pull(first.cursor, "dev_mine123");
    expect(second.changed.map((f) => f.deviceId)).toEqual(["dev_other12"]);
    const f = drive.files.get(other);
    if (f) f.parents = ["root"]; // moved out of devices/
    drive.changes.push({ seq: drive.changes.length + 1000, fileId: other, removed: false });
    (drive as unknown as { seq: number }).seq = drive.changes.length + 1000;
    const third = await remote.pull(second.cursor, "dev_mine123");
    expect(third.removed).toEqual(["dev_other12"]);
  });

  it("the sign-in page answers 404 elsewhere and errors when Google sends no code", async () => {
    const { login } = await import("@ccb/sync");
    const store = { name: "m", token: null as string | null, get: async () => null, set: async () => undefined, delete: async () => undefined };
    await expect(
      login({
        client: { clientId: "a", clientSecret: "b" },
        store,
        openBrowser: async (href) => {
          const auth = new URL(href);
          const redirect = auth.searchParams.get("redirect_uri") ?? "";
          expect((await fetch(`${redirect}/favicon.ico`)).status).toBe(404);
          await fetch(`${redirect}/?state=${auth.searchParams.get("state")}`);
        },
      }),
    ).rejects.toThrow(/no sign-in code/);
    await expect(
      login({
        client: { clientId: "a", clientSecret: "b" },
        store,
        openBrowser: async (href) => {
          const auth = new URL(href);
          await fetch(`${auth.searchParams.get("redirect_uri")}/?state=${auth.searchParams.get("state")}&error=server_error`);
        },
      }),
    ).rejects.toThrow(/server_error/);
  });

  it("other refusals from Google's token endpoint are signed-out with the reason", async () => {
    const { GoogleAuth, AuthError } = await import("@ccb/sync");
    const store = { name: "m", get: async () => "1//tokenvalue", set: async () => undefined, delete: async () => undefined };
    const auth = new GoogleAuth({ clientId: "a", clientSecret: "b" }, store, async () => new Response("not json", { status: 400 }));
    await expect(auth.accessToken()).rejects.toBeInstanceOf(AuthError);
  });
});

describe("review fixes (M5a), continued", () => {
  it("a tool error that echoes the token never shows it", async () => {
    const echo: CommandRunner = async (_c, _a, opts) => ({ code: 1, stdout: "", stderr: `failed: ${opts?.input ?? ""}` });
    const err = await new SecretToolStore(echo).set("1//secret-token-value").catch((e: Error) => e);
    expect(String(err)).not.toContain("1//secret-token-value");
    expect(String(err)).toContain("***");
  });

  it("login refuses a sign-in where Drive access wasn't ticked", async () => {
    const { login, SCOPE } = await import("@ccb/sync");
    void SCOPE;
    let stored = false;
    const store = { name: "m", get: async () => null, set: async () => void (stored = true), delete: async () => undefined };
    await expect(
      login({
        client: { clientId: "a", clientSecret: "b" },
        store,
        fetch: async () => Response.json({ access_token: "x", refresh_token: "1//abcdefghij", scope: "openid email" }),
        openBrowser: async (href) => {
          const u = new URL(href);
          await fetch(`${u.searchParams.get("redirect_uri")}/?code=c&state=${u.searchParams.get("state")}`);
        },
      }),
    ).rejects.toThrow(/wasn't allowed/);
    expect(stored).toBe(false);
  });

  it("after stop(), a run in progress does no follow-up run", async () => {
    const clock = new TestClock();
    const drive = new MemoryRemote();
    const a = await computer(clock, async () => drive.for());
    a.engine.start();
    a.engine.notifyChanged();
    void a.engine.syncNow(); // asks for a follow-up while the first run is going
    a.engine.stop();
    await a.engine.idle();
    expect(drive.pushes.length).toBe(1);
  });

  it("when another process holds the sync lock too long, this one reports syncing and leaves the state alone", async () => {
    const { withLock } = await import("@ccb/store");
    const { readFile } = await import("node:fs/promises");
    const { SyncEngine } = await import("@ccb/sync");
    const clock = new TestClock();
    const drive = new MemoryRemote();
    const a = await computer(clock, async () => drive.for());
    await a.engine.syncNow();
    const before = await readFile(join(a.home, "sync-state.json"), "utf8");
    const impatient = new SyncEngine({ store: a.store, remote: async () => drive.for(), scheduler: clock, lockTimeoutMs: 100 });
    let release: () => void = () => undefined;
    const held = withLock(join(a.home, ".sync.lock"), () => new Promise<void>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 30));
    const status = await impatient.syncNow();
    release();
    await held;
    expect(status.state).toBe("syncing");
    expect(await readFile(join(a.home, "sync-state.json"), "utf8")).toBe(before);
  });
});

describe("openBrowser", () => {
  it("doesn't throw when no browser opener is installed", async () => {
    const { openBrowser } = await import("@ccb/sync");
    expect(() => openBrowser("https://example.invalid/")).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
  });
});
