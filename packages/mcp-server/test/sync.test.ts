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

describe("sync tools without sync, and other error paths", () => {
  async function bare(home: string, opts: Parameters<typeof createServer>[1] = {}) {
    const store = new LibraryStore({ home });
    const server = createServer(store, opts);
    const [x, y] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    clients.push(client);
    await Promise.all([server.connect(x), client.connect(y)]);
    const raw = async (name: string, args: Record<string, unknown> = {}) =>
      (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
    return { store, raw };
  }

  it("say that sync isn't running when the server has no engine", async () => {
    const { raw } = await bare(await tmp("ccb-mcp-bare-"));
    for (const name of ["sync_status", "sync_now", "sync_connect"]) {
      const r = await raw(name);
      if (name === "sync_connect") {
        expect(r.isError).toBe(true); // no client set up
      } else {
        expect(r.isError).toBe(true);
        expect(r.content[0]?.text).toMatch(/Sync isn't running/);
      }
    }
    const state = JSON.parse((await raw("client_state")).content[0]?.text ?? "{}") as { sync: unknown };
    expect(state.sync).toBeNull();
  });

  it("sync_connect explains a missing credential store; conflict_resolve refuses a non-copy and handles prompts", async () => {
    const home = await tmp("ccb-mcp-err-");
    const { saveClient } = await import("@ccb/sync");
    await saveClient(home, { clientId: "id", clientSecret: "s" });
    const { raw, store } = await bare(home, {
      connect: { platform: "linux", run: async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" })) },
    });
    const c = await raw("sync_connect");
    expect(c.isError).toBe(true);
    expect(c.content[0]?.text).toMatch(/secret-tool/);
    expect((await raw("conflict_resolve", { collection: "notes", copyId: "01JC8Z5K2V9Q4W7E3R6T1Y0V8K", keep: "both" })).isError).toBe(true);
    const saved = JSON.parse((await raw("bank_save", { title: "P", body: "b" })).content[0]?.text ?? "{}") as { saved: { id: string } };
    await store.update((lib) => {
      const p = lib.prompts.find((x) => x.id === saved.saved.id);
      if (!p) throw new Error("missing");
      return { ...lib, prompts: [...lib.prompts, { ...p, id: "01JC8Z5K2V9Q4W7E3R6T1Y0V8M", title: "P (conflict)", body: "other", conflictOf: p.id, ancestors: [] }] };
    });
    const kept = await raw("conflict_resolve", { collection: "prompts", copyId: "01JC8Z5K2V9Q4W7E3R6T1Y0V8M", keep: "both" });
    expect(kept.isError).toBeFalsy();
    const refused = await raw("conflict_resolve", { collection: "prompts", copyId: saved.saved.id, keep: "original" });
    expect(refused.content[0]?.text).toMatch(/not a conflict copy/);
  });

  it("sync_connect reports a sign-in that fails, and the timeout message points at the button", async () => {
    const home = await tmp("ccb-mcp-fail-");
    const { saveClient } = await import("@ccb/sync");
    await saveClient(home, { clientId: "id", clientSecret: "s" });
    const store = new LibraryStore({ home });
    await store.update((lib) => ({ ...lib, settings: { ...lib.settings, google: { ...lib.settings.google, tokenStore: "file" } } }));
    const engine = createSyncEngine(store);
    const { raw } = await bare(home, {
      sync: engine,
      connect: {
        fetch: async () => Response.json({ error: "invalid_grant" }, { status: 400 }),
        openBrowser: async (href) => {
          const a = new URL(href);
          await fetch(`${a.searchParams.get("redirect_uri")}/?code=c&state=${a.searchParams.get("state")}`);
        },
      },
    });
    const started = JSON.parse((await raw("sync_connect")).content[0]?.text ?? "{}") as { state: string };
    expect(started.state).toBe("waiting");
    let status: { connect: { state: string; message: string } } = { connect: { state: "waiting", message: "" } };
    for (let i = 0; i < 100 && status.connect.state === "waiting"; i++) {
      await new Promise((r) => setTimeout(r, 20));
      status = JSON.parse((await raw("sync_status")).content[0]?.text ?? "{}") as typeof status;
    }
    expect(status.connect.state).toBe("failed");
    expect(status.connect.message).toMatch(/invalid_grant/);
  });
});

describe("Codex skills follow buttons and favourites", () => {
  it("a button saved through a tool becomes a $ccb- skill in Codex's folder by itself", async () => {
    const home = await tmp("ccb-mcp-codex-");
    const codex = await tmp("ccb-codex-home-");
    const { mkdir: mk } = await import("node:fs/promises");
    await mk(join(codex, "plugins", "cache", "ccb-codex"), { recursive: true }); // the Codex plugin is installed
    const store = new LibraryStore({ home });
    const server = createServer(store, { codexHome: codex });
    const [x, y] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    clients.push(client);
    await Promise.all([server.connect(x), client.connect(y)]);
    await client.callTool({ name: "buttons_save", arguments: { id: "btn_ship", label: "Ship it", action: { type: "submit", text: "Ship {{?what}}" } } });
    const { readFile } = await import("node:fs/promises");
    let text: string | null = null;
    for (let i = 0; i < 50 && text === null; i++) {
      await new Promise((r) => setTimeout(r, 50));
      text = await readFile(join(codex, "skills", "ccb-ship", "SKILL.md"), "utf8").catch(() => null);
    }
    expect(text).toContain("Ship <value 1: what>");
  });
});

describe("translate through ccb-mcp", () => {
  it("translate_instructions and the ccb-translate prompt follow the translate settings", async () => {
    const home = await tmp("ccb-mcp-tr-");
    const store = new LibraryStore({ home });
    await store.update((lib) => ({ ...lib, settings: { ...lib.settings, translate: { ...lib.settings.translate, primary: "Arabic", secondary: "French" } } }));
    const server = createServer(store);
    const [x, y] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    clients.push(client);
    await Promise.all([server.connect(x), client.connect(y)]);
    const raw = (await client.callTool({ name: "translate_instructions", arguments: { text: "Hello" } })) as { content: Array<{ text: string }> };
    const req = JSON.parse(raw.content[0]?.text ?? "{}") as { system: string; user: string };
    expect(req.user).toContain("Translate into Arabic. If the text is already in Arabic, translate it into French instead.");
    const to = JSON.parse(((await client.callTool({ name: "translate_instructions", arguments: { text: "Hello", to: "German" } })) as { content: Array<{ text: string }> }).content[0]?.text ?? "{}") as { user: string };
    expect(to.user).toContain("Translate into German.");
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("ccb-translate");
    const got = await client.getPrompt({ name: "ccb-translate", arguments: { text: "Bonjour", to: "English" } });
    expect((got.messages[0]?.content as { text: string }).text).toContain("Translate into English.");
    const state = JSON.parse(((await client.callTool({ name: "client_state", arguments: {} })) as { content: Array<{ text: string }> }).content[0]?.text ?? "{}") as { settings: { translate: { primary: string } } };
    expect(state.settings.translate.primary).toBe("Arabic");
  });
});
