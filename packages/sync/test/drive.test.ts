import { afterEach, describe, expect, it } from "vitest";

import { live, saveNote, setVariable } from "@ccb/core";
import { AuthError, DriveRemote, OfflineError, type TokenSource } from "@ccb/sync";

import { FakeDrive } from "./fake-drive.js";
import { TestClock, cleanup, computer, synced, type Computer } from "./helpers.js";

afterEach(cleanup);

const FOLDER_NAME = "Claude Codex Buttons";

function tokens(drive: FakeDrive, opts: { refreshTo?: string; signedOut?: boolean; rejected?: boolean } = {}): TokenSource & { refreshes: number } {
  let current = "token-1";
  const src = {
    refreshes: 0,
    async accessToken(fresh?: boolean): Promise<string> {
      if (opts.signedOut) throw new AuthError("signed out");
      if (fresh) {
        src.refreshes++;
        current = opts.refreshTo ?? current;
        if (!opts.rejected) drive.validTokens.add(current);
      }
      return current;
    },
  };
  return src;
}

async function onDrive(clock: TestClock, drive: FakeDrive, auth?: TokenSource): Promise<Computer> {
  const remote = new DriveRemote(auth ?? tokens(drive), FOLDER_NAME, drive.fetch);
  return computer(clock, async () => remote);
}

async function round(...cs: Computer[]): Promise<void> {
  for (let pass = 0; pass < 2; pass++) for (const c of cs) await c.engine.syncNow();
}

