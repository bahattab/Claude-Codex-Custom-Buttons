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

describe("conflicts and Connect through ccb-mcp", () => {
  it("conflict_resolve keeps the chosen version", async () => {
    const a = await serverFor(await tmp("ccb-mcp-c-"));
    const { saved } = (await a.call("notes_write", { body: "Plan\nmine" })) as { saved: { id: string } };
    // Plant a conflict copy as a merge would.
    await a.store.update((lib) => {
      const original = lib.notes.find((n) => n.id === saved.id);
      if (!original) throw new Error("missing");
      return { ...lib, notes: [...lib.notes, { ...original, id: "01JC8Z5K2V9Q4W7E3R6T1Y0V8K", title: "Plan (conflict)", body: "Plan\ntheirs", conflictOf: saved.id, ancestors: [] }] };
    });
    expect(((await a.call("sync_status")) as { conflicts: number }).conflicts).toBe(1);
    const kept = (await a.call("conflict_resolve", { collection: "notes", copyId: "01JC8Z5K2V9Q4W7E3R6T1Y0V8K", keep: "copy" })) as { kept: { id: string } };
    expect(kept.kept.id).toBe(saved.id);
    const note = (await a.call("notes_read", { id: saved.id })) as { note: { body: string } };
    expect(note.note.body).toBe("Plan\ntheirs");
    expect(((await a.call("sync_status")) as { conflicts: number }).conflicts).toBe(0);
  });

  it("sync_connect returns the sign-in link, finishes the sign-in in the background and syncs", async () => {
    const { FakeDrive } = await import("../../sync/test/fake-drive.js");
    const { TOKEN_URL, saveClient } = await import("@ccb/sync");
    const home = await tmp("ccb-mcp-connect-");
    const drive = new FakeDrive();
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> =>
      url === TOKEN_URL ? Response.json({ access_token: "token-1", refresh_token: "1//refresh_tok", expires_in: 3600 }) : drive.fetch(url, init);
    let answer: () => Promise<void> = async () => undefined;
    const store = new LibraryStore({ home });
    await store.update((lib) => ({ ...lib, settings: { ...lib.settings, google: { ...lib.settings.google, tokenStore: "file" } } }));
    const engine = createSyncEngine(store, { fetch: fetchImpl });
    const server = createServer(store, {
      sync: engine,
      connect: {
        fetch: fetchImpl,
        openBrowser: (href) => {
          const a = new URL(href);
          answer = async () => void (await fetch(`${a.searchParams.get("redirect_uri")}/?code=c&state=${a.searchParams.get("state")}`));
        },
      },
    });
    const [x, y] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    clients.push(client);
    await Promise.all([server.connect(x), client.connect(y)]);
    const call = async (name: string) => JSON.parse(((await client.callTool({ name, arguments: {} })) as { content: Array<{ text: string }> }).content[0]?.text ?? "{}") as Record<string, unknown>;
    const noClient = (await client.callTool({ name: "sync_connect", arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(noClient.isError).toBe(true);
    expect(noClient.content[0]?.text).toMatch(/google-cloud-setup/);

    await saveClient(home, { clientId: "id", clientSecret: "s" });
    const started = await call("sync_connect");
    expect(started["state"]).toBe("waiting");
    expect((await call("sync_connect"))["url"]).toBe(started["url"]); // pressing again reuses the sign-in in progress
    expect(String(started["url"])).toMatch(/^https:\/\/accounts\.google\.com\//);
    await answer();
    for (let i = 0; i < 100 && ((await call("sync_status"))["connect"] as { state: string }).state === "waiting"; i++) await new Promise((r) => setTimeout(r, 20));
    await engine.idle();
    const status = await call("sync_status");
    expect((status["connect"] as { state: string }).state).toBe("done");
    expect(status["state"]).toBe("idle");
    expect(drive.folderNamed("Claude Codex Buttons")).toHaveLength(1);
  });
});
