// Sync status in words, as the status table in docs/google-drive-sync.md shows it.
import type { SyncStatus } from "./engine.js";

function time(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The one-line summary: "Sync ✓ 12:04", "Sync offline · 3 pending", "Sync ⚠ sign in" ... */
export function statusLine(s: SyncStatus): string {
  switch (s.state) {
    case "off":
      return "Sync off";
    case "not-set-up":
      return "Sync not set up";
    case "signed-out":
      return "Sync ⚠ sign in";
    case "no-credential-store":
      return "Sync ⚠ no credential store";
    case "syncing":
      return "Sync ↻";
    case "offline":
      return `Sync offline${s.pending ? ` · ${s.pending} pending` : ""}`;
    case "error":
      return "Sync ⚠ error";
    case "idle":
      if (s.conflicts) return `Sync ⚠ ${s.conflicts} conflict${s.conflicts === 1 ? "" : "s"}`;
      if (s.pending) return `Sync · ${s.pending} pending`;
      return `Sync ✓ ${time(s.lastPushAt ?? s.lastPullAt)}`.trim();
  }
}

/** The status line plus what to do about it, for ccb status and ccb sync. */
export function formatStatus(s: SyncStatus): string[] {
  const lines = [statusLine(s)];
  if (s.message) lines.push(s.message);
  if (s.state === "offline" && s.pending) lines.push("Changes wait here and upload automatically when the connection returns.");
  if (s.nextRetryAt) lines.push(`Next try at ${time(s.nextRetryAt)}.`);
  if (s.conflicts) lines.push("Open the Prompt Bank or Notes to choose which version to keep.");
  if (s.state === "idle" || s.state === "offline") lines.push(`Mode ${s.mode}; ${s.devices.length} other device(s); last pull ${s.lastPullAt ?? "never"}; last upload ${s.lastPushAt ?? "never"}.`);
  for (const d of s.invalidDevices) lines.push(`Skipped an invalid device file ${d.deviceId}.json: ${d.error}`);
  return lines;
}
