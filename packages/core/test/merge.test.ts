import { describe, expect, it } from "vitest";
import { contentHash, merge, needsPush, sameData, toDeviceFile } from "../src/index.js";
import { emptyBase, RETENTION_DAYS } from "../src/sync/merge.js";
import { Device, at, ctx, emptyData, newNote, newPrompt } from "./helpers.js";
import type { DeviceFile } from "../src/index.js";

const A = "dev_laptop01";
const B = "dev_desktop2";
const C = "dev_workpc03";
const DAY = 24 * 60;

function devices(): [Device, Device, Device, Map<string, DeviceFile>] {
  return [new Device(A), new Device(B), new Device(C), new Map()];
}

/** Everyone syncs twice, in order, so all changes have reached everyone. */
function settle(drive: Map<string, DeviceFile>, list: Device[], minutes: number): void {
  for (let round = 0; round < 2; round++) for (const d of list) d.sync(drive, minutes + round);
}

describe("merge: basic propagation", () => {
  it("a prompt saved on one PC reaches the others", () => {
    const [a, b, , drive] = devices();
    const p = newPrompt(ctx(A, 0), "Review for security");
    a.add("prompts", p);
    a.sync(drive, 1);
    b.sync(drive, 2);
    expect(b.prompt(p.id)?.title).toBe("Review for security");
  });

  it("an edit made on another PC replaces the old version without a conflict", () => {
    const [a, b, , drive] = devices();
    const n = newNote(ctx(A, 0), "Release checklist\n- bump version");
    a.add("notes", n);
    settle(drive, [a, b], 1);
    b.edit("notes", n.id, { body: "Release checklist\n- bump version\n- tag release" }, 5);
    settle(drive, [a, b], 6);
    expect(a.note(n.id)?.body).toContain("tag release");
    expect(a.data.notes).toHaveLength(1);
    expect(sameData(a.data, b.data)).toBe(true);
  });

  it("many edits on one PC (typing in a note) never conflict with its older uploads", () => {
    const [a, b, , drive] = devices();
    const n = newNote(ctx(A, 0), "Draft");
    a.add("notes", n);
    settle(drive, [a, b], 1);
    // B received A's version, then edits it 100 times without syncing.
    for (let i = 0; i < 100; i++) b.edit("notes", n.id, { body: `Draft ${i}` }, 10 + i);
    settle(drive, [a, b], 200);
    expect(b.data.notes).toHaveLength(1);
    expect(a.note(n.id)?.body).toBe("Draft 99");
  });

  it("identical edits made on two PCs are kept once", () => {
    const [a, b, , drive] = devices();
    const p = newPrompt(ctx(A, 0), "Old title");
    a.add("prompts", p);
    settle(drive, [a, b], 1);
    a.edit("prompts", p.id, { title: "Same new title" }, 10);
    b.edit("prompts", p.id, { title: "Same new title" }, 11);
    settle(drive, [a, b], 20);
    const result = a.sync(drive, 30);
    expect(a.data.prompts).toHaveLength(1);
    expect(result.conflicts).toHaveLength(0);
  });
});

