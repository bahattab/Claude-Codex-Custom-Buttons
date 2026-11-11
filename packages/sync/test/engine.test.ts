import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appendNote, deletePrompt, live, saveButton, saveNote, savePrompt, setSharedSetting, setVariable, type Library } from "@ccb/core";
import { FolderRemote, SyncEngine, type Remote, type RemoteProvider } from "@ccb/sync";

import { MemoryRemote, TestClock, cleanup, computer, synced, type Computer } from "./helpers.js";

afterEach(cleanup);

const using = (remote: Remote): RemoteProvider => async () => remote;
const settle = (...cs: Computer[]) => async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r));
    for (const c of cs) await c.engine.idle();
  }
};

async function round(...cs: Computer[]): Promise<void> {
  for (let pass = 0; pass < 2; pass++) for (const c of cs) await c.engine.syncNow();
}

function noteNamed(lib: Library, title: string) {
  return live(lib.notes).find((n) => n.title === title);
}

describe("three computers through one remote", () => {
  it("converge on prompts, buttons, variables, notes and shared settings; deletions travel", async () => {
    const clock = new TestClock();
    const drive = new MemoryRemote();
    const [a, b, c] = [await computer(clock, using(drive.for())), await computer(clock, using(drive.for())), await computer(clock, using(drive.for()))] as [Computer, Computer, Computer];

    let promptId = "";
    await a.edit((lib, ctx, rnd) => {
      const r = savePrompt(lib, { title: "Release notes", body: "Write release notes for {{project}}" }, ctx, rnd);
      if (r.ok) promptId = r.value.record.id;
      return r;
    });
    await a.edit((lib, ctx) => saveButton(lib, { id: "btn_release", label: "Release", action: { type: "submit", promptId } }, ctx));
    await b.edit((lib, ctx, rnd) => saveNote(lib, { body: "Shopping\nmilk" }, ctx, rnd));
    await c.edit((lib, ctx) => setVariable(lib, "project", "Payments", ctx));
    await c.edit((lib, ctx) => setSharedSetting(lib, "continue.message", "Go on.", ctx));

    await round(a, b, c);
    const views = await Promise.all([a, b, c].map(async (x) => synced(await x.data())));
    expect(new Set(views).size).toBe(1);
    const libB = await b.data();
    expect(live(libB.prompts).some((p) => p.title === "Release notes")).toBe(true);
    expect(live(libB.buttons).map((x) => x.id)).toContain("btn_release");
    expect(noteNamed(await a.data(), "Shopping")?.body).toBe("Shopping\nmilk");
    expect(live((await a.data()).variables).find((v) => v.id === "project")?.value).toBe("Payments");
    expect((await b.data()).sharedSettings.find((s) => s.id === "continue.message")?.value).toBe("Go on.");

    // B deletes the prompt; the deletion reaches A and C and it doesn't come back.
    await b.edit((lib, ctx) => deletePrompt(lib, promptId, ctx));
    await round(a, b, c);
    for (const x of [a, b, c]) expect(live((await x.data()).prompts).some((p) => p.id === promptId)).toBe(false);
    expect((await c.engine.status()).pending).toBe(0);
  });

  it("concurrent edits to one note keep both texts as the note and one conflict copy, the same everywhere", async () => {
    const clock = new TestClock();
    const drive = new MemoryRemote();
    const a = await computer(clock, using(drive.for()));
    const b = await computer(clock, using(drive.for()));
    let id = "";
    await a.edit((lib, ctx, rnd) => {
      const r = saveNote(lib, { body: "Plan\nv1" }, ctx, rnd);
      if (r.ok) id = r.value.record.id;
      return r;
    });
    await round(a, b);
    await a.edit((lib, ctx, rnd) => saveNote(lib, { id, body: "Plan\nfrom A" }, ctx, rnd));
    await b.edit((lib, ctx, rnd) => saveNote(lib, { id, body: "Plan\nfrom B" }, ctx, rnd));
    await round(a, b);
    const libA = await a.data();
    const libB = await b.data();
    expect(synced(libA)).toBe(synced(libB));
    const bodies = live(libA.notes).map((n) => n.body).sort();
    expect(bodies).toEqual(["Plan\nfrom A", "Plan\nfrom B"]);
    expect(live(libA.notes).filter((n) => n.conflictOf === id)).toHaveLength(1);
    expect((await a.engine.status()).conflicts).toBe(1);
  });
});

