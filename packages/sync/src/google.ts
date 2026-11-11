// Google sign-in for a desktop app (decision D28): OAuth 2.0 with PKCE and a loopback
// redirect on 127.0.0.1, offline access for a refresh token, the drive.file scope only.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { Fetch, TokenSource } from "./drive.js";
import { AuthError, OfflineError } from "./remote.js";
import type { TokenStore } from "./secrets.js";

export const SCOPE = "https://www.googleapis.com/auth/drive.file";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

/** Reads the client JSON downloaded from Google Cloud (type "Desktop app"). */
export function parseClientFile(text: string): GoogleClient {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The Google client file is not valid JSON. Download it again from Google Cloud (Credentials, OAuth client).");
  }
  const obj = raw as { installed?: { client_id?: unknown; client_secret?: unknown }; web?: unknown; clientId?: unknown; clientSecret?: unknown };
  if (typeof obj.clientId === "string" && typeof obj.clientSecret === "string") return { clientId: obj.clientId, clientSecret: obj.clientSecret };
  if (obj.web) throw new Error('This is a "Web application" client. Create a "Desktop app" client instead (docs/google-cloud-setup.md, step 4).');
  const id = obj.installed?.client_id;
  const secret = obj.installed?.client_secret;
  if (typeof id !== "string" || typeof secret !== "string") throw new Error('The Google client file has no "installed" client ID and secret. Use the JSON of a "Desktop app" client.');
  return { clientId: id, clientSecret: secret };
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function postForm(fetchImpl: Fetch, url: string, form: Record<string, string>): Promise<Response> {
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new OfflineError(`Google sign-in is unreachable (${(error as Error).message}).`);
  }
}

/** Access tokens from the stored refresh token, refreshed shortly before they expire. */
export class GoogleAuth implements TokenSource {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly client: GoogleClient,
    private readonly store: TokenStore,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async accessToken(fresh = false): Promise<string> {
    if (!fresh && this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.token;
    const refresh = await this.store.get();
    if (!refresh) throw new AuthError("Not signed in to Google Drive. Run ccb login (or press Connect Google Drive).");
    const res = await postForm(this.fetchImpl, TOKEN_URL, {
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: this.client.clientId,
      client_secret: this.client.clientSecret,
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (res.ok && body.access_token) {
      this.cached = { token: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
      return body.access_token;
    }
    this.cached = null;
    if (res.status >= 500 || res.status === 429) throw new OfflineError(`Google sign-in is busy (HTTP ${res.status}); retrying.`);
    if (body.error === "invalid_grant") {
      throw new AuthError("The Google sign-in expired or was revoked. Run ccb login (or press Reconnect Google Drive).");
    }
    if (body.error === "invalid_client" || body.error === "unauthorized_client") {
      throw new AuthError(`Google doesn't accept this OAuth client (${body.error}). Check google.clientFile, then run ccb login.`);
    }
    throw new AuthError(`Google refused the sign-in (${body.error ?? `HTTP ${res.status}`}). Run ccb login.`);
  }
}

export interface LoginOptions {
  client: GoogleClient;
  store: TokenStore;
  fetch?: Fetch;
  /** Opens the sign-in page; the default uses the OS's browser. */
  openBrowser?: (url: string) => void | Promise<void>;
  /** Called with the URL too, so the person can open it by hand. */
  onUrl?: (url: string) => void;
  timeoutMs?: number;
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Claude Codex Buttons</title>
<body style="font-family:system-ui,sans-serif;max-width:32em;margin:4em auto">
<h1>Google Drive is connected</h1><p>You can close this tab. Sync is automatic from now on.</p></body>`;

function errorPage(message: string): string {
  const safe = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
  return `<!doctype html><meta charset="utf-8"><title>Claude Codex Buttons</title><body style="font-family:system-ui,sans-serif;max-width:32em;margin:4em auto"><h1>Sign-in didn't finish</h1><p>${safe}</p></body>`;
}

/**
 * Signs in: opens Google's consent page, receives the answer on http://127.0.0.1:<port>,
 * exchanges the code (with the PKCE verifier) and stores the refresh token.
 */
export async function login(opts: LoginOptions): Promise<void> {
  const fetchImpl = opts.fetch ?? fetch;
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}`;

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Sign-in timed out. Run ccb login again.")), opts.timeoutMs ?? 5 * 60_000);
      timer.unref?.();
      server.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", redirectUri);
        if (url.pathname !== "/") {
          res.writeHead(404).end();
          return;
        }
        const finish = (ok: boolean, page: string, outcome: () => void): void => {
          res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" }).end(page);
          clearTimeout(timer);
          outcome();
        };
        if (url.searchParams.get("state") !== state) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(errorPage("This page doesn't belong to the sign-in in progress."));
          return; // keep waiting for the real answer
        }
        const error = url.searchParams.get("error");
        if (error) {
          finish(false, errorPage(error === "access_denied" ? "Access was not allowed." : error), () => reject(new Error(error === "access_denied" ? "Sign-in cancelled: access was not allowed." : `Google sign-in failed: ${error}`)));
          return;
        }
        const got = url.searchParams.get("code");
        if (!got) {
          finish(false, errorPage("Google sent no code."), () => reject(new Error("Google sent no sign-in code.")));
          return;
        }
        finish(true, DONE_PAGE, () => resolve(got));
      });
      const auth = new URL(AUTH_URL);
      for (const [k, v] of Object.entries({
        client_id: opts.client.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPE,
        access_type: "offline",
        prompt: "consent",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      })) {
        auth.searchParams.set(k, v);
      }
      const href = auth.toString();
      opts.onUrl?.(href);
      Promise.resolve((opts.openBrowser ?? openBrowser)(href)).catch(() => undefined);
    });

    const res = await postForm(fetchImpl, TOKEN_URL, {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: opts.client.clientId,
      client_secret: opts.client.clientSecret,
    });
    const body = (await res.json().catch(() => ({}))) as { refresh_token?: string; scope?: string; error?: string; error_description?: string };
    if (res.ok && typeof body.scope === "string" && !body.scope.split(/\s+/).includes(SCOPE)) {
      throw new Error("Access to Google Drive wasn't allowed. Run ccb login again and tick the Google Drive permission.");
    }
    if (!res.ok) throw new Error(`Google refused the sign-in code (${body.error ?? `HTTP ${res.status}`}${body.error_description ? `: ${body.error_description}` : ""}).`);
    if (!body.refresh_token) throw new Error("Google didn't return a refresh token. Remove the app's access in your Google Account (Third-party connections), then run ccb login again.");
    await opts.store.set(body.refresh_token);
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

/** Signs out: revokes the token with Google (if reachable) and deletes it here. */
export async function logout(opts: { store: TokenStore; fetch?: Fetch }): Promise<{ revoked: boolean }> {
  const token = await opts.store.get();
  let revoked = false;
  if (token) {
    try {
      const res = await (opts.fetch ?? fetch)(REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString() });
      revoked = res.ok;
    } catch {
      // offline: the token is still deleted here; it can be removed in the Google Account too
    }
  }
  await opts.store.delete();
  return { revoked };
}

/** Opens a URL in the default browser, without a shell. */
export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd as string, args as string[], { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // the URL is printed too
  }
}
