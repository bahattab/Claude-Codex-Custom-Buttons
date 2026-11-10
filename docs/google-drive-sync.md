# Google Drive sync

The Prompt Bank (prompts, categories, variables, buttons) is saved in your Google Drive. Every prompt you save is uploaded within a few seconds, and every device and tool pulls changes from Drive.

## Principles

- **Local first.** The local `library.json` is the working copy. Saving never waits for the network, and everything works offline.
- **Drive is the shared master.** Whatever is in Drive after a successful upload is what every device converges to.
- **Nothing is lost silently.** Concurrent edits to the same prompt produce a visible conflict copy, never an overwrite.
- **Least privilege.** Only the `drive.file` permission is requested.

## Where the data lives in Drive

```
My Drive/
└── Claude Codex Buttons/
    ├── prompt-bank.json        the synced part of library.json
    └── README.txt              explains what the folder is
```

The folder is visible in Drive (default decision; see [decisions.md](decisions.md)). You can open `prompt-bank.json` in Drive, but edit prompts through the plugin: hand edits are accepted only if the file still validates.

## Sync modes

| Mode | Setting | Use when |
|---|---|---|
| **Drive API** (default) | `sync.mode = "drive-api"` | Normal use. Requires a one-time `ccb login` |
| **Drive for desktop folder** (fallback) | `sync.mode = "drive-folder"` | You use Google Drive for desktop and don't want to set up a Google Cloud OAuth client |
| **Off** | `sync.mode = "off"` | Local only |

### Fallback: Google Drive for desktop folder

Set `sync.folderPath` to a folder inside your locally synced Drive (for example `G:\My Drive\Claude Codex Buttons` on Windows or `~/Library/CloudStorage/GoogleDrive-<account>/My Drive/Claude Codex Buttons` on macOS). The plugin then reads and writes `prompt-bank.json` in that folder and Drive for desktop does the upload.

Limits of this mode:

- Upload timing is controlled by Drive for desktop, not the plugin.
- If two computers write at nearly the same moment, Drive for desktop may create a second file such as `prompt-bank (1).json`. The plugin detects files matching `prompt-bank*.json` in the folder, merges them with the normal rules, and removes the extra copies.
- It does not work on computers without Drive for desktop, such as cloud sessions.

## How a save reaches Drive (Drive API mode)

1. The change is written to `library.json` and recorded in `outbox.json` (item ID, kind, new `updatedAt`).
2. A push is scheduled `sync.pushDelayMs` later (default 2,000 ms). Further saves in that window reset the timer, so a burst of edits becomes one upload.
3. **Push:**
   1. Fetch the Drive file's metadata (its version number).
   2. If the version is the one recorded in `sync-state.json`, upload the merged content.
   3. If Drive changed in the meantime, download it, merge (rules below), then upload. If the version changed again during the upload, repeat, up to 3 attempts, then wait for the next cycle.
   4. On success, record the new version and clear the uploaded items from the outbox.
4. If offline or Google returns an error, the outbox keeps the items and the push retries with backoff (2 s, 4 s, 8 s … capped at 5 minutes). The status line shows `offline · N pending`.

The exact Drive API mechanism for "has this file changed since I read it" (comparing the file's `version` field, or a conditional request) is confirmed in milestone M0; see [platform-facts.md](platform-facts.md).

## How other devices get changes

A pull happens:

- when `ccb-mcp` starts (start of a Claude Code or Codex session);
- when the Prompt Bank pane opens;
- on **Sync now**, `/pb sync` or `ccb sync`;
- every `sync.intervalSeconds` (default 60) while a session is active, using Drive's change feed so an unchanged file costs one small request.

A pull downloads `prompt-bank.json` only if its version differs from the last one seen, then merges it into the local library.

## Merge rules

Merging works on each record (prompt, category, variable, button) separately, by ID.

| Situation | Result |
|---|---|
| Record exists on one side only | Kept |
| Same record, only one side changed since the last sync | The changed side wins |
| Same record, both sides changed, same content | Kept once |
| Same record, both sides changed, different content | The later `updatedAt` wins (ties broken by device ID); the other version is kept as a **conflict copy** with `conflictOf` set and " (conflict)" added to its title |
| One side deleted, the other edited after the deletion | The edit wins (the prompt comes back) |
| One side deleted, the other unchanged or edited before the deletion | Deleted |
| `useCount`, `lastUsedAt` | Largest value wins; never a conflict |
| Tombstone older than 30 days | Removed for good on both sides |

"Changed since the last sync" is known by keeping, per record, a short hash of the content as it was at the last successful sync (`sync-state.json`).

Conflict copies show a ⚠ badge in the Prompt Bank pane with **Keep this**, **Keep other** and **Keep both** actions.

## Local concurrency

Several `ccb-mcp` processes can run at once (Claude Code and Codex open together). They share the same files safely:

- Writes take `~/.claude-codex-buttons/.lock` (an exclusive lock file with the process ID and a timestamp; a lock older than 30 s from a dead process is broken).
- Before writing, a process re-reads `library.json`; if `revision` changed, it merges first.
- Only the process holding the lock pushes to Drive; the others see the result on their next read.

## Sign-in and tokens

- `ccb login` runs Google's OAuth flow for installed apps: it opens the browser, receives the code on a local loopback address, and stores the refresh token in the operating system's credential store (`@napi-rs/keyring`) under the service name `claude-codex-buttons`.
- Scope: `https://www.googleapis.com/auth/drive.file` only.
- `ccb logout` deletes the token and revokes it with Google.
- If no credential store is available (for example, a cloud container), `ccb-mcp` reports `sync unavailable: no credential store` and keeps working locally. See [platforms/claude-code.md](platforms/claude-code.md#cloud-sessions) for the Claude connector alternative.

**Testing-mode caveat:** while the Google Cloud OAuth app is in "Testing" publishing status, Google's refresh tokens expire after about 7 days, so `ccb login` must be repeated weekly. Publishing the app removes this. See [google-cloud-setup.md](google-cloud-setup.md#publishing-status).

## Status and errors

| Status line | Meaning | What to do |
|---|---|---|
| `Prompt Bank ✓ synced 12:04` | Up to date | Nothing |
| `Prompt Bank ↻ syncing` | Push or pull in progress | Nothing |
| `Prompt Bank · 3 pending` | Waiting for the push delay | Nothing |
| `Prompt Bank offline · 3 pending` | No network or Google unreachable | Will retry automatically |
| `Prompt Bank ⚠ 1 conflict` | A conflict copy exists | Open the pane and resolve |
| `Prompt Bank ⚠ sign in` | Token missing, expired or revoked | Run `ccb login` |
| `Prompt Bank ⚠ sync off` | `sync.mode = "off"` | Optional |

`ccb doctor` checks the token, the Drive folder, the file's validity, the lock and the outbox, and prints a fix for each problem.

## Testing plan

- `core` unit tests for every row of the merge table, tombstone expiry and conflict-copy creation.
- A fake Drive (in-memory, with version numbers and an injectable failure mode) for the MCP server's integration tests: two simulated devices, offline periods, concurrent pushes, mid-upload version changes.
- One manual end-to-end check per release against a real Drive account on two computers: a prompt saved on one appears on the other within 60 seconds.