describe("DriveRemote against a fake Google Drive", () => {
  it("creates one visible folder with devices/ and a README, and three computers converge", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const [a, b, c] = [await onDrive(clock, drive), await onDrive(clock, drive), await onDrive(clock, drive)] as [Computer, Computer, Computer];
    await a.edit((lib, ctx, rnd) => saveNote(lib, { body: "From A" }, ctx, rnd));
    await b.edit((lib, ctx) => setVariable(lib, "team", "Core", ctx));
    await c.edit((lib, ctx, rnd) => saveNote(lib, { body: "From C" }, ctx, rnd));
    await round(a, b, c);
    const views = await Promise.all([a, b, c].map(async (x) => synced(await x.data())));
    expect(new Set(views).size).toBe(1);
    expect(drive.folderNamed(FOLDER_NAME)).toHaveLength(1);
    expect(drive.folderNamed("devices")).toHaveLength(1);
    const devicesId = drive.folderNamed("devices")[0]?.id ?? "";
    const deviceFiles = [...drive.files.values()].filter((f) => f.parents.includes(devicesId));
    expect(deviceFiles.map((f) => f.name).sort()).toEqual(
      (await Promise.all([a, b, c].map(async (x) => `${(await x.store.getDevice()).deviceId}.json`))).sort(),
    );
    expect([...drive.files.values()].some((f) => f.name === "README.txt")).toBe(true);
  });

  it("after the first pull, only changed device files are downloaded (change feed)", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const [a, b, c] = [await onDrive(clock, drive), await onDrive(clock, drive), await onDrive(clock, drive)] as [Computer, Computer, Computer];
    await round(a, b, c);
    await round(a, b, c);
    await b.edit((lib, ctx) => setVariable(lib, "x", "1", ctx));
    await b.engine.syncNow();
    const before = drive.downloads();
    await a.engine.syncNow();
    expect(drive.downloads() - before).toBe(1);
    expect(live((await a.data()).variables).find((v) => v.id === "x")?.value).toBe("1");
  });

  it("two computers that each created the folder at the same moment still find each other", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    // Both folders exist before either computer lists (as when both sign in at once).
    const first = drive.add({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" });
    const second = drive.add({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" });
    drive.add({ name: "devices", mimeType: "application/vnd.google-apps.folder", parents: [second] });
    const a = await onDrive(clock, drive);
    const b = await onDrive(clock, drive);
    await a.edit((lib, ctx, rnd) => saveNote(lib, { body: "Hello from A" }, ctx, rnd));
    await round(a, b);
    expect(live((await b.data()).notes).some((n) => n.body === "Hello from A")).toBe(true);
    const target = [...drive.files.values()].find((f) => f.name === "devices" && f.parents.includes(first));
    expect(target).toBeDefined(); // both write into the oldest folder
  });

  it("a 401 refreshes the token once and carries on", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const auth = tokens(drive, { refreshTo: "token-2" });
    const a = await onDrive(clock, drive, auth);
    await a.engine.syncNow();
    drive.validTokens.delete("token-1"); // the access token expired
    await a.edit((lib, ctx) => setVariable(lib, "x", "1", ctx));
    const s = await a.engine.syncNow();
    expect(s.state).toBe("idle");
    expect(auth.refreshes).toBe(1);
  });

  it("a sign-in that can't be refreshed shows signed-out and doesn't retry by itself", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const a = await onDrive(clock, drive, tokens(drive, { signedOut: true }));
    const s = await a.engine.syncNow();
    expect(s.state).toBe("signed-out");
    expect(s.nextRetryAt).toBeNull();
  });

  it("a token Google keeps rejecting after a refresh is signed-out too", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const a = await onDrive(clock, drive, tokens(drive, { refreshTo: "token-2", rejected: true }));
    drive.validTokens.clear();
    const s = await a.engine.syncNow();
    expect(s.state).toBe("signed-out");
    expect(s.message).toMatch(/ccb login/);
  });

  it("no network, 429 and 5xx are offline (retried); a disabled API explains the fix", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const a = await onDrive(clock, drive);
    drive.offline = true;
    expect((await a.engine.syncNow()).state).toBe("offline");
    drive.offline = false;
    for (const status of [429, 500, 503]) {
      drive.failNext.push({ status });
      const s = await a.engine.syncNow();
      expect(s.state).toBe("offline");
      expect(s.nextRetryAt).not.toBeNull();
    }
    drive.failNext.push({ status: 403, body: { error: { code: 403, message: "x", errors: [{ reason: "userRateLimitExceeded" }] } } });
    expect((await a.engine.syncNow()).state).toBe("offline");
    drive.failNext.push({ status: 403, body: { error: { code: 403, message: "Drive API has not been used... accessNotConfigured", errors: [{ reason: "accessNotConfigured" }] } } });
    const s = await a.engine.syncNow();
    expect(s.state).toBe("error");
    expect(s.message).toMatch(/not enabled/);
    expect((await a.engine.syncNow()).state).toBe("idle");
  });

  it("a device file deleted in Drive is uploaded again", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const a = await onDrive(clock, drive);
    await a.engine.syncNow();
    const name = `${(await a.store.getDevice()).deviceId}.json`;
    const own = [...drive.files.values()].find((f) => f.name === name);
    drive.files.delete(own?.id ?? "");
    await a.edit((lib, ctx) => setVariable(lib, "x", "1", ctx));
    expect((await a.engine.syncNow()).state).toBe("idle");
    expect([...drive.files.values()].filter((f) => f.name === name)).toHaveLength(1);
  });

  it("an expired change-feed position falls back to a full listing", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const a = await onDrive(clock, drive);
    const b = await onDrive(clock, drive);
    await round(a, b);
    await b.edit((lib, ctx) => setVariable(lib, "late", "1", ctx));
    await b.engine.syncNow();
    drive.failNext.push({ status: 410 });
    expect((await a.engine.syncNow()).state).toBe("idle");
    expect(live((await a.data()).variables).some((v) => v.id === "late")).toBe(true);
  });

  it("a trashed device file stops counting as a device", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const a = await onDrive(clock, drive);
    const b = await onDrive(clock, drive);
    await round(a, b);
    expect((await a.engine.status()).devices).toHaveLength(1);
    const bName = `${(await b.store.getDevice()).deviceId}.json`;
    drive.trash([...drive.files.values()].find((f) => f.name === bName)?.id ?? "");
    const s = await a.engine.syncNow();
    expect(s.devices).toHaveLength(0);
  });

  it("names in queries are escaped", async () => {
    const drive = new FakeDrive();
    const remote = new DriveRemote(tokens(drive), "Bob's \\ folder", drive.fetch);
    await remote.push("dev_abcdef1", "{}");
    expect(drive.folderNamed("Bob's \\ folder")).toHaveLength(1);
    const again = new DriveRemote(tokens(drive), "Bob's \\ folder", drive.fetch);
    await again.pull(null, "dev_zzzzzz1");
    expect(drive.folderNamed("Bob's \\ folder")).toHaveLength(1); // found, not created twice
  });

  it("network failure surfaces as OfflineError from the remote itself", async () => {
    const drive = new FakeDrive();
    drive.offline = true;
    const remote = new DriveRemote(tokens(drive), FOLDER_NAME, drive.fetch);
    await expect(remote.pull(null, "dev_abcdef1")).rejects.toBeInstanceOf(OfflineError);
  });
});

