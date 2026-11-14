// ccb: command-line tool for Claude Codex Custom Buttons.
// run() is separate from bin.ts so tests can call it in-process.
import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  COLLECTIONS,
  DEVICE_FILE_FORMAT,
  SCHEMA_VERSION,
  SHARED_SETTING_IDS,
  defaultSettings,
  emptyBase,
  live,
  loadLibrary,
  merge,
  setSharedSetting,
  sharedSetting,
  validateDeviceFile,
  type Library,
  type LocalSettings,
  type SharedSettingId,
  type SyncMeta,
  type SyncedData,
} from "@ccb/core";
import { LibraryStore, codexHome, exists, lockIsHeld, noteFileName, readText, writeCodexSkills, writeFileAtomic, type StoreOptions } from "@ccb/store";
import {
  SyncEngine,
  formatStatus,
  statusLine as statusLineOf,
  loadClient,
  login,
  logout,
  parseClientFile,
  remoteProvider,
  saveClient,
  tokenStoreFor,
  type Fetch,
  type Scheduler,
  type SetupOptions,
  type SyncStatus,
  runCommand,
  type CommandRunner,
} from "@ccb/sync";
import { installService, pidFile, serviceStatus, stopService, uninstallService, type ServiceContext } from "./service.js";

export const CLI_VERSION = "0.1.4";
export const EXPORT_FORMAT = "ccb-export/1";

export interface Io {
  env: NodeJS.ProcessEnv;
  out: (text: string) => void;
  err: (text: string) => void;
  /** For tests: store options (home, clock). */
  store?: StoreOptions;
  /** For tests: how sync reaches Google and the OS, and the browser. */
  sync?: Omit<SetupOptions, "home"> & { openBrowser?: (url: string) => void | Promise<void>; scheduler?: Scheduler };
  /** For tests: the background service's platform, paths and command runner. */
  service?: Partial<Omit<ServiceContext, "dataHome">> & { run?: CommandRunner };
  /** Asks a yes/no question; absent when not interactive (no terminal). */
  ask?: (question: string) => Promise<string>;
  /** For tests: resolves to stop `sync --daemon`. */
  daemonUntil?: Promise<void>;
}

const HELP = `ccb ${CLI_VERSION} — Claude Codex Custom Buttons

Usage:
  ccb config list                 Show every setting
  ccb config get <key>            Show one setting
  ccb config set <key> <value>    Change a setting (use "null" to clear)
  ccb export [file]               Export prompts, buttons, variables and notes as JSON
  ccb import <file>               Merge an export, a device file or a library.json
  ccb login [--client <file>]     Sign in to Google Drive (opens the browser); --no-browser only prints the link;
                                  --service / --no-service: keep syncing in the background (asked otherwise)
  ccb logout                      Sign out of Google Drive and revoke the sign-in
  ccb sync                        Sync now (sync is automatic; this only forces it)
  ccb sync --daemon               Keep syncing until stopped (what the background service runs)
  ccb sync codex                  Write the $ccb-* Codex skills for your buttons and favourite prompts now
  ccb status                      Show the sync status and the background service
  ccb service install|status|stop|uninstall
                                  The background sync service that starts when you log in
  ccb doctor                      Check the local data folder and sync, repair what it safely can, and explain any problems
  ccb --version | --help

Data folder: --home <dir>, $CCB_HOME, or ~/.claude-codex-buttons`;

class UsageError extends Error {}

// --- settings keys --------------------------------------------------------------------

/** Every local setting as a dotted key, e.g. "sync.intervalSeconds". */
export function settingKeys(settings: LocalSettings = defaultSettings()): string[] {
  const keys: string[] = [];
  for (const [group, values] of Object.entries(settings)) {
    for (const key of Object.keys(values as Record<string, unknown>)) keys.push(`${group}.${key}`);
  }
  return keys;
}

function getSetting(settings: LocalSettings, key: string): unknown {
  const [group, name] = key.split(".") as [string, string];
  return (settings as unknown as Record<string, Record<string, unknown>>)[group]?.[name];
}

function withSetting(settings: LocalSettings, key: string, value: unknown): LocalSettings {
  const [group, name] = key.split(".") as [string, string];
  const groups = settings as unknown as Record<string, Record<string, unknown>>;
  return { ...settings, [group]: { ...groups[group], [name]: value } } as LocalSettings;
}

