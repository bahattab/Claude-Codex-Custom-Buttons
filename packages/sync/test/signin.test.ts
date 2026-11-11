import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AuthError,
  FileTokenStore,
  GoogleAuth,
  MacKeychainStore,
  OfflineError,
  SCOPE,
  SecretToolStore,
  TOKEN_URL,
  TokenStoreError,
  WindowsDpapiStore,
  chooseTokenStore,
  login,
  logout,
  parseClientFile,
  type CommandRunner,
  type TokenStore,
} from "@ccb/sync";

const CLIENT = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };
const REFRESH = "1//0refresh-TOKEN_abc";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ccb-signin-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

class MemoryStore implements TokenStore {
  name = "memory";
  token: string | null = null;
  async get() {
    return this.token;
  }
  async set(t: string) {
    this.token = t;
  }
  async delete() {
    this.token = null;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("client file", () => {
  it("reads a Desktop app client and explains the wrong kinds", () => {
    expect(parseClientFile(JSON.stringify({ installed: { client_id: "a", client_secret: "b" } }))).toEqual({ clientId: "a", clientSecret: "b" });
    expect(parseClientFile(JSON.stringify({ clientId: "a", clientSecret: "b" }))).toEqual({ clientId: "a", clientSecret: "b" });
    expect(() => parseClientFile(JSON.stringify({ web: { client_id: "a" } }))).toThrow(/Desktop app/);
    expect(() => parseClientFile("nope")).toThrow(/not valid JSON/);
    expect(() => parseClientFile("{}")).toThrow(/installed/);
  });
});

describe("login (PKCE, loopback redirect)", () => {
  async function browserThatAnswers(query: (url: URL) => Record<string, string>) {
    return async (href: string) => {
      const auth = new URL(href);
      const redirect = auth.searchParams.get("redirect_uri") ?? "";
      const params = new URLSearchParams(query(auth));
      await fetch(`${redirect}/?${params}`);
    };
  }

  it("asks for drive.file with offline access, checks state, exchanges the code with the verifier and stores the refresh token", async () => {
    const store = new MemoryStore();
    let challenge = "";
    let authUrl = new URL("http://x");
    const tokenCalls: URLSearchParams[] = [];
    const fakeFetch = async (url: string, init?: RequestInit) => {
      expect(url).toBe(TOKEN_URL);
      tokenCalls.push(new URLSearchParams(String(init?.body)));
      return json(200, { access_token: "a", refresh_token: REFRESH, expires_in: 3600 });
    };
    await login({
      client: CLIENT,
      store,
      fetch: fakeFetch,
      openBrowser: await browserThatAnswers((auth) => {
        authUrl = auth;
        challenge = auth.searchParams.get("code_challenge") ?? "";
        return { code: "the-code", state: auth.searchParams.get("state") ?? "" };
      }),
    });
    expect(authUrl.searchParams.get("scope")).toBe(SCOPE);
    expect(authUrl.searchParams.get("access_type")).toBe("offline");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const exchange = tokenCalls[0] as URLSearchParams;
    expect(exchange.get("grant_type")).toBe("authorization_code");
    expect(exchange.get("code")).toBe("the-code");
    const verifier = exchange.get("code_verifier") ?? "";
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
    expect(store.token).toBe(REFRESH);
  });

  it("ignores a request with the wrong state and keeps waiting for the real answer", async () => {
    const store = new MemoryStore();
    await login({
      client: CLIENT,
      store,
      fetch: async () => json(200, { refresh_token: REFRESH }),
      openBrowser: async (href) => {
        const auth = new URL(href);
        const redirect = auth.searchParams.get("redirect_uri") ?? "";
        const forged = await fetch(`${redirect}/?code=evil&state=wrong`);
        expect(forged.status).toBe(400);
        await fetch(`${redirect}/?code=good&state=${auth.searchParams.get("state") ?? ""}`);
      },
    });
    expect(store.token).toBe(REFRESH);
  });

  it("reports a refused consent, a refused code, and a missing refresh token", async () => {
    const store = new MemoryStore();
    await expect(
      login({ client: CLIENT, store, fetch: async () => json(200, {}), openBrowser: await browserThatAnswers((a) => ({ error: "access_denied", state: a.searchParams.get("state") ?? "" })) }),
    ).rejects.toThrow(/not allowed/);
    await expect(
      login({ client: CLIENT, store, fetch: async () => json(400, { error: "invalid_grant" }), openBrowser: await browserThatAnswers((a) => ({ code: "c", state: a.searchParams.get("state") ?? "" })) }),
    ).rejects.toThrow(/invalid_grant/);
    await expect(
      login({ client: CLIENT, store, fetch: async () => json(200, { access_token: "a" }), openBrowser: await browserThatAnswers((a) => ({ code: "c", state: a.searchParams.get("state") ?? "" })) }),
    ).rejects.toThrow(/refresh token/);
    expect(store.token).toBeNull();
  });

  it("times out when nobody signs in", async () => {
    await expect(login({ client: CLIENT, store: new MemoryStore(), openBrowser: () => undefined, timeoutMs: 50 })).rejects.toThrow(/timed out/);
  });
});

describe("GoogleAuth (access tokens)", () => {
  it("refreshes once, caches until shortly before expiry, and refreshes when asked", async () => {
    const store = new MemoryStore();
    store.token = REFRESH;
    let t = 0;
    let calls = 0;
    const auth = new GoogleAuth(CLIENT, store, async (_u, init) => {
      calls++;
      expect(new URLSearchParams(String(init?.body)).get("refresh_token")).toBe(REFRESH);
      return json(200, { access_token: `at${calls}`, expires_in: 3600 });
    }, () => t);
    expect(await auth.accessToken()).toBe("at1");
    t += 3000_000;
    expect(await auth.accessToken()).toBe("at1");
    t += 560_000; // within a minute of expiry
    expect(await auth.accessToken()).toBe("at2");
    expect(await auth.accessToken(true)).toBe("at3");
  });

  it("no token, invalid_grant and a wrong client are signed-out; 5xx and no network are offline", async () => {
    const store = new MemoryStore();
    await expect(new GoogleAuth(CLIENT, store, async () => json(200, {})).accessToken()).rejects.toBeInstanceOf(AuthError);
    store.token = REFRESH;
    await expect(new GoogleAuth(CLIENT, store, async () => json(400, { error: "invalid_grant" })).accessToken()).rejects.toThrow(/expired or was revoked/);
    await expect(new GoogleAuth(CLIENT, store, async () => json(401, { error: "invalid_client" })).accessToken()).rejects.toBeInstanceOf(AuthError);
    await expect(new GoogleAuth(CLIENT, store, async () => json(503, {})).accessToken()).rejects.toBeInstanceOf(OfflineError);
    await expect(new GoogleAuth(CLIENT, store, async () => {
      throw new TypeError("fetch failed");
    }).accessToken()).rejects.toBeInstanceOf(OfflineError);
  });
});

describe("logout", () => {
  it("revokes the token with Google and deletes it; offline still deletes", async () => {
    const store = new MemoryStore();
    store.token = REFRESH;
    let revokedToken = "";
    expect(await logout({ store, fetch: async (_u, init) => ((revokedToken = new URLSearchParams(String(init?.body)).get("token") ?? ""), json(200, {})) })).toEqual({ revoked: true });
    expect(revokedToken).toBe(REFRESH);
    expect(store.token).toBeNull();
    store.token = REFRESH;
    expect(await logout({ store, fetch: async () => {
      throw new TypeError("offline");
    } })).toEqual({ revoked: false });
    expect(store.token).toBeNull();
  });
});

describe("token stores", () => {
  function recorder(answer: (cmd: string, args: string[]) => { code: number; stdout?: string; stderr?: string } | "missing") {
    const calls: Array<{ cmd: string; args: string[]; input?: string; env?: Record<string, string> }> = [];
    const run: CommandRunner = async (cmd, args, opts = {}) => {
      calls.push({ cmd, args, ...(opts.input !== undefined ? { input: opts.input } : {}), ...(opts.env ? { env: opts.env } : {}) });
      const a = answer(cmd, args);
      if (a === "missing") throw Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
      return { code: a.code, stdout: a.stdout ?? "", stderr: a.stderr ?? "" };
    };
    return { run, calls };
  }

  it("macOS Keychain: token goes on standard input, never in arguments; not-found is empty", async () => {
    const { run, calls } = recorder((_c, args) => (args[0] === "find-generic-password" ? { code: 44 } : { code: 0 }));
    const store = new MacKeychainStore(run);
    await store.set(REFRESH);
    expect(await store.get()).toBeNull();
    await store.delete();
    for (const c of calls) expect(c.args.join(" ")).not.toContain(REFRESH);
    expect(calls[0]).toMatchObject({ cmd: "security", args: ["-i"] });
    expect(calls[0]?.input).toContain(`-w ${REFRESH}`);
  });

  it("refuses a token with characters that would need quoting", async () => {
    const { run } = recorder(() => ({ code: 0 }));
    await expect(new MacKeychainStore(run).set('bad token" ; rm')).rejects.toBeInstanceOf(TokenStoreError);
  });

  it("Linux secret-tool: store reads the token from standard input; lookup returns it", async () => {
    const { run, calls } = recorder((_c, args) => (args[0] === "lookup" ? { code: 0, stdout: `${REFRESH}\n` } : { code: 0 }));
    const store = new SecretToolStore(run);
    await store.set(REFRESH);
    expect(await store.get()).toBe(REFRESH);
    expect(calls[0]).toMatchObject({ cmd: "secret-tool", input: REFRESH });
    expect(calls[0]?.args).toEqual(["store", "--label=Claude Codex Buttons (Google Drive)", "service", "claude-codex-buttons", "account", "google-refresh-token"]);
  });

  it("Windows DPAPI: PowerShell gets the token on standard input and the file path in the environment", async () => {
    const { run, calls } = recorder(() => ({ code: 0, stdout: REFRESH }));
    const store = new WindowsDpapiStore(home, run);
    await store.set(REFRESH);
    expect(calls[0]?.cmd).toBe("powershell.exe");
    expect(calls[0]?.input).toBe(REFRESH);
    expect(calls[0]?.env?.["CCB_TOKEN_FILE"]).toBe(join(home, "google-token.dpapi"));
    expect(calls[0]?.args.join(" ")).toContain("ProtectedData]::Protect");
    expect(await store.get()).toBeNull(); // the fake runner wrote no file
  });

  it("file store (opt-in) is readable only by you", async () => {
    const store = new FileTokenStore(home);
    await store.set(REFRESH);
    expect(await store.get()).toBe(REFRESH);
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
    await store.delete();
    expect(await store.get()).toBeNull();
  });

  it("picks the OS store, the file only when asked, and explains a missing Secret Service", async () => {
    const ok = recorder(() => ({ code: 1 }));
    expect((await chooseTokenStore({ home, setting: "os", platform: "darwin", run: ok.run }) as TokenStore).name).toMatch(/Keychain/);
    expect((await chooseTokenStore({ home, setting: "os", platform: "win32", run: ok.run }) as TokenStore).name).toMatch(/DPAPI/);
    expect((await chooseTokenStore({ home, setting: "os", platform: "linux", run: ok.run }) as TokenStore).name).toMatch(/Secret Service/);
    expect((await chooseTokenStore({ home, setting: "file", platform: "linux", run: ok.run }) as TokenStore).name).toMatch(/file/);
    const missing = recorder(() => "missing");
    expect(await chooseTokenStore({ home, setting: "os", platform: "linux", run: missing.run })).toEqual({ unavailable: expect.stringMatching(/install secret-tool/) });
    const noBus = recorder(() => ({ code: 1, stderr: "Cannot autolaunch D-Bus without X11 $DISPLAY" }));
    expect(await chooseTokenStore({ home, setting: "os", platform: "linux", run: noBus.run })).toEqual({ unavailable: expect.stringMatching(/didn't answer/) });
  });
});