describe("review fixes (M5a)", () => {
  it("signing in to another Google account starts over and never deletes local data (C2)", async () => {
    const clock = new TestClock();
    const first = new FakeDrive();
    const second = new FakeDrive();
    let remote = new DriveRemote(tokens(first), FOLDER_NAME, first.fetch, "acct1");
    const a = await computer(clock, async () => remote);
    for (let i = 0; i < 4; i++) await a.edit((lib, ctx, rnd) => saveNote(lib, { body: `Note ${i}` }, ctx, rnd));
    await a.engine.syncNow();
    await a.engine.syncNow();
    // A colleague's device already uses the second account.
    const b = await onDrive(clock, second);
    await b.engine.syncNow();
    remote = new DriveRemote(tokens(second), FOLDER_NAME, second.fetch, "acct2");
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(live((await a.data()).notes).filter((n) => n.body.startsWith("Note "))).toHaveLength(4);
    const aName = `${(await a.store.getDevice()).deviceId}.json`;
    expect([...second.files.values()].some((f) => f.name === aName)).toBe(true); // uploaded to the new account
  });

  it("a trashed Drive folder is re-created and every computer uploads again (M1)", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const a = await onDrive(clock, drive);
    const b = await onDrive(clock, drive);
    await round(a, b);
    for (const f of drive.folderNamed(FOLDER_NAME)) drive.trash(f.id);
    await round(a, b);
    const devices = drive.folderNamed("devices");
    expect(devices).toHaveLength(1);
    const live = [...drive.files.values()].filter((f) => f.parents.includes(devices[0]?.id ?? "") && !f.trashed);
    expect(live).toHaveLength(2);
  });

  it("this computer's own file trashed in Drive comes back (M2)", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const a = await onDrive(clock, drive);
    await a.engine.syncNow();
    await a.engine.syncNow();
    const name = `${(await a.store.getDevice()).deviceId}.json`;
    drive.trash([...drive.files.values()].find((f) => f.name === name)?.id ?? "");
    await a.engine.syncNow();
    expect([...drive.files.values()].filter((f) => f.name === name && !f.trashed)).toHaveLength(1);
  });

  it("a library over 4 MB is uploaded with a resumable upload", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const a = await onDrive(clock, drive);
    for (let i = 0; i < 25; i++) await a.edit((lib, ctx, rnd) => saveNote(lib, { body: `${i} ${"x".repeat(190_000)}` }, ctx, rnd));
    const first = await a.engine.syncNow();
    expect(first.message).toBeNull();
    expect(first.state).toBe("idle");
    expect(drive.resumableUploads).toBe(1);
    await a.edit((lib, ctx, rnd) => saveNote(lib, { body: "one more" }, ctx, rnd));
    expect((await a.engine.syncNow()).state).toBe("idle");
    expect(drive.resumableUploads).toBe(2); // the update too
    const b = await onDrive(clock, drive);
    await b.engine.syncNow();
    expect(live((await b.data()).notes).length).toBeGreaterThanOrEqual(26);
  });

  it("Drive access not granted is signed-out with what to do", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const a = await onDrive(clock, drive);
    drive.failNext.push({ status: 403, body: { error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } } });
    const s = await a.engine.syncNow();
    expect(s.state).toBe("signed-out");
    expect(s.message).toMatch(/allow access/);
  });

  it("a computer with no changes still uploads weekly, so others don't think it's gone", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const a = await onDrive(clock, drive);
    await a.engine.syncNow();
    await a.engine.syncNow();
    const uploads = () => drive.requests.filter((r) => r.method === "PATCH" || (r.method === "POST" && r.url.includes("/upload/"))).length;
    const before = uploads();
    clock.tick(24 * 3600_000);
    await a.engine.syncNow();
    expect(uploads()).toBe(before);
    clock.tick(7 * 24 * 3600_000);
    await a.engine.syncNow();
    expect(uploads()).toBe(before + 1);
  });
});

describe("second review fixes", () => {
  it("a device that moves to the oldest folder after a duplicate start keeps syncing (incremental pull lists again)", async () => {
    const clock = new TestClock();
    const drive = new FakeDrive();
    const newer = drive.add({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" });
    const newerDevices = drive.add({ name: "devices", mimeType: "application/vnd.google-apps.folder", parents: [newer] });
    const a = await onDrive(clock, drive);
    const b = await onDrive(clock, drive);
    const bId = (await b.store.getDevice()).deviceId;
    // B's first file landed in the newer folder, and A tracks it.
    drive.add({ name: `${bId}.json`, parents: [newerDevices], content: JSON.stringify({ ...JSON.parse("{}") }) });
    await a.engine.syncNow();
    // Later the oldest folder appears (created first elsewhere) and B writes there.
    await b.edit((lib, ctx) => setVariable(lib, "moved", "yes", ctx));
    await b.engine.syncNow();
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(live((await a.data()).variables).some((v) => v.id === "moved")).toBe(true);
  });
});
