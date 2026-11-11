// Turns the library's sync settings into a remote, or says what's missing. Shared by
// ccb-mcp (which syncs while a session is open) and the ccb command.
import { join } from "node:path";

import { hash, type Library } from "@ccb/core";
import { readText, writeFileAtomic, type LibraryStore } from "@ccb/store";

import { DriveRemote, type Fetch } from "./drive.js";
import { SyncEngine, type EngineOptions, type RemoteProvider } from "./engine.js";
import { FolderRemote } from "./folder.js";
import { GoogleAuth, parseClientFile, type GoogleClient } from "./google.js";
import type { Remote } from "./remote.js";
import { chooseTokenStore, type CommandRunner, type TokenStore } from "./secrets.js";

export interface SetupOptions {
  /** The data folder (LibraryStore.paths.home). */
  home: string;
  fetch?: Fetch;
  run?: CommandRunner;
  platform?: NodeJS.Platform;
}

/** The copy of the Google client that `ccb login` keeps, readable only by you. */
export function clientPath(home: string): string {
  return join(home, "google-client.json");
}

export async function saveClient(home: string, client: GoogleClient): Promise<void> {
  await writeFileAtomic(clientPath(home), `${JSON.stringify(client, null, 2)}\n`, 0o600);
}

/** The Google client: the file named by google.clientFile when it can be read, else the copy ccb login saved. */
export async function loadClient(home: string, library: Library): Promise<GoogleClient | { missing: string }> {
  const named = library.settings.google.clientFile ? await readText(library.settings.google.clientFile) : null;
  const text = named ?? (await readText(clientPath(home)));
  if (text === null) {
    return {
      missing: library.settings.google.clientFile
        ? `The Google client file ${library.settings.google.clientFile} can't be read.`
        : "Google Drive sync isn't set up yet: create an OAuth client (docs/google-cloud-setup.md), then run ccb config set google.clientFile <file> and ccb login.",
    };
  }
  try {
    return parseClientFile(text);
  } catch (error) {
    return { missing: (error as Error).message };
  }
}

export async function tokenStoreFor(opts: SetupOptions, library: Library): Promise<TokenStore | { unavailable: string }> {
  return chooseTokenStore({
    home: opts.home,
    setting: library.settings.google.tokenStore,
    ...(opts.run ? { run: opts.run } : {}),
    ...(opts.platform ? { platform: opts.platform } : {}),
  });
}

/**
 * A RemoteProvider for the engine. The remote is kept while the settings that choose it
 * stay the same, so its access token and file IDs are reused between runs.
 */
export function remoteProvider(opts: SetupOptions): RemoteProvider {
  let cached: { key: string; remote: Remote } | null = null;
  return async (library) => {
    const s = library.settings.sync;
    if (s.mode === "off") return { state: "off" };
    if (s.mode === "drive-folder") {
      if (!s.folderPath) return { state: "not-set-up", reason: "Set sync.folderPath to a folder inside your Google Drive for desktop folder (ccb config set sync.folderPath <folder>)." };
      const key = `folder:${s.folderPath}`;
      if (cached?.key !== key) cached = { key, remote: new FolderRemote(s.folderPath) };
      return cached.remote;
    }
    const client = await loadClient(opts.home, library);
    if ("missing" in client) return { state: "not-set-up", reason: client.missing };
    const store = await tokenStoreFor(opts, library);
    if ("unavailable" in store) return { state: "no-credential-store", reason: store.unavailable };
    let token: string | null;
    try {
      token = await store.get();
    } catch (error) {
      return { state: "no-credential-store", reason: (error as Error).message };
    }
    if (!token) return { state: "signed-out", reason: "Not signed in to Google Drive. Run ccb login (or press Connect Google Drive)." };
    // A new sign-in (perhaps another Google account) gets a new remote and fresh sync state.
    const account = hash(`${client.clientId}\n${token}`).slice(0, 12);
    const key = `drive:${s.driveFolderName}:${library.settings.google.tokenStore}:${account}`;
    if (cached?.key !== key) {
      cached = { key, remote: new DriveRemote(new GoogleAuth(client, store, opts.fetch ?? fetch), s.driveFolderName, opts.fetch ?? fetch, account) };
    }
    return cached.remote;
  };
}

/** An engine for this computer's library with the usual remotes. */
export function createSyncEngine(store: LibraryStore, opts: Omit<SetupOptions, "home"> & Pick<EngineOptions, "scheduler" | "onStatus"> = {}): SyncEngine {
  return new SyncEngine({
    store,
    remote: remoteProvider({ ...opts, home: store.paths.home }),
    ...(opts.scheduler ? { scheduler: opts.scheduler } : {}),
    ...(opts.onStatus ? { onStatus: opts.onStatus } : {}),
  });
}
