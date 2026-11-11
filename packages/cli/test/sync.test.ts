import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "@ccb/cli";
import { REVOKE_URL, TOKEN_URL } from "@ccb/sync";

import { FakeDrive } from "../../sync/test/fake-drive.js";

let home: string;
let clientFile: string;
const REFRESH = "1//0cli-refresh_token";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ccb-cli-sync-"));
  clientFile = join(home, "client_secret_test.json");
  await writeFile(clientFile, JSON.stringify({ installed: { client_id: "cid.apps.googleusercontent.com", client_secret: "sec" } }));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** Google's token and revoke endpoints plus a fake Drive, behind one fetch. */
function google(drive: FakeDrive) {
  const revoked: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === TOKEN_URL) {
      const form = new URLSearchParams(String(init?.body));
      if (form.get("grant_type") === "authorization_code") return Response.json({ access_token: "token-1", refresh_token: REFRESH, expires_in: 3600 });
      if (form.get("refresh_token") === REFRESH) return Response.json({ access_token: "token-1", expires_in: 3600 });
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (url === REVOKE_URL) {
      revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
      return new Response("", { status: 200 });
    }
    return drive.fetch(url, init);
  };
  const browser = async (href: string): Promise<void> => {
    const auth = new URL(href);
    await fetch(`${auth.searchParams.get("redirect_uri")}/?code=abc&state=${auth.searchParams.get("state")}`);
  };
  return { fetchImpl, browser, revoked };
}

async function ccb(args: string[], sync?: object): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { env: { CCB_HOME: home }, out: (t) => out.push(t), err: (t) => err.push(t), ...(sync ? { sync } : {}) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("ccb login, status, sync, logout", () => {
  it("signs in, keeps the token in the chosen store, syncs at once, and signs out with a revoke", async () => {
    const drive = new FakeDrive();
    const g = google(drive);
    const sync = { fetch: g.fetchImpl, openBrowser: g.browser };
    expect((await ccb(["config", "set", "google.tokenStore", "file"])).code).toBe(0);

    const login = await ccb(["login", "--client", clientFile], sync);
    expect(login.err).toBe("");
    expect(login.code).toBe(0);
    expect(login.out).toMatch(/accounts\.google\.com/);
    expect(login.out).toMatch(/Signed in/);
    expect(login.out).toMatch(/Sync ✓/);
    expect((await stat(join(home, "google-token.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, "google-client.json"))).mode & 0o777).toBe(0o600);
    expect(drive.folderNamed("Claude Codex Buttons")).toHaveLength(1);

    expect((await ccb(["status"], sync)).out).toMatch(/Sync ✓/);
    const synced = await ccb(["sync"], sync);
    expect(synced.code).toBe(0);
    const doctor = await ccb(["doctor"], sync);
    expect(doctor.out).toMatch(/\[ok\]\s+Signed in/);
    expect(doctor.out).toMatch(/\[ok\]\s+Google OAuth client/);

    const logout = await ccb(["logout"], sync);
    expect(logout.out).toMatch(/revoked/);
    expect(g.revoked).toEqual([REFRESH]);
    const after = await ccb(["sync"], sync);
    expect(after.code).toBe(1);
    expect(after.out).toMatch(/sign in/);
  });

  it("login without a client explains the setup; sync when offline says changes wait", async () => {
    const noClient = await ccb(["login"]);
    expect(noClient.code).toBe(2);
    expect(noClient.err).toMatch(/google-cloud-setup/);

    const drive = new FakeDrive();
    const g = google(drive);
    const sync = { fetch: g.fetchImpl, openBrowser: g.browser };
    await ccb(["config", "set", "google.tokenStore", "file"]);
    await ccb(["login", "--client", clientFile], sync);
    await ccb(["config", "set", "regenerate.autoSubmit", "true"]);
    drive.offline = true;
    const offline = await ccb(["sync"], sync);
    expect(offline.code).toBe(1);
    expect(offline.out).toMatch(/Sync offline/);
  });

  it("a fresh install's doctor warns that sync isn't set up, but passes", async () => {
    const doctor = await ccb(["doctor"]);
    expect(doctor.code).toBe(0);
    expect(doctor.out).toMatch(/\[warn\] Google Drive sync isn't set up yet/);
  });

  it("Drive-folder mode: status and doctor report the folder", async () => {
    const folder = await mkdtemp(join(tmpdir(), "ccb-cli-folder-"));
    try {
      await ccb(["config", "set", "sync.mode", "drive-folder"]);
      expect((await ccb(["sync"])).out).toMatch(/not set up/);
      await ccb(["config", "set", "sync.folderPath", folder]);
      expect((await ccb(["sync"])).code).toBe(0);
      expect((await ccb(["doctor"])).out).toMatch(/\[ok\]\s+Sync folder/);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

describe("without a credential store", () => {
  const noStore = { platform: "linux" as const, run: async () => Promise.reject(Object.assign(new Error("spawn secret-tool ENOENT"), { code: "ENOENT" })) };

  it("login, logout and doctor explain it instead of failing obscurely", async () => {
    const login = await ccb(["login", "--client", clientFile], noStore);
    expect(login.code).toBe(1);
    expect(login.err).toMatch(/secret-tool/);
    expect((await ccb(["logout"], noStore)).out).toMatch(/Not signed in/);
    const doctor = await ccb(["doctor"], noStore);
    expect(doctor.out).toMatch(/\[warn\] No credential store/);
    expect((await ccb(["status"], noStore)).out).toMatch(/not set up/); // login stopped before saving the client
  });

  it("login --client with a missing file is a usage error; sync off is fine", async () => {
    expect((await ccb(["login", "--client", join(home, "nope.json")])).code).toBe(2);
    await ccb(["config", "set", "sync.mode", "off"]);
    expect((await ccb(["sync"])).code).toBe(0);
    expect((await ccb(["doctor"])).out).toMatch(/Sync is off/);
  });

  it("a token store that errors is reported by doctor", async () => {
    await writeFile(join(home, "google-client.json"), JSON.stringify({ clientId: "a", clientSecret: "b" }));
    const broken = { platform: "darwin" as const, run: async () => ({ code: 9, stdout: "", stderr: "keychain locked" }) };
    expect((await ccb(["doctor"], broken)).out).toMatch(/keychain locked/);
  });
});

describe("a cancelled login changes nothing (review M4)", () => {
  it("keeps the sync mode and saves no client when sign-in is refused", async () => {
    const folder = await mkdtemp(join(tmpdir(), "ccb-cli-keep-"));
    try {
      await ccb(["config", "set", "sync.mode", "drive-folder"]);
      await ccb(["config", "set", "sync.folderPath", folder]);
      await ccb(["config", "set", "google.tokenStore", "file"]);
      const refuse = async (href: string): Promise<void> => {
        const a = new URL(href);
        await fetch(`${a.searchParams.get("redirect_uri")}/?error=access_denied&state=${a.searchParams.get("state")}`);
      };
      const res = await ccb(["login", "--client", clientFile], { openBrowser: refuse });
      expect(res.code).toBe(1);
      expect((await ccb(["config", "get", "sync.mode"])).out).toBe('"drive-folder"');
      await expect(stat(join(home, "google-client.json"))).rejects.toThrow();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
