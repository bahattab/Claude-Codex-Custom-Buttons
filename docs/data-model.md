# Data model

All persistent data lives in `~/.claude-codex-buttons/` on each computer. The synced part (prompts, categories, variables, buttons, notes and two shared settings) also lives in Google Drive.

```
~/.claude-codex-buttons/
├── library.json        the local library (everything below the "settings" line syncs)
├── library.bak.json    last copy that passed validation
├── outbox.json         local changes not yet uploaded to Drive
├── sync-state.json     Drive folder ID, change-feed token, per-record hashes at last sync
├── device.json         this computer's random device ID and display name
├── .lock               held while a process writes
├── notes-mirror.json   what was last written to each note's Markdown file (to recognise edits made elsewhere)
└── notes/
    └── <slug>--<id>.md Markdown mirror of each note, for other editors and tools
```

The validators in `packages/core/src/schema.ts` are the reference definition. The machine-readable [`schema/library.schema.json`](../schema/library.schema.json) (JSON Schema draft 2020-12) describes the stored form, including device files (`#/$defs/deviceFile`); tests check that both accept and reject the same documents.

## `library.json`

```json
{
  "schemaVersion": 1,
  "revision": 42,
  "prompts": [
    {
      "id": "01JC8Z5K2V9Q4W7E3R6T1Y0U8I",
      "title": "Review for security",
      "body": "Review {{selection}} for security issues in {{project}}. List findings by severity.",
      "category": "review",
      "tags": ["security", "code"],
      "favorite": true,
      "useCount": 12,
      "lastUsedAt": "2026-11-09T18:22:04.512Z",
      "createdAt": "2026-10-01T09:00:00.000Z",
      "updatedAt": "2026-11-02T14:10:33.020Z",
      "updatedBy": "dev_7f3a91",
      "deletedAt": null,
      "ancestors": ["3f2a9c0d17b4e65a91c08d2e4f7b"],
      "conflictOf": null
    }
  ],
  "categories": [
    { "id": "review", "name": "Code review", "order": 1, "updatedAt": "2026-10-01T09:00:00.000Z", "updatedBy": "dev_7f3a91", "deletedAt": null, "ancestors": [] }
  ],
  "variables": [
    { "id": "project", "value": "Billing API", "updatedAt": "2026-10-05T10:00:00.000Z", "updatedBy": "dev_7f3a91", "deletedAt": null, "ancestors": [] }
  ],
  "buttons": [
    {
      "id": "btn_review",
      "label": "Security review",
      "icon": "🛡️",
      "action": { "type": "submit", "promptId": "01JC8Z5K2V9Q4W7E3R6T1Y0U8I" },
      "order": 1,
      "updatedAt": "2026-10-01T09:00:00.000Z",
      "updatedBy": "dev_7f3a91",
      "deletedAt": null,
      "ancestors": []
    }
  ],
  "notes": [
    {
      "id": "01JCA1M3QK7T2B9W4X6Z8C0D1E",
      "title": "Release checklist",
      "body": "# Release checklist\n\n- bump version\n- update CHANGELOG\n",
      "pinned": false,
      "createdAt": "2026-11-01T08:00:00.000Z",
      "updatedAt": "2026-11-09T21:14:02.118Z",
      "updatedBy": "dev_c02e5d",
      "deletedAt": null,
      "ancestors": [],
      "conflictOf": null
    }
  ],
  "sharedSettings": [
    { "id": "continue.message", "value": "Continue from where you stopped.", "updatedAt": "2026-11-03T12:00:00.000Z", "updatedBy": "dev_7f3a91", "deletedAt": null, "ancestors": [] }
  ],
  "settings": {
    "regenerate": { "autoSubmit": false, "source": "auto" },
    "continue": { "highlightOnTruncation": true },
    "buttons": { "maxVisible": 6, "showBuiltIns": true },
    "notes": { "autosaveMs": 2000, "mirrorFiles": true },
    "sync": { "mode": "drive-api", "folderPath": null, "driveFolderName": "Claude Codex Buttons", "intervalSeconds": 60, "pushDelayMs": 2000, "backgroundService": true },
    "codex": { "autoSync": true },
    "google": { "clientFile": null }
  }
}
```

## Field rules

Every synced record carries:

| Field | Meaning |
|---|---|
| `id` | Unique within its collection |
| `updatedAt` | ISO 8601 UTC time of the last content edit; always later than the version it replaced |
| `updatedBy` | Device ID of the last editor (`dev_…`), or `starter` for starter-pack records |
| `deletedAt` | Time of deletion (a tombstone), or null |
| `ancestors` | Up to 32 content hashes of versions written by **other** devices that this version replaced. Lets the merge tell a newer version from a concurrent edit; see [google-drive-sync.md](google-drive-sync.md#merge-rules) |

Every collection is a list of records with unique IDs, including variables (ID = variable name) and shared settings (ID = `regenerate.instructions` or `continue.message`).

### Prompt

| Field | Type | Rules |
|---|---|---|
| `id` | string | ULID, created once, never changes |
| `title` | string | 1–120 characters, trimmed |
| `body` | string | 1–20,000 characters; may contain `{{variables}}` |
| `category` | string or null | ID of a category; unknown IDs fall back to null |
| `tags` | string[] | Up to 20, each 1–32 characters, lowercased, unique |
| `favorite` | boolean | |
| `useCount`, `lastUsedAt` | number, timestamp | Statistics; largest value wins on merge, never a conflict |
| `createdAt`, `updatedAt` | timestamp | `updatedAt` changes on every content edit |
| `updatedBy` | string | Device ID of the last editor |
| `deletedAt` | timestamp or null | Set on delete (a tombstone); removed for good 180 days later |
| `conflictOf` | string or null | Set on a conflict copy; the ID of the record it conflicts with |

### Variable

`id` is the variable name (`^[a-z][a-z0-9_]{0,63}$`; other characters are normalised to `_` and letters lowercased). `value`: up to 5,000 characters of plain text.

### Category

`id` matches `^[a-z0-9][a-z0-9_-]{0,63}$`; `name` 1–60 characters; `order` a whole number.

### Shared setting

`id` is `regenerate.instructions` or `continue.message`; `value` is up to 10,000 characters, or null for the built-in default.

### Button

| Field | Rules |
|---|---|
| `id` | `btn_` + lowercase letters, digits, underscores; also the `/btn <id>` name |
| `label` | 1–24 characters |
| `icon` | Optional, one emoji |
| `action` | One of the [action types](features.md#action-types). `submit`/`fill` take `promptId` **or** `text`; `fill` also takes `mode`: `replace` (default), `append`, `insert` |
| `order` | Position in the button row |

### Note

| Field | Rules |
|---|---|
| `id` | ULID |
| `title` | 1–120 characters; defaults to the first `# ` heading or first line of the body |
| `body` | Markdown, up to 200,000 characters |
| `pinned` | Pinned notes are listed first |
| `createdAt`, `updatedAt`, `updatedBy`, `deletedAt`, `conflictOf` | As for prompts |

Each note is mirrored to `notes/<slug>--<id>.md`, where `<slug>` is the title in lowercase with hyphens. The file holds only the body; an edit made to the file in another editor is picked up and synced (see [google-drive-sync.md](google-drive-sync.md#notes-and-their-markdown-files)).

## Device file in Drive

Each device uploads `devices/<deviceId>.json` to the Drive folder. It holds that device's merged view of the synced data:

```json
{
  "format": "ccb-device/1",
  "schemaVersion": 1,
  "deviceId": "dev_7f3a91",
  "deviceName": "Laptop",
  "syncedAt": "2026-11-10T07:48:16.000Z",
  "prompts": [],
  "categories": [],
  "variables": {},
  "buttons": [],
  "notes": [],
  "sharedSettings": {}
}
```

Only the device named in `deviceId` writes this file. Records include tombstones, so deletions travel too.

## Validation and recovery

- Every read and every write is validated against the schema, including device files downloaded from Drive.
- Text fields are trimmed and stripped of invisible control characters; Markdown and code are kept as-is (they are prompt or note content, never rendered as HTML).
- If `library.json` fails validation on load, the last valid `library.bak.json` is used, the broken file is kept as `library.broken-<time>.json`, and the user is told.
- An invalid device file from Drive is skipped and reported by `ccb doctor`; it never overwrites good local data.
- Writes are atomic: write to a temporary file in the same folder, then rename over the original.

## Schema versions and migration

`schemaVersion` starts at 1. Each future version adds a migration function in `core/migrate/` that upgrades the previous version. A client that finds a **newer** version than it understands, locally or in a device file, opens the library read-only and asks the user to update.

## What is synced

| Data | Synced to Drive |
|---|---|
| Prompts, categories, variables, buttons | Yes |
| Notes | Yes |
| `sharedSettings` (Regenerate instructions, Continue message) | Yes |
| `settings` (everything else) | No, per device |
| Outbox, sync state, device ID | No |