/** Turns command-line text into the setting's type, guided by its default value. */
function parseValue(key: string, raw: string): unknown {
  if (raw === "null") return null;
  const example = getSetting(defaultSettings(), key);
  if (typeof example === "boolean") {
    if (raw === "true" || raw === "false") return raw === "true";
    throw new UsageError(`${key} must be true or false`);
  }
  if (typeof example === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n) || raw.trim() === "") throw new UsageError(`${key} must be a number`);
    return n;
  }
  return raw;
}

const isShared = (key: string): key is SharedSettingId => (SHARED_SETTING_IDS as readonly string[]).includes(key);

// --- commands -------------------------------------------------------------------------

async function readLibrary(store: LibraryStore): Promise<Library> {
  const { library, status } = await store.read();
  if (library === null) {
    throw new Error(`library.json uses schema version ${(status as { foundVersion: number }).foundVersion}, newer than this ccb understands. Update ccb.`);
  }
  return library;
}

async function config(store: LibraryStore, args: string[], io: Io): Promise<number> {
  const [action, key, ...rest] = args;
  const keys = settingKeys();
  if (action === "list") {
    const library = await readLibrary(store);
    for (const k of keys) io.out(`${k} = ${JSON.stringify(getSetting(library.settings, k))}`);
    for (const k of SHARED_SETTING_IDS) io.out(`${k} = ${JSON.stringify(sharedSetting(library, k))}  (shared with your other devices)`);
    return 0;
  }
  if (!key) throw new UsageError(`Usage: ccb config ${action ?? "get|set"} <key>${action === "set" ? " <value>" : ""}`);
  if (!keys.includes(key) && !isShared(key)) {
    throw new UsageError(`Unknown setting "${key}". Run "ccb config list" to see them all.`);
  }
  if (action === "get") {
    const library = await readLibrary(store);
    io.out(JSON.stringify(isShared(key) ? sharedSetting(library, key) : getSetting(library.settings, key)));
    return 0;
  }
  if (action === "set") {
    if (rest.length === 0) throw new UsageError(`Usage: ccb config set ${key} <value>`);
    const raw = rest.join(" ");
    if (isShared(key)) {
      const value = raw === "null" ? null : raw;
      await store.update((lib, ctx) => {
        const r = setSharedSetting(lib, key, value, ctx);
        if (!r.ok) throw new Error(r.errors.join("; "));
        return r.value.library;
      });
    } else {
      const value = parseValue(key, raw);
      await store.update((lib) => ({ ...lib, settings: withSetting(lib.settings, key, value) }));
    }
    io.out(`${key} = ${JSON.stringify(raw === "null" ? null : isShared(key) ? raw : parseValue(key, raw))}`);
    return 0;
  }
  throw new UsageError('Usage: ccb config list | get <key> | set <key> <value>');
}

function syncedPart(library: Library): SyncedData {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, library[c]])) as unknown as SyncedData;
}

async function exportCmd(store: LibraryStore, args: string[], io: Io): Promise<number> {
  const library = await readLibrary(store);
  const device = await store.getDevice();
  const doc = { format: EXPORT_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), deviceId: device.deviceId, ...syncedPart(library) };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  const [file] = args;
  if (file) {
    await writeFileAtomic(file, text);
    io.out(`Exported ${live(library.prompts).length} prompts, ${live(library.buttons).length} buttons, ${live(library.variables).length} variables and ${live(library.notes).length} notes to ${file}`);
  } else {
    io.out(text.trimEnd());
  }
  return 0;
}

