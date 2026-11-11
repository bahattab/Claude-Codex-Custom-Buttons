import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { LibraryStore } from "@ccb/store";
import { createSyncEngine, type SyncEngine } from "@ccb/sync";
import { createServer } from "@ccb/mcp-server";

import { TestClock } from "../../sync/test/helpers.js";

const dirs: string[] = [];
const clients: Client[] = [];
afterEach(async () => {
  while (clients.length) await clients.pop()?.close();
  while (dirs.length) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

async function serverFor(home: string, clock?: TestClock): Promise<{ call: (name: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>; engine: SyncEngine; store: LibraryStore }> {
  const store = new LibraryStore({ home, ...(clock ? { now: () => clock.now() } : {}) });
  const engine = createSyncEngine(store, clock ? { scheduler: clock } : {});
  const server = createServer(store, { sync: engine });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  clients.push(client);
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    engine,
    store,
    async call(name, args = {}) {
      const raw = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
      if (raw.isError) throw new Error(`${name}: ${raw.content[0]?.text}`);
      return JSON.parse(raw.content[0]?.text ?? "{}") as Record<string, unknown>;
    },
  };
}

describe("sync through ccb-mcp", () => {
  it("sync_status says sync isn't set up on a new install, without failing", async () => {
    const a = await serverFor(await tmp("ccb-mcp-sync-"));
    const status = await a.call("sync_status");
    expect(status["state"]).toBe("not-set-up");
    expect(String(status["message"])).toMatch(/google-cloud-setup/);
    expect((await a.call("sync_now"))["state"]).toBe("not-set-up");
  });

  it("two computers in Drive-folder mode: a prompt saved on one appears on the other after sync_now", async () => {
    const folder = await tmp("ccb-shared-");
    const a = await serverFor(await tmp("ccb-mcp-a-"));
    const b = await serverFor(await tmp("ccb-mcp-b-"));
    for (const s of [a, b]) {
      await s.store.update((lib) => ({ ...lib, settings: { ...lib.settings, sync: { ...lib.settings.sync, mode: "drive-folder", folderPath: folder } } }));
    }
    await a.call("bank_save", { title: "Synced prompt", body: "Hello from A" });
    await a.call("notes_write", { body: "Synced note" });
    expect((await a.call("sync_now"))["state"]).toBe("idle");
    expect((await b.call("sync_now"))["state"]).toBe("idle");
    const found = (await b.call("bank_search", { query: "synced" })) as { results: Array<{ title: string }> };
    expect(found.results.map((r) => r.title)).toContain("Synced prompt");
    const notes = (await b.call("notes_list")) as { notes: Array<{ title: string }> };
    expect(notes.notes.map((n) => n.title)).toContain("Synced note");
    const status = await b.call("sync_status");
    expect(status["pending"]).toBe(0);
    expect((status["devices"] as unknown[]).length).toBe(1);
  });

  it("a change made through a tool is uploaded by itself after sync.pushDelayMs", async () => {
    const clock = new TestClock();
    const folder = await tmp("ccb-shared-");
    const a = await serverFor(await tmp("ccb-mcp-a-"), clock);
    await a.store.update((lib) => ({ ...lib, settings: { ...lib.settings, sync: { ...lib.settings.sync, mode: "drive-folder", folderPath: folder } } }));
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setImmediate(r));
        await a.engine.idle();
      }
    };
    a.engine.start();
    await settle();
    await a.call("variables_set", { name: "colour", value: "blue" });
    expect(((await a.call("sync_status")) as { pending: number }).pending).toBe(1);
    await clock.advance(2000, settle);
    expect(((await a.call("sync_status")) as { pending: number }).pending).toBe(0);
    a.engine.stop();
  });
});
