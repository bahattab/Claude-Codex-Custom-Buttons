// Drive for desktop fallback: the same devices/ layout in a local folder that Google Drive
// for desktop uploads. The plugin only reads and writes files; Drive does the transfer.
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { exists, readText, writeFileAtomic } from "@ccb/store";

import { OfflineError, README_TEXT, deviceIdFromName, type PullResult, type Remote, type RemoteFile } from "./remote.js";

export class FolderRemote implements Remote {
  readonly kind = "drive-folder" as const;
  readonly location: string;
  private readonly devices: string;

  constructor(private readonly folder: string) {
    this.location = `folder:${folder}`;
    this.devices = join(folder, "devices");
  }

  async pull(cursor: string | null, ownDeviceId: string): Promise<PullResult> {
    const seen = parseCursor(cursor);
    const stamps: Record<string, string> = {};
    const changed: RemoteFile[] = [];
    let names: string[];
    try {
      names = await readdir(this.devices);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw this.unavailable(error);
      if (!(await exists(this.folder))) throw this.unavailable(error);
      names = []; // folder there, nothing synced yet
    }
    for (const name of names.sort()) {
      const deviceId = deviceIdFromName(name);
      if (!deviceId || deviceId === ownDeviceId) continue;
      const path = join(this.devices, name);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) continue;
      const stamp = `${info.mtimeMs}:${info.size}`;
      stamps[deviceId] = stamp;
      if (seen !== null && seen[deviceId] === stamp) continue;
      const text = await readText(path);
      if (text !== null) changed.push({ deviceId, text });
    }
    const removed = seen === null ? [] : Object.keys(seen).filter((id) => !(id in stamps));
    const ownMissing = !(await exists(join(this.devices, `${ownDeviceId}.json`)));
    return { changed, removed, cursor: JSON.stringify(stamps), full: seen === null, ownMissing };
  }

  async push(deviceId: string, text: string): Promise<void> {
    if (!(await exists(this.folder))) throw this.unavailable(new Error("missing"));
    await mkdir(this.devices, { recursive: true });
    const readme = join(this.folder, "README.txt");
    if (!(await exists(readme))) await writeFileAtomic(readme, README_TEXT, 0o644);
    await writeFileAtomic(join(this.devices, `${deviceId}.json`), text, 0o644);
  }

  private unavailable(error: unknown): OfflineError {
    // A Drive for desktop folder that isn't mounted (Drive not running, drive letter gone)
    // is like being offline: changes wait and go out when it's back.
    return new OfflineError(`The sync folder ${this.folder} is not available (${(error as Error).message}).`);
  }
}

function parseCursor(cursor: string | null): Record<string, string> | null {
  if (cursor === null) return null;
  try {
    const parsed = JSON.parse(cursor) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}