async function importCmd(store: LibraryStore, args: string[], io: Io): Promise<number> {
  const [file] = args;
  if (!file) throw new UsageError("Usage: ccb import <file>");
  const text = await readText(file);
  if (text === null) throw new Error(`File not found: ${file}`);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
  const isLibrary = raw["format"] === undefined && "settings" in raw && "schemaVersion" in raw;
  const known = raw["format"] === EXPORT_FORMAT || raw["format"] === DEVICE_FILE_FORMAT || isLibrary;
  if (!known) throw new Error(`${file} is not a ccb export, device file or library.json`);
  if (isLibrary) {
    // Upgrade an older library.json to the current format first.
    const loaded = loadLibrary(raw);
    if (!loaded.ok) {
      io.err(`${file} has problems and was not imported:`);
      for (const e of loaded.errors.slice(0, 20)) io.err(`  - ${e}`);
      return 1;
    }
    if (loaded.library === null) throw new Error(`${file} is from a newer version (schema ${loaded.foundVersion}); update ccb`);
    raw = loaded.library as unknown as Record<string, unknown>;
  }

  const candidate = {
    format: DEVICE_FILE_FORMAT,
    schemaVersion: raw["schemaVersion"],
    deviceId: "dev_importfile",
    deviceName: "Imported file",
    syncedAt: new Date().toISOString(),
    ...Object.fromEntries(COLLECTIONS.map((c) => [c, raw[c] ?? []])),
  };
  const checked = validateDeviceFile(candidate);
  if (!checked.ok) {
    io.err(`${file} has problems and was not imported:`);
    for (const e of checked.errors.slice(0, 20)) io.err(`  - ${e}`);
    return 1;
  }

  let before: Library | null = null;
  let conflicts = 0;
  const after = await store.update((lib, ctx) => {
    before = lib;
    const result = merge({ local: syncedPart(lib), remotes: [checked.value], base: emptyBase(), now: ctx.now, deviceId: ctx.deviceId });
    const existing = new Set(lib.prompts.map((p) => p.id).concat(lib.notes.map((n) => n.id)));
    conflicts = result.conflicts.filter((c) => !existing.has(c.copyId)).length; // only new ones
    return { ...lib, ...result.data };
  });
  const count = (lib: Library | null, c: "prompts" | "buttons" | "variables" | "notes"): number => (lib ? live(lib[c] as SyncMeta[]).length : 0);
  io.out(
    `Imported ${file}: prompts ${count(before, "prompts")} → ${count(after, "prompts")}, buttons ${count(before, "buttons")} → ${count(after, "buttons")}, variables ${count(before, "variables")} → ${count(after, "variables")}, notes ${count(before, "notes")} → ${count(after, "notes")}${conflicts ? `; ${conflicts} conflict copies to review` : ""}.`,
  );
  return 0;
}

type Level = "ok" | "warn" | "fail";

async function doctor(store: LibraryStore, io: Io): Promise<number> {
  const results: Array<[Level, string]> = [];
  const add = (level: Level, text: string): void => {
    results.push([level, text]);
  };

  const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
  if (major > 22 || (major === 22 && minor >= 12)) add("ok", `Node.js ${process.versions.node}`);
  else add("fail", `Node.js ${process.versions.node} is too old: install Node.js 22.12 or newer`);

  const { paths } = store;
  const result = await store.read().catch((e: Error) => e);
  if (result instanceof Error) {
    add("fail", `Cannot read the data folder ${paths.home}: ${result.message}`);
  } else {
    const { library, status } = result;
    if (status.kind === "ok") add("ok", `Library ${paths.library} (revision ${library?.revision})`);
    if (status.kind === "created") add("ok", `Library created at ${paths.library} with the starter pack`);
    if (status.kind === "recovered") {
      add("warn", status.brokenFile ? `library.json was damaged and was restored from the backup; the damaged file is ${status.brokenFile}` : "library.json was missing and was restored from the backup");
    }
    if (status.kind === "reset") add("warn", `library.json was damaged and no usable backup existed; started a new library. The damaged file is ${status.brokenFile}`);
    if (status.kind === "read-only") add("fail", `library.json uses schema version ${status.foundVersion}; update ccb to edit it`);

    try {
      await access(paths.home, fsConstants.W_OK);
      add("ok", `Data folder is writable: ${paths.home}`);
    } catch {
      add("fail", `Data folder is not writable: ${paths.home}`);
    }

    if (library && library.revision > 0) {
      const backup = await readText(paths.backup);
      if (backup === null) add("warn", "No backup yet (library.bak.json); one is written on the next change");
      else {
        let valid: boolean;
        try {
          const loaded = loadLibrary(JSON.parse(backup));
          valid = loaded.ok && loaded.library !== null;
        } catch {
          valid = false;
        }
        add(valid ? "ok" : "warn", valid ? "Backup library.bak.json is valid" : "Backup library.bak.json is damaged; it is replaced on the next change");
      }
    }

    const device = await store.getDevice();
    add("ok", `Device ${device.deviceId} (${device.deviceName})`);

    if (await exists(paths.lock)) {
      add(await lockIsHeld(paths.lock) ? "ok" : "warn", (await lockIsHeld(paths.lock)) ? "Another ccb process is writing right now" : "A stale lock file was found; it is cleared automatically on the next change");
    }

    if (library?.settings.notes.mirrorFiles) {
      let missing = 0;
      for (const note of live(library.notes)) {
        if (!(await exists(`${paths.notes}/${noteFileName(note)}`))) missing++;
      }
      if (missing) add("warn", `${missing} note file(s) missing in ${paths.notes}; they are recreated automatically`);
      else add("ok", `Notes mirror: ${live(library.notes).length} note file(s) in ${paths.notes}`);
    }

    if (library) for (const [level, text] of await syncChecks(store, library, io)) add(level, text);
  }

  const mark: Record<Level, string> = { ok: "[ok]  ", warn: "[warn]", fail: "[FAIL]" };
  for (const [level, text] of results) io.out(`${mark[level]} ${text}`);
  return results.some(([level]) => level === "fail") ? 1 : 0;
}

