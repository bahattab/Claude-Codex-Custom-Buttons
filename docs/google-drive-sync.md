# Google Drive sync

Everything you create is saved in your Google Drive: the **Prompt Bank, custom buttons, variables and Notes**. Every change is saved locally first, uploaded within a few seconds, and pulled by every other device and tool. You can open and edit your prompts and notes from any PC; edits made offline sync when the connection returns.

## Principles

- **Local first.** The local library is the working copy. Saving never waits for the network, and everything works offline.
- **One writer per file.** Each device writes only its own file in Drive and reads everyone else's. Two devices can never overwrite each other's upload.
- **Nothing is lost silently.** Concurrent edits to the same prompt or note produce a visible conflict copy, never an overwrite.
- **Least privilege.** Only the `drive.file` permission is requested.

## Sync is automatic

You never have to press a sync button. After the one-time Google sign-in:

| Event | What happens automatically |
|---|---|
| You save a prompt, button or variable, or type in a note | Saved locally at once, uploaded about 2 seconds later |
| Another PC changed something | Pulled within 60 seconds, and immediately when Claude Code or Codex starts or a Prompt Bank or Notes pane opens |
| You edit a note's Markdown file in another editor | Detected and uploaded like any other edit |
| You're offline | Changes wait in the outbox; uploads retry by themselves and go through when the connection returns |
| A sign-in token expires | The status line and panes show **Reconnect Google Drive**; one click reopens sign-in, and queued changes upload afterwards |

**Sync now** (`/pb sync`, `ccb sync`) exists only to force an immediate pull; nothing depends on it.

### Background sync service

