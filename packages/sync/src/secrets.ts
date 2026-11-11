// Where the Google refresh token is kept (decision D27). The plugin's server is one
// bundled JavaScript file with no native modules, so it uses each OS's own tool:
//   macOS    the login Keychain, through `security`
//   Linux    the Secret Service (GNOME Keyring, KWallet), through libsecret's `secret-tool`
//   Windows  a file encrypted for the current user with DPAPI, through PowerShell
// A plain file readable only by you is used only when google.tokenStore is "file".
// The token is passed on standard input or in a file, never on a command line.
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { readText, writeFileAtomic } from "@ccb/store";

export const SERVICE = "claude-codex-buttons";
export const ACCOUNT = "google-refresh-token";

export interface TokenStore {
  /** Shown by ccb status and doctor, e.g. "macOS Keychain". */
  readonly name: string;
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  delete(): Promise<void>;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a program without a shell. Rejects with code ENOENT when it isn't installed. */
export type CommandRunner = (command: string, args: string[], opts?: { input?: string; env?: Record<string, string> }) => Promise<RunResult>;

export const runCommand: CommandRunner = (command, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...opts.env }, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(opts.input ?? "");
  });

export class TokenStoreError extends Error {
  override name = "TokenStoreError";
}

/** Google refresh tokens use only these characters; anything else is refused rather than quoted. */
const TOKEN_RE = /^[A-Za-z0-9._/+=-]{10,2048}$/;

function checkToken(token: string): void {
  if (!TOKEN_RE.test(token)) throw new TokenStoreError("The sign-in token has unexpected characters; it was not stored.");
}

export class MacKeychainStore implements TokenStore {
  readonly name = "macOS Keychain";
  constructor(private readonly run: CommandRunner = runCommand) {}

  async get(): Promise<string | null> {
    const r = await this.run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
    if (r.code === 0) return r.stdout.trim() || null;
    if (r.code === 44) return null; // errSecItemNotFound
    throw new TokenStoreError(`The Keychain couldn't be read: ${r.stderr.trim() || `exit ${r.code}`}`);
  }

  async set(token: string): Promise<void> {
    checkToken(token);
    // `security -i` reads commands from standard input, so the token isn't on a command line.
    // Every word here is free of spaces and quotes, so no quoting rules come into play.
    const r = await this.run("security", ["-i"], { input: `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -l ${SERVICE} -w ${token}\n` });
    if (r.code !== 0 || /error/i.test(r.stderr)) throw new TokenStoreError(`The Keychain refused the token: ${r.stderr.trim() || `exit ${r.code}`}`);
  }

  async delete(): Promise<void> {
    const r = await this.run("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
    if (r.code !== 0 && r.code !== 44) throw new TokenStoreError(`The Keychain entry couldn't be removed: ${r.stderr.trim() || `exit ${r.code}`}`);
  }
}

export class SecretToolStore implements TokenStore {
  readonly name = "Secret Service (secret-tool)";
  constructor(private readonly run: CommandRunner = runCommand) {}

  async get(): Promise<string | null> {
    const r = await this.run("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]);
    if (r.code === 0) return r.stdout.trim() || null;
    if (r.stderr.trim() === "") return null; // not found: exit 1 with nothing on stderr
    throw new TokenStoreError(`The Secret Service couldn't be read: ${r.stderr.trim()}`);
  }

  async set(token: string): Promise<void> {
    checkToken(token);
    const r = await this.run("secret-tool", ["store", "--label=Claude Codex Buttons (Google Drive)", "service", SERVICE, "account", ACCOUNT], { input: token });
    if (r.code !== 0) throw new TokenStoreError(`The Secret Service refused the token: ${r.stderr.trim() || `exit ${r.code}`}`);
  }

  async delete(): Promise<void> {
    const r = await this.run("secret-tool", ["clear", "service", SERVICE, "account", ACCOUNT]);
    if (r.code !== 0 && r.stderr.trim() !== "") throw new TokenStoreError(`The Secret Service entry couldn't be removed: ${r.stderr.trim()}`);
  }
}

const PS_PROTECT =
  "Add-Type -AssemblyName System.Security; $t=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($t); " +
  "$e=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); " +
  "[IO.File]::WriteAllBytes($env:CCB_TOKEN_FILE,$e)";
const PS_UNPROTECT =
  "Add-Type -AssemblyName System.Security; $e=[IO.File]::ReadAllBytes($env:CCB_TOKEN_FILE); " +
  "$b=[Security.Cryptography.ProtectedData]::Unprotect($e,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); " +
  "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))";

export class WindowsDpapiStore implements TokenStore {
  readonly name = "Windows (DPAPI-encrypted file)";
  readonly path: string;
  constructor(home: string, private readonly run: CommandRunner = runCommand) {
    this.path = join(home, "google-token.dpapi");
  }

  async get(): Promise<string | null> {
    if ((await readText(this.path)) === null) return null;
    const r = await this.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_UNPROTECT], { env: { CCB_TOKEN_FILE: this.path } });
    if (r.code !== 0) throw new TokenStoreError(`The saved sign-in couldn't be decrypted: ${r.stderr.trim() || `exit ${r.code}`}`);
    return r.stdout.trim() || null;
  }

  async set(token: string): Promise<void> {
    checkToken(token);
    const r = await this.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_PROTECT], { input: token, env: { CCB_TOKEN_FILE: this.path } });
    if (r.code !== 0) throw new TokenStoreError(`The sign-in couldn't be encrypted: ${r.stderr.trim() || `exit ${r.code}`}`);
  }

  async delete(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

/** Opt-in only (google.tokenStore = "file"): a file readable only by you. */
export class FileTokenStore implements TokenStore {
  readonly name = "file (readable only by you)";
  readonly path: string;
  constructor(home: string) {
    this.path = join(home, "google-token.json");
  }

  async get(): Promise<string | null> {
    const text = await readText(this.path);
    if (text === null) return null;
    try {
      const token = (JSON.parse(text) as { refreshToken?: unknown }).refreshToken;
      return typeof token === "string" && token ? token : null;
    } catch {
      return null;
    }
  }

  async set(token: string): Promise<void> {
    checkToken(token);
    await writeFileAtomic(this.path, `${JSON.stringify({ refreshToken: token })}\n`, 0o600);
  }

  async delete(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

/**
 * The token store for this computer, or why there is none. On Linux the Secret Service
 * must answer (it needs a desktop session); a cloud container usually has none.
 */
export async function chooseTokenStore(opts: {
  home: string;
  setting: "os" | "file";
  platform?: NodeJS.Platform;
  run?: CommandRunner;
}): Promise<TokenStore | { unavailable: string }> {
  const run = opts.run ?? runCommand;
  if (opts.setting === "file") return new FileTokenStore(opts.home);
  const platform = opts.platform ?? process.platform;
  if (platform === "darwin") return new MacKeychainStore(run);
  if (platform === "win32") return new WindowsDpapiStore(opts.home, run);
  try {
    const store = new SecretToolStore(run);
    await store.get(); // throws when secret-tool is missing or the Secret Service doesn't answer
    return store;
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      unavailable: missing
        ? "No credential store: install secret-tool (package libsecret-tools or libsecret), or set google.tokenStore to file."
        : `No credential store: the Secret Service didn't answer (${(error as Error).message}). Set google.tokenStore to file to keep the token in a file instead.`,
    };
  }
}