// --- sync ------------------------------------------------------------------------------

function setup(store: LibraryStore, io: Io): SetupOptions {
  const { openBrowser: _o, scheduler: _s, ...rest } = io.sync ?? {};
  return { ...rest, home: store.paths.home };
}

function engineFor(store: LibraryStore, io: Io): SyncEngine {
  return new SyncEngine({ store, remote: remoteProvider(setup(store, io)), ...(io.sync?.scheduler ? { scheduler: io.sync.scheduler } : {}) });
}

function printStatus(status: SyncStatus, io: Io): void {
  for (const line of formatStatus(status)) io.out(line);
}

async function loginCmd(store: LibraryStore, values: { client?: string; "no-browser"?: boolean; service?: boolean; "no-service"?: boolean }, io: Io): Promise<number> {
  const library = await readLibrary(store);
  let client;
  if (values.client) {
    const text = await readText(values.client);
    if (text === null) throw new UsageError(`Can't read ${values.client}.`);
    client = parseClientFile(text);
  } else {
    const loaded = await loadClient(store.paths.home, library);
    if ("missing" in loaded) throw new UsageError(loaded.missing);
    client = loaded;
  }
  const tokens = await tokenStoreFor(setup(store, io), library);
  if ("unavailable" in tokens) {
    io.err(tokens.unavailable);
    return 1;
  }
  io.out("Opening Google sign-in in your browser. If it doesn't open, visit:");
  await login({
    client,
    store: tokens,
    ...(io.sync?.fetch ? { fetch: io.sync.fetch } : {}),
    ...(values["no-browser"] ? { openBrowser: () => undefined } : io.sync?.openBrowser ? { openBrowser: io.sync.openBrowser } : {}),
    onUrl: (url) => io.out(url),
  });
  // Only now that sign-in worked: keep the client and switch to Drive API sync.
  await saveClient(store.paths.home, client);
  if (library.settings.sync.mode !== "drive-api") {
    await store.update((lib) => ({ ...lib, settings: { ...lib.settings, sync: { ...lib.settings.sync, mode: "drive-api" } } }));
    io.out("Sync mode set to drive-api.");
  }
  io.out(`Signed in. The sign-in is kept in: ${tokens.name}.`);
  const status = await engineFor(store, io).syncNow();
  printStatus(status, io);
  await offerService(store, values, io);
  return 0;
}

// --- background service ---------------------------------------------------------------

function serviceContext(store: LibraryStore, io: Io): ServiceContext {
  const s = io.service ?? {};
  return {
    platform: s.platform ?? process.platform,
    userHome: s.userHome ?? homedir(),
    dataHome: store.paths.home,
    node: s.node ?? process.execPath,
    // The script being run: dist/bin.js, or the single-file ccb.mjs from a release.
    script: s.script ?? (process.argv[1] ? process.argv[1] : fileURLToPath(new URL("./bin.js", import.meta.url))),
    uid: s.uid ?? (typeof process.getuid === "function" ? process.getuid() : userInfo().uid),
  };
}

const serviceRun = (io: Io): CommandRunner => io.service?.run ?? runCommand;

async function offerService(store: LibraryStore, values: { service?: boolean; "no-service"?: boolean }, io: Io): Promise<void> {
  const library = await readLibrary(store);
  if (values["no-service"] || (!values.service && !library.settings.sync.backgroundService)) return;
  let yes = values.service === true;
  if (!yes) {
    if (!io.ask) {
      io.out("To keep syncing when Claude Code and Codex are closed, run: ccb service install");
      return;
    }
    const answer = (await io.ask("Keep syncing in the background, also when Claude Code and Codex are closed? [Y/n] ")).trim().toLowerCase();
    yes = answer === "" || answer === "y" || answer === "yes";
  }
  if (!yes) {
    await store.update((lib) => ({ ...lib, settings: { ...lib.settings, sync: { ...lib.settings.sync, backgroundService: false } } }));
    io.out("No background service. Sync still runs while Claude Code or Codex is open; ccb service install adds it later.");
    return;
  }
  try {
    const plan = await installService(serviceContext(store, io), serviceRun(io));
    io.out(`Background sync installed (${plan.kind}); it starts when you log in.`);
  } catch (error) {
    io.err(`The background service wasn't installed: ${(error as Error).message}`);
  }
}