describe("merge: concurrent edits and conflict copies", () => {
  it("two PCs editing the same note offline both keep their text", () => {
    const [a, b, , drive] = devices();
    const n = newNote(ctx(A, 0), "Shopping list");
    a.add("notes", n);
    settle(drive, [a, b], 1);

    a.edit("notes", n.id, { body: "Shopping list\n- milk" }, 10); // offline
    b.edit("notes", n.id, { body: "Shopping list\n- bread" }, 12); // offline, later

    settle(drive, [a, b], 20);
    for (const d of [a, b]) {
      expect(d.note(n.id)?.body).toBe("Shopping list\n- bread"); // newer wins
      const copy = d.data.notes.find((x) => x.conflictOf === n.id);
      expect(copy?.body).toBe("Shopping list\n- milk");
      expect(copy?.title).toMatch(/\(conflict\)$/);
    }
    expect(sameData(a.data, b.data)).toBe(true);
  });

  it("every PC creates the same conflict copy, so copies never multiply", () => {
    const [a, b, c, drive] = devices();
    const p = newPrompt(ctx(A, 0), "Prompt");
    a.add("prompts", p);
    settle(drive, [a, b, c], 1);
    a.edit("prompts", p.id, { body: "A version" }, 10);
    b.edit("prompts", p.id, { body: "B version" }, 11);
    // Both merge before seeing each other's merge result.
    a.sync(drive, 20);
    b.sync(drive, 20);
    settle(drive, [a, b, c], 30);
    for (const d of [a, b, c]) expect(d.data.prompts).toHaveLength(2);
    expect(sameData(a.data, c.data)).toBe(true);
    expect(sameData(b.data, c.data)).toBe(true);
  });

  it("the merged result reports the conflict", () => {
    const [a, b, , drive] = devices();
    const p = newPrompt(ctx(A, 0), "Prompt");
    a.add("prompts", p);
    settle(drive, [a, b], 1);
    a.edit("prompts", p.id, { body: "one" }, 10);
    b.edit("prompts", p.id, { body: "two" }, 11);
    b.sync(drive, 20);
    const result = a.sync(drive, 21);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ collection: "prompts", id: p.id }),
    ]);
  });

  it("variables, buttons and categories resolve by newest edit, without copies", () => {
    const base = emptyData();
    const v = { id: "project", value: "Old", updatedAt: at(0), updatedBy: A, deletedAt: null, ancestors: [] };
    const local = { ...base, variables: [{ ...v, value: "From A", updatedAt: at(5) }] };
    const remote = toDeviceFile(
      { ...base, variables: [{ ...v, value: "From B", updatedAt: at(6), updatedBy: B }] },
      { deviceId: B, deviceName: "B", now: at(7) },
    );
    const result = merge({ local, remotes: [remote], base: emptyBase(), now: at(8), deviceId: A });
    expect(result.data.variables).toEqual([expect.objectContaining({ value: "From B" })]);
    expect(result.conflicts).toHaveLength(0);
  });
});