describe("automatic timing", () => {
  it("offline edits wait as pending and upload when the connection returns, retrying 2 s, 4 s, 8 s ...", async () => {
    const clock = new TestClock();
    const drive = new MemoryRemote();
    const a = await computer(clock, using(drive.for()));
    const b = await computer(clock, using(drive.for()));
    a.engine.start();
    await settle(a)();
    let id = "";
    await a.edit((lib, ctx, rnd) => {
      const r = saveNote(lib, { body: "Trip\npack" }, ctx, rnd);
      if (r.ok) id = r.value.record.id;
      return r;
    });
    drive.offline = true;
    a.engine.notifyChanged();
    await clock.advance(2000, settle(a));
    let status = await a.engine.status();
    expect(status.state).toBe("offline");
    expect(status.pending).toBeGreaterThan(0);
    expect(Date.parse(status.nextRetryAt ?? "") - clock.now().getTime()).toBe(2000);

    // Typing more while offline: still pending, retries back off.
    await a.edit((lib, ctx, rnd) => appendNote(lib, id, "passport", ctx, rnd));
    await clock.advance(2000, settle(a));
    status = await a.engine.status();
    expect(status.state).toBe("offline");
    const gaps: number[] = [Date.parse(status.nextRetryAt ?? "") - clock.now().getTime()];
    await clock.advance(gaps[0] ?? 0, settle(a));
    gaps.push(Date.parse((await a.engine.status()).nextRetryAt ?? "") - clock.now().getTime());
    expect(gaps[1]).toBe(8000); // the third failure in a row waits 8 s (2 s, 4 s, 8 s)

    drive.offline = false;
    await clock.advance(gaps[1] ?? 0, settle(a));
    status = await a.engine.status();
    expect(status.state).toBe("idle");
    expect(status.pending).toBe(0);
    await b.engine.syncNow();
    expect(noteNamed(await b.data(), "Trip")?.body).toBe("Trip\npack\npassport");
    a.engine.stop();
  });

  it("backoff is capped at 5 minutes", async () => {
    const clock = new TestClock();
    const drive = new MemoryRemote();
    drive.offline = true;
    const a = await computer(clock, using(drive.for()));
    for (let i = 0; i < 12; i++) await a.engine.syncNow();
    expect(a.engine.backoffMs()).toBe(300_000);
    const s = await a.engine.status();
    expect(Date.parse(s.nextRetryAt ?? "") - clock.now().getTime()).toBe(300_000);
  });

  it("a burst of changes is one upload after pushDelayMs; then it pulls every intervalSeconds", async () => {
    const clock = new TestClock();
    const drive = new MemoryRemote();
    const a = await computer(clock, using(drive.for()));
    a.engine.start();
    await settle(a)();
    const startPushes = drive.pushes.length;
    expect(startPushes).toBe(1); // the first sync uploads this computer's file
    for (const v of ["a", "b", "c"]) {
      await a.edit((lib, ctx) => setVariable(lib, "x", v, ctx));
      a.engine.notifyChanged();
      await clock.advance(500, settle(a));
    }
    expect(drive.pushes.length).toBe(startPushes); // still inside the 2 s window
    await clock.advance(2000, settle(a));
    expect(drive.pushes.length).toBe(startPushes + 1);
    expect(drive.pushes.at(-1)?.text).toContain('"value":"c"');

    // Another computer's change arrives with the next interval pull, without any action here.
    const b = await computer(clock, using(drive.for()));
    await b.edit((lib, ctx) => setVariable(lib, "from_b", "yes", ctx));
    await b.engine.syncNow();
    await clock.advance(60_000, settle(a));
    expect(live((await a.data()).variables).some((v) => v.id === "from_b")).toBe(true);
    a.engine.stop();
  });

  it("the change feed downloads only changed device files, but the merge still sees every device", async () => {
    const clock = new TestClock();
    const drive = new MemoryRemote();
    const [a, b, c] = [await computer(clock, using(drive.for())), await computer(clock, using(drive.for())), await computer(clock, using(drive.for()))] as [Computer, Computer, Computer];
    await b.edit((lib, ctx) => setVariable(lib, "from_b", "1", ctx));
    await c.edit((lib, ctx) => setVariable(lib, "from_c", "1", ctx));
    await round(a, b, c);
    await round(a, b, c); // settled: nobody has anything new
    const before = drive.reads;
    await c.edit((lib, ctx) => setVariable(lib, "from_c", "2", ctx));
    await c.engine.syncNow();
    await a.engine.syncNow();
    expect(drive.reads - before).toBe(1); // only C's new file was downloaded by A
    const vars = live((await a.data()).variables);
    expect(vars.find((v) => v.id === "from_b")?.value).toBe("1"); // B's data was kept, from the cache
    expect(vars.find((v) => v.id === "from_c")?.value).toBe("2");
  });
});