async function serviceCmd(store: LibraryStore, args: string[], io: Io): Promise<number> {
  const ctx = serviceContext(store, io);
  const run = serviceRun(io);
  switch (args[0]) {
    case "install": {
      const plan = await installService(ctx, run);
      await store.update((lib) => ({ ...lib, settings: { ...lib.settings, sync: { ...lib.settings.sync, backgroundService: true } } }));
      io.out(`Background sync installed (${plan.kind}); it starts when you log in and is running now.`);
      return 0;
    }
    case "status":
      io.out(`Background sync service: ${await serviceStatus(ctx, run)}`);
      return 0;
    case "stop":
      await stopService(ctx, run);
      io.out("Background sync stopped; it starts again the next time you log in (or the service manager restarts). ccb service uninstall removes it.");
      return 0;
    case "uninstall":
      await uninstallService(ctx, run);
      await store.update((lib) => ({ ...lib, settings: { ...lib.settings, sync: { ...lib.settings.sync, backgroundService: false } } }));
      io.out("Background sync removed. Sync still runs while Claude Code or Codex is open.");
      return 0;
    default:
      throw new UsageError("Usage: ccb service install|status|stop|uninstall");
  }
}

/** Keeps syncing until stopped: what the background service runs. */
async function daemon(store: LibraryStore, io: Io): Promise<number> {
  let last = "";
  const engine = new SyncEngine({
    store,
    remote: remoteProvider(setup(store, io)),
    ...(io.sync?.scheduler ? { scheduler: io.sync.scheduler } : {}),
    onStatus: (s, { merged }) => {
      if (merged) {
        void readLibrary(store)
          .then((lib) => (lib.settings.codex.autoSync ? writeCodexSkills(lib, { onlyIfInstalled: true, owner: store.paths.home, home: codexHome({ ...process.env, ...io.env }) }) : undefined))
          .catch(() => undefined);
      }
      const line = statusLineOf(s);
      if (line !== last) io.err(`${new Date().toISOString()} ${line}${s.message ? ` (${s.message})` : ""}`);
      last = line;
    },
  });
  // The pid file lets `ccb service stop` end this process on Windows, and shows it's running.
  await writeFileAtomic(pidFile(store.paths.home), `${process.pid}\n`);
  engine.start();
  const keepAlive = setInterval(() => undefined, 60_000);
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve();
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    void io.daemonUntil?.then(stop);
  });
  clearInterval(keepAlive);
  engine.stop();
  await engine.idle();
  const { rm } = await import("node:fs/promises");
  const mine = (await readText(pidFile(store.paths.home)))?.trim() === String(process.pid);
  if (mine) await rm(pidFile(store.paths.home), { force: true });
  return 0;
}

async function logoutCmd(store: LibraryStore, io: Io): Promise<number> {
  const library = await readLibrary(store);
  const tokens = await tokenStoreFor(setup(store, io), library);
  if ("unavailable" in tokens) {
    io.out("Not signed in (no credential store on this computer).");
    return 0;
  }
  const { revoked } = await logout({ store: tokens, ...(io.sync?.fetch ? { fetch: io.sync.fetch as Fetch } : {}) });
  io.out(revoked ? "Signed out and revoked the sign-in with Google." : "Signed out on this computer. Google couldn't be reached to revoke the sign-in; remove the app under Third-party connections in your Google Account if you want.");
  return 0;
}

async function syncCmd(store: LibraryStore, args: string[], values: { daemon?: boolean }, io: Io): Promise<number> {
  if (values.daemon) return daemon(store, io);
  if (args[0] === "codex") {
    const library = await readLibrary(store);
    const home = codexHome({ ...process.env, ...io.env });
    const { written, removed } = await writeCodexSkills(library, { home, owner: store.paths.home });
    io.out(`Codex skills in ${home}/skills: ${written.length} written, ${removed.length} removed (one per button and favourite prompt; use them as $ccb-<name>).`);
    return 0;
  }
  if (args.length) throw new UsageError("Usage: ccb sync [codex] [--daemon]");
  const status = await engineFor(store, io).syncNow();
  printStatus(status, io);
  return status.state === "idle" || status.state === "off" ? 0 : 1;
}

