// Where device files live: Google Drive (through its API) or a Drive for desktop folder.
// Every device writes only its own file, devices/<deviceId>.json, and reads the others.

/** A device file as stored remotely. */
export interface RemoteFile {
  deviceId: string;
  text: string;
}

export interface PullResult {
  /** Device files that are new or changed since the cursor (every file when `full`). */
  changed: RemoteFile[];
  /** Devices whose file was removed since the cursor. */
  removed: string[];
  /** Pass back on the next pull to get only what changed after this one. */
  cursor: string | null;
  /** True when `changed` is every device file, so files not listed no longer exist. */
  full: boolean;
}

export interface Remote {
  readonly kind: "drive-api" | "drive-folder";
  /** A key that changes when the remote location changes, so cached state is not reused. */
  readonly location: string;
  /**
   * Device files changed since `cursor`, or every device file when `cursor` is null.
   * `ownDeviceId`'s file is not downloaded (this device wrote it).
   */
  pull(cursor: string | null, ownDeviceId: string): Promise<PullResult>;
  /** Uploads this device's own file. */
  push(deviceId: string, text: string): Promise<void>;
}

/** Signed out: the token is missing, expired or revoked. Retrying won't help until sign-in. */
export class AuthError extends Error {
  override name = "AuthError";
}

/** No network, or the service is busy or failing (HTTP 429/5xx). Retried with backoff. */
export class OfflineError extends Error {
  override name = "OfflineError";
}

const DEVICE_FILE_RE = /^(dev_[a-z0-9]{6,32})\.json$/;

/** The device ID in a device file's name, or null for any other file. */
export function deviceIdFromName(name: string): string | null {
  return DEVICE_FILE_RE.exec(name)?.[1] ?? null;
}

export const README_TEXT = `This folder is used by Claude Codex Custom Buttons to sync your Prompt Bank,
custom buttons, variables and notes between your computers.

Each computer writes only its own file in devices/. Please don't edit these files by
hand: change things from the plugin on any computer instead.
`;