Inside Claude Code and Codex, `ccb-mcp` syncs while the session is open. So that sync keeps running when no session is open (for example, editing a note's Markdown file in another editor, or a PC that should receive changes overnight), `ccb login` also installs a small **background sync service** that starts when you log in to your computer:

| OS | How it runs |
|---|---|
| Windows | A per-user Task Scheduler task at log-on |
| macOS | A per-user `launchd` agent (`~/Library/LaunchAgents`) |
| Linux | A `systemd --user` service |

- It runs as you, with no administrator rights, and uses the same token and lock file as `ccb-mcp`, so only one process pushes at a time.
- `ccb login` asks once ("Keep syncing in the background? [Y/n]", default yes). `ccb service status`, `ccb service stop` and `ccb service uninstall` control it later.
- Without it, sync is still automatic whenever Claude Code, Codex or the Claude Desktop extension is running.

### First-time sign-in

The first time a pane opens with sync not set up, it shows **Connect Google Drive**. Pressing it starts the same sign-in as `ccb login`, so there's no need to open a terminal. After that, sync is fully automatic.

### Why one file per device

Google Drive keeps a `version` number for each file, but its update call has no "only if unchanged" option (checked against the Drive v3 API definition; see [platform-facts.md](platform-facts.md) G3). With a single shared file, two devices uploading at the same moment could silently drop one device's changes. Giving each device its own file removes that race entirely, and it also stops Google Drive for desktop from creating duplicate "(1)" files in the fallback mode. Recorded as decision D12 in [decisions.md](decisions.md).

## Where the data lives in Drive

```
My Drive/
└── Claude Codex Buttons/
    ├── README.txt                  explains what the folder is
    └── devices/
        ├── dev_7f3a91.json         written only by device dev_7f3a91 (e.g. your laptop)
        └── dev_c02e5d.json         written only by device dev_c02e5d (e.g. your desktop PC)
```

Each device file holds that device's full, merged view of the synced data (see [data-model.md](data-model.md#device-file-in-drive)). The folder is visible in Drive (decision D7). Don't edit the device files by hand; use the plugin on any computer.

## What syncs

| Data | Synced |
|---|---|
| Prompts and categories | Yes |
| Custom buttons | Yes |
| Variables | Yes |
| **Notes** | **Yes** |
| Regenerate instructions, Continue message | Yes |
| Other settings, outbox, sync state, device ID | No (per device) |

## Sync modes

| Mode | Setting | Use when |
|---|---|---|
| **Drive API** (default) | `sync.mode = "drive-api"` | Normal use. Requires a one-time `ccb login` |
| **Drive for desktop folder** (fallback) | `sync.mode = "drive-folder"` | You use Google Drive for desktop and don't want to set up a Google Cloud OAuth client |
| **Off** | `sync.mode = "off"` | Local only |

### Fallback: Google Drive for desktop folder

Set `sync.folderPath` to a folder inside your locally synced Drive (for example `G:\My Drive\Claude Codex Buttons` on Windows, or `~/Library/CloudStorage/GoogleDrive-<account>/My Drive/Claude Codex Buttons` on macOS). The plugin reads and writes the same `devices/` layout there, and Drive for desktop does the uploading.

Limits of this mode:

- Upload timing is controlled by Drive for desktop, not the plugin.
- It doesn't work on computers without Drive for desktop, such as cloud sessions.

Because each device still writes only its own file, Drive for desktop never has two writers for one file.

## How a change reaches Drive (Drive API mode)

1. The change (a prompt saved, a note typed, a button edited) is written to the local library and recorded in `outbox.json`.
2. A push is scheduled `sync.pushDelayMs` later (default 2,000 ms). Further changes in that window reset the timer, so a burst of edits, such as typing a note, becomes one upload.
3. **Push:** the device uploads its own `devices/<deviceId>.json` with its current merged view. No other device writes this file, so no conflict check is needed.
4. On success, the outbox is cleared and the status line shows `✓ synced`.
5. If offline or Google returns an error, the outbox keeps the changes and the push retries with backoff (2 s, 4 s, 8 s … capped at 5 minutes). The status line shows `offline · N pending`. **Edits made offline, including notes, are uploaded automatically when the connection returns.**

## How other devices get changes

A pull happens:

- when `ccb-mcp` starts (start of a Claude Code or Codex session);
- when the Prompt Bank or Notes pane opens;
- on **Sync now**, `/pb sync` or `ccb sync`;
- every `sync.intervalSeconds` (default 60) while `ccb-mcp` or the background sync service is running.

A pull uses Drive's change feed (`changes.list` from a saved start-page token) to find which device files changed, downloads only those, and merges them into the local library. If the merge changes the local library, this device's own file is pushed again so every device converges.

## Merge rules

Merging works on each record (prompt, category, variable, button, note, shared setting) separately, by ID, across the local library and every device file. Implemented in `packages/core/src/sync/merge.ts`.

### Newer version or concurrent edit?

Every edit stamps the record with `updatedAt`, `updatedBy` and `ancestors` (see [data-model.md](data-model.md#field-rules)). A version **replaces** another when either:

- its `ancestors` contains the other's content hash (it was edited from that version on another device), or
- both came from the same device and it is later (a device's own versions form a line, so typing in a note never conflicts with that note's earlier uploads).

Versions that don't replace each other were edited **concurrently** (on two PCs before either synced).

| Situation | Result |
|---|---|
| Record exists in only one place | Kept |
| Same content everywhere (even if edited separately) | Kept once |
| One version replaces the other | The newer version, whatever the clocks say |
| Concurrent edits to a **prompt or note** | Latest `updatedAt` wins (ties broken by device ID, then content); the other version is kept as a conflict copy |
| Concurrent edits to a **category, variable, button or shared setting** | Latest `updatedAt` wins; no copy (these are small settings) |
| A deletion and an edit made after it | The edit wins (the record comes back); nothing else is kept |
| A deletion made after a concurrent edit | Deleted, and the edit is kept as a conflict copy so nothing is lost |
| Record present locally, unchanged since this device's last sync, and absent from every device file that synced after that | Treated as deleted (its tombstone was already cleaned up elsewhere) |
| `useCount`, `lastUsedAt` | Largest value wins; never a conflict |

### Conflict copies

When two devices edited the same prompt or note concurrently, the losing version is kept as a **conflict copy**:

- its ID is derived from the original ID plus the losing version's `updatedAt` and device, so every device creates the **same** copy and duplicates never multiply;
- its title gets " (conflict)" and `conflictOf` points to the original;
- the Prompt Bank or Notes pane shows a ⚠ badge with **Keep this**, **Keep other** and **Keep both**.

For notes, this means two PCs editing the same note offline both keep their text: the newer one stays as the note and the other appears beside it as a conflict copy to merge.

### Deletion records (tombstones)

A deleted record keeps a small tombstone (ID and `deletedAt`) for 180 days so devices that were offline still learn about the deletion. A device file whose last sync is older than 180 days is ignored until that device syncs again; when it does, its own unsynced edits are kept and merged as normal.

"Unchanged since the last sync" is known by keeping, per record, a short hash of its content as of the last successful sync (`sync-state.json`).

The merge is tested with simulated PCs in `packages/core/test/merge.test.ts`: propagation, 100 offline edits, concurrent edits on two and three PCs, deletions against edits, tombstone expiry, stale and returning devices, usage statistics, and convergence (every PC ends with identical data).

## Notes and their Markdown files

Notes are synced as records in the library. Each note is also mirrored to a local Markdown file, `~/.claude-codex-buttons/notes/<slug>--<id>.md`, so any editor or tool can read it:

- an edit made in the plugin rewrites the file;
- an edit made to the file in another editor is picked up by `ccb-mcp` (file newer than the record) and synced like any other edit;
- deleting a note is done in the plugin (deleting the file alone is undone on the next sync, so nothing is lost by accident).

## Local concurrency

Several `ccb-mcp` processes can run at once (Claude Code and Codex open together). They share the same files safely:

- writes take `~/.claude-codex-buttons/.lock` (an exclusive lock file with the process ID and a timestamp; a lock older than 30 s from a dead process is broken);
- before writing, a process re-reads the library; if `revision` changed, it merges first;
- only the process holding the lock pushes to Drive; the others see the result on their next read.

## Sign-in and tokens

- `ccb login` runs Google's OAuth flow for desktop apps: it opens the browser, receives the code on a local loopback address (`http://localhost:<port>`), and requests offline access so Google returns a refresh token. The refresh token is stored in the operating system's credential store (`@napi-rs/keyring`) under the service name `claude-codex-buttons`.
- Scope: `https://www.googleapis.com/auth/drive.file` only ("See, edit, create, and delete only the specific Google Drive files you use with this app").
- `ccb logout` deletes the token and revokes it with Google.
- If no credential store is available (for example, a cloud container), `ccb-mcp` reports `sync unavailable: no credential store` and keeps working locally. See [platforms/claude-code.md](platforms/claude-code.md#cloud-sessions) for the Claude connector alternative.

**Testing-mode caveat:** while the Google Cloud OAuth app is in "Testing" publishing status, refresh tokens are reported to expire after about 7 days, so `ccb login` must be repeated weekly. Publishing the app removes this. See [google-cloud-setup.md](google-cloud-setup.md#publishing-status).

## Size limits

| Item | Limit |
|---|---|
| One prompt body | 20,000 characters |
| One note | 200,000 characters |
| Whole synced library (one device file) | 10 MB; the pane warns at 8 MB |

## Status and errors

| Status line | Meaning | What to do |
|---|---|---|
| `Sync ✓ 12:04` | Up to date | Nothing |
| `Sync ↻` | Push or pull in progress | Nothing |
| `Sync · 3 pending` | Waiting for the push delay | Nothing |
| `Sync offline · 3 pending` | No network or Google unreachable | Will upload automatically when back online |
| `Sync ⚠ 1 conflict` | A conflict copy exists | Open the pane and resolve |
| `Sync ⚠ sign in` | Token missing, expired or revoked | Run `ccb login` |
| `Sync off` | `sync.mode = "off"` | Optional |

`ccb doctor` checks the token, the Drive folder, each device file's validity, the lock and the outbox, and prints a fix for each problem.

## Testing plan

- `core` unit tests for every row of the merge table, deterministic conflict-copy IDs, tombstone expiry and stale-device handling, for prompts, buttons, variables and notes.
- A fake Drive (in-memory, with a change feed and an injectable failure mode) for the MCP server's integration tests: three simulated devices, offline periods with note edits, simultaneous pushes, and a device returning after a long absence.
- One manual end-to-end check per release against a real Drive account on two computers: a prompt saved and a note edited on one appear on the other within 60 seconds, and an offline note edit appears after reconnecting.