async function statusCmd(store: LibraryStore, io: Io): Promise<number> {
  printStatus(await engineFor(store, io).status(), io);
  io.out(`Background sync service: ${await serviceStatus(serviceContext(store, io), serviceRun(io))}`);
  return 0;
}

async function syncChecks(store: LibraryStore, library: Library, io: Io): Promise<Array<[Level, string]>> {
  const out: Array<[Level, string]> = [];
  const s = library.settings.sync;
  if (s.mode === "off") return [["ok", "Sync is off (sync.mode = off)"]];
  out.push(["ok", `Sync mode: ${s.mode}`]);
  if (s.mode === "drive-folder") {
    if (!s.folderPath) out.push(["warn", "sync.folderPath is not set: ccb config set sync.folderPath <folder inside Google Drive for desktop>"]);
    else out.push((await exists(s.folderPath)) ? ["ok", `Sync folder ${s.folderPath}`] : ["warn", `Sync folder ${s.folderPath} isn't there (is Google Drive for desktop running?); changes wait until it is`]);
  } else {
    const client = await loadClient(store.paths.home, library);
    if ("missing" in client) out.push(["warn", client.missing]);
    else out.push(["ok", `Google OAuth client ${client.clientId.slice(0, 12)}...`]);
    const tokens = await tokenStoreFor(setup(store, io), library);
    if ("unavailable" in tokens) out.push(["warn", tokens.unavailable]);
    else {
      const token = await tokens.get().catch((e: Error) => e);
      if (token instanceof Error) out.push(["fail", `${tokens.name}: ${token.message}`]);
      else out.push(token ? ["ok", `Signed in (kept in ${tokens.name})`] : ["warn", "Not signed in to Google Drive: run ccb login"]);
    }
  }
  const status = await engineFor(store, io).status();
  if (status.state === "offline") out.push(["warn", `Last sync attempt: offline (${status.message ?? ""}). ${status.pending} change(s) wait and upload automatically`]);
  if (status.state === "error") out.push(["fail", `Last sync failed: ${status.message ?? "unknown error"}`]);
  if (status.state === "idle" && status.lastPullAt) out.push(["ok", `Last sync ${status.lastPullAt}; ${status.devices.length} other device(s); ${status.pending} pending`]);
  for (const d of status.invalidDevices) out.push(["warn", `Device file ${d.deviceId}.json in Drive is invalid and is skipped: ${d.error}`]);
  for (const d of status.staleDevices) out.push(["warn", `Device ${d} hasn't synced for 180 days and is ignored until it syncs again`]);
  if (status.conflicts) out.push(["warn", `${status.conflicts} conflict copy(ies) to resolve in the Prompt Bank or Notes`]);
  return out;
}

/** Runs one ccb command. Returns the process exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        home: { type: "string" },
        client: { type: "string" },
        "no-browser": { type: "boolean" },
        service: { type: "boolean" },
        "no-service": { type: "boolean" },
        daemon: { type: "boolean" },
      },
    });
  } catch (error) {
    io.err((error as Error).message);
    io.err('Run "ccb --help" for usage.');
    return 2;
  }
  const [command, ...rest] = parsed.positionals;
  if (parsed.values.version) {
    io.out(CLI_VERSION);
    return 0;
  }
  if (parsed.values.help || !command || command === "help") {
    io.out(HELP);
    return 0;
  }
  const home = parsed.values.home ?? io.env["CCB_HOME"];
  const store = new LibraryStore({ ...(home ? { home } : {}), ...io.store });
  try {
    switch (command) {
      case "config":
        return await config(store, rest, io);
      case "export":
        return await exportCmd(store, rest, io);
      case "import":
        return await importCmd(store, rest, io);
      case "doctor":
        return await doctor(store, io);
      case "login":
        return await loginCmd(store, parsed.values, io);
      case "logout":
        return await logoutCmd(store, io);
      case "sync":
        return await syncCmd(store, rest, parsed.values, io);
      case "service":
        return await serviceCmd(store, rest, io);
      case "status":
        return await statusCmd(store, io);
      default:
        throw new UsageError(`Unknown command "${command}". Run "ccb --help".`);
    }
  } catch (error) {
    io.err(error instanceof UsageError ? error.message : `Error: ${(error as Error).message}`);
    return error instanceof UsageError ? 2 : 1;
  }
}

/** Reads a whole file as text (for tests and future commands). */
export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