describe("merge: deletions", () => {
  it("a deletion reaches every PC and the prompt does not come back", () => {
    const [a, b, c, drive] = devices();
    const p = newPrompt(ctx(A, 0), "To delete");
    a.add("prompts", p);
    settle(drive, [a, b, c], 1);
    b.remove("prompts", p.id, 10);
    settle(drive, [a, b, c], 20);
    for (const d of [a, b, c]) expect(d.prompt(p.id)?.deletedAt).not.toBeNull();
  });

  it("an edit made after a deletion brings the record back", () => {
    const [a, b, , drive] = devices();
    const n = newNote(ctx(A, 0), "Note");
    a.add("notes", n);
    settle(drive, [a, b], 1);
    a.remove("notes", n.id, 10);
    b.edit("notes", n.id, { body: "Edited later" }, 12);
    settle(drive, [a, b], 20);
    expect(a.note(n.id)?.deletedAt).toBeNull();
    expect(a.note(n.id)?.body).toBe("Edited later");
    // The losing deletion leaves nothing behind: no conflict copy.
    expect(a.data.notes).toHaveLength(1);
    expect(b.data.notes).toHaveLength(1);
  });

  it("a deletion after a concurrent edit wins, and the edit is kept as a conflict copy", () => {
    const [a, b, , drive] = devices();
    const n = newNote(ctx(A, 0), "Note");
    a.add("notes", n);
    settle(drive, [a, b], 1);
    b.edit("notes", n.id, { body: "Edited offline" }, 10);
    a.remove("notes", n.id, 12);
    settle(drive, [a, b], 20);
    expect(a.note(n.id)?.deletedAt).not.toBeNull();
    expect(a.data.notes.find((x) => x.conflictOf === n.id)?.body).toBe("Edited offline");
  });

  it("tombstones older than the retention period are removed", () => {
    const [a, b, , drive] = devices();
    const p = newPrompt(ctx(A, 0), "Old");
    a.add("prompts", p);
    settle(drive, [a, b], 1);
    a.remove("prompts", p.id, 2);
    settle(drive, [a, b], 3);
    expect(a.prompt(p.id)).toBeDefined();
    const later = (RETENTION_DAYS + 1) * DAY;
    settle(drive, [a, b], later);
    expect(a.prompt(p.id)).toBeUndefined();
    expect(b.prompt(p.id)).toBeUndefined();
  });

  it("a record unchanged here and gone from newer device files is treated as deleted", () => {
    const [a, b, , drive] = devices();
    const p = newPrompt(ctx(A, 0), "Gone");
    a.add("prompts", p);
    settle(drive, [a, b], 1);
    // B's newer file no longer has the record at all (its tombstone was cleaned up).
    drive.set(B, toDeviceFile(emptyData(), { deviceId: B, deviceName: "B", now: at(10) }));
    a.sync(drive, 11);
    expect(a.prompt(p.id)).toBeUndefined();
  });

  it("a new record survives a device whose clock runs ahead and hasn't seen it yet (review C1)", () => {
    const [a, b, , drive] = devices();
    settle(drive, [a, b], 1);
    const p = newPrompt(ctx(A, 5), "Fresh");
    a.add("prompts", p);
    a.sync(drive, 5); // A uploads; B hasn't pulled yet
    // B syncs with its clock 10 minutes ahead, from data that doesn't have the prompt yet.
    drive.set(B, toDeviceFile(b.data, { deviceId: B, deviceName: "B", now: at(16) }));
    a.sync(drive, 6);
    expect(a.prompt(p.id)).toBeDefined();
    b.sync(drive, 17);
    expect(b.prompt(p.id)).toBeDefined();
  });

  it("a new record survives another device's upload that raced with it (review C1)", () => {
    const [a, b, , drive] = devices();
    settle(drive, [a, b], 1);
    const staleB = toDeviceFile(b.data, { deviceId: B, deviceName: "B", now: at(3) });
    const p = newPrompt(ctx(A, 2), "Racing");
    a.add("prompts", p);
    a.sync(drive, 2);
    drive.set(B, staleB); // B pulled before A's upload landed, and uploaded after it
    a.sync(drive, 4);
    expect(a.prompt(p.id)).toBeDefined();
  });

  it("a record changed here but missing elsewhere is kept", () => {
    const [a, b, , drive] = devices();
    const p = newPrompt(ctx(A, 0), "Mine");
    a.add("prompts", p);
    settle(drive, [a, b], 1);
    a.edit("prompts", p.id, { title: "Mine, edited" }, 5);
    drive.set(B, toDeviceFile(emptyData(), { deviceId: B, deviceName: "B", now: at(10) }));
    a.sync(drive, 11);
    expect(a.prompt(p.id)?.title).toBe("Mine, edited");
  });
});

