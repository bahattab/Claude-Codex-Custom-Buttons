// Google Drive v3 over fetch: the handful of documented calls sync needs (decision D28).
//   files.list / files.create (folders, device files), media upload and download,
//   changes.getStartPageToken / changes.list (the change feed).
// With the drive.file scope the app sees only files it created, which is all it needs.
import { AuthError, OfflineError, README_TEXT, deviceIdFromName, type PullResult, type Remote, type RemoteFile } from "./remote.js";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Gives a valid access token; `fresh` forces a refresh after a 401. Throws AuthError when signed out. */
export interface TokenSource {
  accessToken(fresh?: boolean): Promise<string>;
}

interface DriveFile {
  id: string;
  name: string;
  parents?: string[];
  trashed?: boolean;
  mimeType?: string;
  createdTime?: string;
}

interface Cursor {
  token: string;
  /** Device file IDs seen, so a removal (which carries only the file ID) can be named. */
  files: Record<string, string>;
  /** The devices/ folders read from. */
  folders: string[];
}

/** Escapes a value for a Drive query string literal. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export class DriveRemote implements Remote {
  readonly kind = "drive-api" as const;
  readonly location: string;
  /** Own device file's Drive ID, once known. */
  private ownFileId: string | null = null;
  private target: string | null = null;

  constructor(
    private readonly auth: TokenSource,
    private readonly folderName: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    this.location = `drive-api:${folderName}`;
  }

  async pull(cursorText: string | null, ownDeviceId: string): Promise<PullResult> {
    const cursor = parse(cursorText);
    if (cursor) {
      const incremental = await this.changesSince(cursor, ownDeviceId);
      if (incremental) return incremental;
    }
    return this.fullPull(ownDeviceId);
  }

  async push(deviceId: string, text: string): Promise<void> {
    const devices = this.target ?? (await this.folders(true)).target;
    const name = `${deviceId}.json`;
    if (this.ownFileId === null) {
      const found = await this.list(`name = ${quote(name)} and ${quote(devices)} in parents and trashed = false`);
      this.ownFileId = found[0]?.id ?? null;
    }
    if (this.ownFileId !== null) {
      const res = await this.call(`${UPLOAD}/files/${encodeURIComponent(this.ownFileId)}?uploadType=media&fields=id`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: text,
      }, [404]);
      if (res.status !== 404) return;
      this.ownFileId = null; // deleted in Drive meanwhile: create it again
    }
    this.ownFileId = await this.create({ name, parents: [devices], mimeType: "application/json" }, text);
  }

  // --- pulling ---------------------------------------------------------------------------

  private async fullPull(ownDeviceId: string): Promise<PullResult> {
    // Take the change-feed position first, so nothing that changes during the listing is missed.
    const { startPageToken } = (await (await this.call(`${API}/changes/startPageToken`)).json()) as { startPageToken: string };
    const { all, target } = await this.folders(true);
    this.ownFileId = null; // found again below, in the folder written to
    const files = await this.deviceFiles(all);
    const changed: RemoteFile[] = [];
    const seen: Record<string, string> = {};
    // If two device files share a name (a duplicate folder), the one in the target folder wins.
    files.sort((a, b) => Number(b.parents?.includes(target) ?? false) - Number(a.parents?.includes(target) ?? false));
    const taken = new Set<string>();
    for (const f of files) {
      const deviceId = deviceIdFromName(f.name);
      if (!deviceId || taken.has(deviceId)) continue;
      taken.add(deviceId);
      seen[f.id] = deviceId;
      if (deviceId === ownDeviceId) {
        if (f.parents?.includes(target)) this.ownFileId = f.id;
        continue;
      }
      changed.push({ deviceId, text: await this.download(f.id) });
    }
    const cursor: Cursor = { token: startPageToken, files: seen, folders: all };
    return { changed, removed: [], cursor: JSON.stringify(cursor), full: true };
  }

  /** Only what changed since the cursor, or null when a full pull is needed instead. */
  private async changesSince(cursor: Cursor, ownDeviceId: string): Promise<PullResult | null> {
    const changedIds = new Map<string, DriveFile>();
    const removedIds = new Set<string>();
    let token = cursor.token;
    for (let page = 0; page < 50; page++) {
      const url = `${API}/changes?pageToken=${encodeURIComponent(token)}&pageSize=100&spaces=drive&fields=${encodeURIComponent("nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,parents,trashed,mimeType))")}`;
      const res = await this.call(url, {}, [400, 404, 410]);
      if (res.status !== 200) return null; // the saved position is no longer valid
      const body = (await res.json()) as { nextPageToken?: string; newStartPageToken?: string; changes?: Array<{ fileId: string; removed?: boolean; file?: DriveFile }> };
      for (const c of body.changes ?? []) {
        // Our folders changing (a duplicate created on another computer at the same moment,
        // a rename) is rare: re-list everything, which also picks the folder to write to again.
        if (c.file?.mimeType === FOLDER && (c.file.name === this.folderName || c.file.name === "devices")) return null;
        const known = cursor.files[c.fileId];
        const inFolder = c.file?.parents?.some((p) => cursor.folders.includes(p)) ?? false;
        if (c.removed || c.file?.trashed || (known && !inFolder)) {
          if (known) removedIds.add(c.fileId);
          continue;
        }
        if (c.file && inFolder && deviceIdFromName(c.file.name)) changedIds.set(c.fileId, c.file);
      }
      if (body.newStartPageToken) {
        token = body.newStartPageToken;
        break;
      }
      if (!body.nextPageToken) break;
      token = body.nextPageToken;
    }
    const files = { ...cursor.files };
    const removed: string[] = [];
    for (const id of removedIds) {
      const deviceId = files[id];
      delete files[id];
      if (deviceId && deviceId !== ownDeviceId) removed.push(deviceId);
    }
    const changed: RemoteFile[] = [];
    for (const [id, f] of changedIds) {
      const deviceId = deviceIdFromName(f.name) as string;
      files[id] = deviceId;
      if (deviceId === ownDeviceId) continue;
      changed.push({ deviceId, text: await this.download(id) });
    }
    const next: Cursor = { token, files, folders: cursor.folders };
    return { changed, removed, cursor: JSON.stringify(next), full: false };
  }

  private async deviceFiles(folders: string[]): Promise<DriveFile[]> {
    if (folders.length === 0) return [];
    const parents = folders.map((f) => `${quote(f)} in parents`).join(" or ");
    return this.list(`(${parents}) and trashed = false and mimeType != ${quote(FOLDER)}`);
  }

  private async download(id: string): Promise<string> {
    return (await this.call(`${API}/files/${encodeURIComponent(id)}?alt=media`)).text();
  }

  // --- folders ---------------------------------------------------------------------------

  /**
   * The devices/ folders to read, and the one to write. Two computers signing in at once
   * can each create the folder; every computer then writes to the oldest one and reads
   * from all of them, so they still find each other.
   */
  private async folders(create: boolean): Promise<{ all: string[]; target: string }> {
    let roots = await this.list(`name = ${quote(this.folderName)} and mimeType = ${quote(FOLDER)} and 'root' in parents and trashed = false`);
    if (roots.length === 0 && create) {
      await this.create({ name: this.folderName, mimeType: FOLDER, parents: ["root"] });
      roots = await this.list(`name = ${quote(this.folderName)} and mimeType = ${quote(FOLDER)} and 'root' in parents and trashed = false`);
    }
    roots.sort(oldestFirst);
    const all: string[] = [];
    let target: string | null = null;
    for (const root of roots) {
      const devices = (await this.list(`name = 'devices' and mimeType = ${quote(FOLDER)} and ${quote(root.id)} in parents and trashed = false`)).sort(oldestFirst);
      all.push(...devices.map((d) => d.id));
      if (target === null && root === roots[0]) {
        target = devices[0]?.id ?? (create ? await this.create({ name: "devices", mimeType: FOLDER, parents: [root.id] }) : null);
        if (target !== null && devices.length === 0) {
          all.push(target);
          await this.create({ name: "README.txt", mimeType: "text/plain", parents: [root.id] }, README_TEXT).catch(() => undefined);
        }
      }
    }
    if (target === null) throw new Error(`Couldn't create the "${this.folderName}" folder in Google Drive.`);
    this.target = target;
    return { all: [...new Set(all)], target };
  }

  // --- HTTP ------------------------------------------------------------------------------

  private async list(q: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const url = `${API}/files?q=${encodeURIComponent(q)}&spaces=drive&pageSize=1000&fields=${encodeURIComponent("nextPageToken,files(id,name,parents,trashed,mimeType,createdTime)")}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const body = (await (await this.call(url)).json()) as { files?: DriveFile[]; nextPageToken?: string };
      out.push(...(body.files ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** Creates a file or folder; returns its ID. */
  private async create(metadata: Record<string, unknown>, content?: string): Promise<string> {
    let res: Response;
    if (content === undefined) {
      res = await this.call(`${API}/files?fields=id`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(metadata) });
    } else {
      const boundary = `ccb${Math.random().toString(36).slice(2)}`;
      const body = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\ncontent-type: ${String(metadata["mimeType"] ?? "application/octet-stream")}\r\n\r\n${content}\r\n--${boundary}--`;
      res = await this.call(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body });
    }
    return ((await res.json()) as { id: string }).id;
  }

  /**
   * One authorised request. A 401 refreshes the token once; network failures, 429 and 5xx
   * (and Drive's rate-limit 403s) become OfflineError so they are retried with backoff.
   * Statuses in `allow` are returned to the caller instead of thrown.
   */
  private async call(url: string, init: RequestInit = {}, allow: number[] = []): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.accessToken(attempt > 0);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` } });
      } catch (error) {
        throw new OfflineError(`Google Drive is unreachable (${(error as Error).message}).`);
      }
      if (res.ok || allow.includes(res.status)) return res;
      if (res.status === 401 && attempt === 0) continue;
      const text = await res.text().catch(() => "");
      const reason = driveReason(text);
      if (res.status === 401) throw new AuthError("Google rejected the sign-in. Run ccb login to reconnect Google Drive.");
      if (res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit|RateLimit/.test(reason))) {
        throw new OfflineError(`Google Drive is busy (HTTP ${res.status}${reason ? `, ${reason}` : ""}); retrying.`);
      }
      if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(text)) {
        throw new Error("The Google Drive API is not enabled for your Google Cloud project (see docs/google-cloud-setup.md, step 2).");
      }
      throw new Error(`Google Drive refused a request (HTTP ${res.status}${reason ? `, ${reason}` : ""}).`);
    }
  }
}

function driveReason(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
    return body.error?.errors?.[0]?.reason ?? body.error?.message ?? "";
  } catch {
    return "";
  }
}

function oldestFirst(a: DriveFile, b: DriveFile): number {
  return (a.createdTime ?? "").localeCompare(b.createdTime ?? "") || a.id.localeCompare(b.id);
}

function parse(text: string | null): Cursor | null {
  if (text === null) return null;
  try {
    const c = JSON.parse(text) as Partial<Cursor>;
    if (typeof c.token === "string" && c.files && Array.isArray(c.folders)) return c as Cursor;
  } catch {
    // fall through to a full pull
  }
  return null;
}
