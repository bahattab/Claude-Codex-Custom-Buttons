# Configuration

## Where settings live

| Setting group | Stored in | Synced |
|---|---|---|
| Regenerate instructions, Continue message | `library.json` → `sharedSettings` | Yes |
| Everything else below | `library.json` → `settings` | No (per device) |
| Google OAuth client | `~/.claude-codex-buttons/google-client.json` | No |
| Google refresh token | OS credential store, service `claude-codex-buttons` | No |

Change settings from the Prompt Bank pane's **Settings** tab, the Claude Code plugin options menu, or the command line:

```bash
npx ccb config list
npx ccb config get sync.intervalSeconds
npx ccb config set regenerate.autoSubmit true
```

## Settings reference

| Key | Type | Default | Meaning |
|---|---|---|---|
| `regenerate.autoSubmit` | boolean | `false` | Send the rewritten prompt immediately instead of placing it in the prompt box |
| `regenerate.instructions` | string or null | null (built-in) | Your own rewrite instructions |
| `regenerate.source` | `"auto"`, `"selection"`, `"draft"`, `"last"` | `"auto"` | Where Regenerate takes text from |
| `continue.message` | string or null | null (built-in) | The continuation message |
| `continue.highlightOnTruncation` | boolean | `true` | Highlight Continue when a reply was cut off |
| `buttons.maxVisible` | integer 1–12 | `6` | Buttons shown in the row before the overflow menu |
| `buttons.showBuiltIns` | boolean | `true` | Show Continue, Regenerate, Notes, Prompts in the row |
| `notes.autosaveMs` | integer | `2000` | Delay after typing before a note saves (and is queued for upload) |
| `notes.mirrorFiles` | boolean | `true` | Keep a Markdown copy of each note in `notes/` |
| `sync.backgroundService` | boolean | `true` | Keep syncing when no Claude Code or Codex session is open (asked at `ccb login`) |
| `sync.mode` | `"drive-api"`, `"drive-folder"`, `"off"` | `"drive-api"` | See [google-drive-sync.md](google-drive-sync.md#sync-modes) |
| `sync.folderPath` | string | none | Drive for desktop folder (only for `drive-folder`) |
| `sync.driveFolderName` | string | `"Claude Codex Buttons"` | Folder created in My Drive (only for `drive-api`) |
| `sync.intervalSeconds` | integer 15–3600 | `60` | Automatic pull interval |
| `sync.pushDelayMs` | integer 500–60000 | `2000` | Wait after a change before it uploads automatically |
| `google.clientFile` | path | none | OAuth client JSON downloaded from Google Cloud |
| `codex.autoSync` | boolean | `true` | Regenerate Codex `$ccb-<id>` skills after each sync that changes buttons or prompts |

## Environment variables

| Variable | Effect |
|---|---|
| `CCB_HOME` | Use a different data folder than `~/.claude-codex-buttons` (useful for tests) |
| `CCB_SYNC_MODE` | Overrides `sync.mode` for this process |
| `CCB_LOG_LEVEL` | `error`, `warn` (default), `info`, `debug`. Logs never contain prompt text |

## Claude Code plugin options

The Claude Code plugin exposes the most-used settings (`regenerate.autoSubmit`, `buttons.maxVisible`, `sync.mode`) as plugin options, shown in Claude Code's plugin config menu. Changing one there writes the same key in `library.json`.

## Codex

Buttons and prompts are turned into Codex skills in `$CODEX_HOME/skills/ccb-<id>/` (default `~/.codex/skills`) automatically after each sync (`codex.autoSync`). `npx ccb sync codex` forces it. See [platforms/codex.md](platforms/codex.md#generated-skills).

## Background sync service

```bash
npx ccb service status
npx ccb service stop
npx ccb service uninstall
```

See [google-drive-sync.md](google-drive-sync.md#background-sync-service).