describe("merge: offline and long absences", () => {
  it("offline edits on one PC upload and reach the others after reconnecting", () => {
    const [a, b, , drive] = devices();
    const n = newNote(ctx(A, 0), "Trip notes");
    a.add("notes", n);
    settle(drive, [a, b], 1);
    // B goes offline for a day and edits the note several times.
    for (let i = 1; i <= 5; i++) b.edit("notes", n.id, { body: `Trip notes v${i}` }, 60 * i);
    // A keeps syncing meanwhile and sees nothing new.
    a.sync(drive, 300);
    expect(a.note(n.id)?.body).toBe("Trip notes");
    // B reconnects.
    b.sync(drive, DAY);
    a.sync(drive, DAY + 1);
    expect(a.note(n.id)?.body).toBe("Trip notes v5");
  });

  it("ignores device files not updated for the retention period", () => {
    const [a, b, , drive] = devices();
    b.add("prompts", newPrompt(ctx(B, 0), "From a PC that went away"));
    b.sync(drive, 1);
    const result = a.sync(drive, (RETENTION_DAYS + 1) * DAY);
    expect(result.staleDevices).toEqual([B]);
    expect(a.data.prompts).toHaveLength(0);
  });

  it("a returning PC keeps its own unsynced edits", () => {
    const [a, b, , drive] = devices();
    const n = newNote(ctx(A, 0), "Long trip");
    a.add("notes", n);
    settle(drive, [a, b], 1);
    b.edit("notes", n.id, { body: "Long trip: written offline" }, 10);
    const back = (RETENTION_DAYS + 5) * DAY;
    a.sync(drive, back - 1);
    b.sync(drive, back);
    a.sync(drive, back + 1);
    expect(a.note(n.id)?.body).toBe("Long trip: written offline");
  });
});

describe("merge: bookkeeping", () => {
  it("usage statistics take the largest value and never conflict", () => {
    const [a, b, , drive] = devices();
    const p = newPrompt(ctx(A, 0), "Used a lot");
    a.add("prompts", p);
    settle(drive, [a, b], 1);
    a.data = { ...a.data, prompts: a.data.prompts.map((x) => ({ ...x, useCount: 3, lastUsedAt: at(5) })) };
    b.data = { ...b.data, prompts: b.data.prompts.map((x) => ({ ...x, useCount: 7, lastUsedAt: at(4) })) };
    settle(drive, [a, b], 10);
    expect(a.prompt(p.id)).toMatchObject({ useCount: 7, lastUsedAt: at(5) });
    expect(a.data.prompts).toHaveLength(1);
  });

  it("reports changed only when local data changed, and needsPush only when Drive is behind", () => {
    const [a, b, , drive] = devices();
    a.add("prompts", newPrompt(ctx(A, 0), "One"));
    a.sync(drive, 1);
    const again = a.sync(drive, 2);
    expect(again.changed).toBe(false);
    expect(needsPush(a.data, a.file)).toBe(false);
    const first = b.sync(drive, 3);
    expect(first.changed).toBe(true);
  });

  it("records the hash of every record for the next sync", () => {
    const [a, , , drive] = devices();
    const p = newPrompt(ctx(A, 0), "Hashed");
    a.add("prompts", p);
    const result = a.sync(drive, 1);
    expect(result.base.hashes[`prompts/${p.id}`]).toBe(contentHash(p));
  });

  it("ignores this device's own file among the remotes", () => {
    const local = emptyData();
    const own = toDeviceFile(
      { ...emptyData(), prompts: [newPrompt(ctx(A, 0), "Stale copy of mine")] },
      { deviceId: A, deviceName: "A", now: at(0) },
    );
    const result = merge({ local, remotes: [own], base: emptyBase(), now: at(1), deviceId: A });
    expect(result.data.prompts).toHaveLength(0);
  });

  it("converges: three PCs with mixed edits end with identical data", () => {
    const [a, b, c, drive] = devices();
    const p1 = newPrompt(ctx(A, 0), "P1");
    const p2 = newPrompt(ctx(B, 0), "P2");
    const n1 = newNote(ctx(C, 0), "N1");
    a.add("prompts", p1);
    b.add("prompts", p2);
    c.add("notes", n1);
    settle(drive, [a, b, c], 1);
    a.edit("prompts", p2.id, { title: "P2 by A" }, 10);
    b.edit("prompts", p2.id, { title: "P2 by B" }, 11);
    c.edit("notes", n1.id, { body: "N1 by C" }, 12);
    b.remove("prompts", p1.id, 13);
    c.edit("prompts", p1.id, { title: "P1 by C" }, 9);
    settle(drive, [c, a, b], 20);
    expect(sameData(a.data, b.data)).toBe(true);
    expect(sameData(b.data, c.data)).toBe(true);
  });
});