describe("safety", () => {
  it("two processes on one computer take turns, and the last upload is the latest data", async () => {
    const clock = new TestClock();
    const drive = new MemoryRemote();
    const a = await computer(clock, using(drive.for()));
    const second = new SyncEngine({ store: a.store, remote: using(drive.for()), scheduler: clock });
    await Promise.all([
      a.engine.syncNow(),
      second.syncNow(),
      a.edit((lib, ctx) => setVariable(lib, "x", "1", ctx)).then(() => second.syncNow()),
      a.edit((lib, ctx) => setVariable(lib, "y", "2", ctx)).then(() => a.engine.syncNow()),
    ]);
    await a.engine.syncNow();
    const last = JSON.parse(drive.files.get((await a.store.getDevice()).deviceId)?.text ?? "{}") as Library;
    expect(synced(last)).toBe(synced(await a.data()));
    expect((await a.engine.status()).pending).toBe(0);
  });

  it("an invalid device file is skipped and reported, never merged", async () => {
    const clock = new TestClock();
    const drive = new MemoryRemote();
    const a = await computer(clock, using(drive.for()));
    drive.files.set("dev_broken1", { text: "{not json", version: ++drive.version });
    drive.files.set("dev_wrong12", { text: JSON.stringify({ format: "ccb-device/1", schemaVersion: 1, deviceId: "dev_wrong12", deviceName: "X", syncedAt: "bad" }), version: ++drive.version });
    const before = synced(await a.data());
    const s = await a.engine.syncNow();
    expect(s.state).toBe("idle");
    expect(s.invalidDevices.map((d) => d.deviceId).sort()).toEqual(["dev_broken1", "dev_wrong12"]);
    expect(synced(await a.data())).toBe(before);
  });

  it("says why it can't sync, without failing, when sync is off or not set up", async () => {
    const clock = new TestClock();
    const a = await computer(clock, async () => ({ state: "not-set-up", reason: "Run ccb login." }));
    const s = await a.engine.syncNow();
    expect(s.state).toBe("not-set-up");
    expect(s.message).toBe("Run ccb login.");
    expect(s.nextRetryAt).toBeNull();
  });

  it("switching to another Drive folder starts over instead of reusing the old cursor", async () => {
    const clock = new TestClock();
    const one = new MemoryRemote();
    const two = new MemoryRemote();
    let current = one.for("one");
    const a = await computer(clock, async () => current);
    await a.engine.syncNow();
    two.files.set("dev_other12", { text: (one.files.values().next().value as { text: string }).text.replace(/dev_[a-z0-9]+/, "dev_other12"), version: ++two.version });
    current = two.for("two");
    const s = await a.engine.syncNow();
    expect(s.devices.map((d) => d.deviceId)).toEqual(["dev_other12"]);
    expect(two.pushes).toHaveLength(1); // uploaded to the new folder too
  });
});

describe("Drive for desktop folder mode", () => {
  it("two computers sync through the same devices/ layout in a shared folder", async () => {
    const clock = new TestClock();
    const folder = await mkdtemp(join(tmpdir(), "ccb-folder-"));
    try {
      const a = await computer(clock, using(new FolderRemote(folder)));
      const b = await computer(clock, using(new FolderRemote(folder)));
      await a.edit((lib, ctx, rnd) => saveNote(lib, { body: "Folder note" }, ctx, rnd));
      await round(a, b);
      expect(noteNamed(await b.data(), "Folder note")).toBeDefined();
      expect(await readFile(join(folder, "README.txt"), "utf8")).toContain("Claude Codex Custom Buttons");
      const aId = (await a.store.getDevice()).deviceId;
      expect(JSON.parse(await readFile(join(folder, "devices", `${aId}.json`), "utf8")).deviceId).toBe(aId);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("a folder that isn't there (Drive for desktop not running) is treated as offline", async () => {
    const clock = new TestClock();
    const a = await computer(clock, using(new FolderRemote(join(tmpdir(), "ccb-no-such-folder-xyz"))));
    const s = await a.engine.syncNow();
    expect(s.state).toBe("offline");
    expect(s.message).toMatch(/not available/);
  });

  it("only changed files are re-read, and a removed device file is forgotten", async () => {
    const folder = await mkdtemp(join(tmpdir(), "ccb-folder-"));
    try {
      const remote = new FolderRemote(folder);
      await mkdir(join(folder, "devices"));
      await writeFile(join(folder, "devices", "dev_aaaaaa1.json"), "{}");
      await writeFile(join(folder, "devices", "notes.txt"), "ignored");
      await writeFile(join(folder, "devices", "dev_mine123.json"), "{}");
      const first = await remote.pull(null, "dev_mine123");
      expect(first.full).toBe(true);
      expect(first.changed.map((f) => f.deviceId)).toEqual(["dev_aaaaaa1"]);
      const second = await remote.pull(first.cursor, "dev_mine123");
      expect(second.changed).toEqual([]);
      await rm(join(folder, "devices", "dev_aaaaaa1.json"));
      const third = await remote.pull(second.cursor, "dev_mine123");
      expect(third.removed).toEqual(["dev_aaaaaa1"]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
