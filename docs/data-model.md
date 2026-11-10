# Data model

All persistent data lives in `~/.claude-codex-buttons/` on each computer, and the synced part also lives in Google Drive.

```
~/.claude-codex-buttons/
├── library.json        the library (prompts, categories, variables, buttons, settings)
├── library.bak.json    last copy that passed validation
├── outbox.json         local changes not yet uploaded to Drive
├── sync-state.json     Drive file ID, last seen Drive version, change-feed token
├── device.json         this computer's random device ID
├── .lock               held while a process writes
└── notes/
    └── <note-id>.md    one file per note (local only)
```

The authoritative machine-readable definition will be `schema/library.schema.json` (JSON Schema draft 2020-12), generated from the `core` schema in M1.

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
      "conflictOf": null
    }
  ],
  "categories": [
    { "id": "review", "name": "Code review", "order": 1, "updatedAt": "2026-10-01T09:00:00.000Z", "deletedAt": null }
  ],
  "variables": {
    "project": { "value": "Billing API", "updatedAt": "2026-10-05T10:00:00.000Z", "deletedAt": null }
  },
  "buttons": [
    {
      "id": "btn_review",
      "label": "Security review",
      "icon": "🛡️",
      "action": { "type": "submit", "promptId": "01JC8Z5K2V9Q4W7E3R6T1Y0U8I" },
      "order": 1,
      "updatedAt": "2026-10-01T09:00:00.000Z",
      "deletedAt": null
    }
  ],
  "settings": {
    "regenerate": { "autoSubmit": false, "instructions": null },
    "continue": { "message": null },
    "buttons": { "maxVisible": 6 },
    "sync": { "mode": "drive-api", "intervalSeconds": 60, "pushDelayMs": 2000 }
  }
}
```

## Field rules

### Prompt

| Field | Type | Rules |
|---|---|---|
| `id` | string | ULID, created once, never changes |
| `title` | string | 1–120 characters, trimmed |
| `body` | string | 1–20,000 characters; may contain `{{variables}}` |
| `category` | string or null | ID of a category; unknown IDs fall back to null |
| `tags` | string[] | Up to 20, each 1–32 characters, lowercased, unique |
| `favorite` | boolean | |
| `useCount`, `lastUsedAt` | number, timestamp | Local statistics; synced but never cause conflicts (largest value wins) |
| `createdAt`, `updatedAt` | ISO 8601 UTC timestamp | `updatedAt` changes on every content edit |
| `updatedBy` | string | Device ID of the last editor |
| `deletedAt` | timestamp or null | Set on delete (a "tombstone"); the record is removed for good 30 days later |
| `conflictOf` | string or null | Set on a conflict copy; the ID of the prompt it conflicts with |

### Variable

Key: the variable name (`^[a-z][a-z0-9_]{0,63}$`). Value: up to 5,000 characters of plain text.

### Button

| Field | Rules |
|---|---|
| `id` | `btn_` + lowercase letters, digits, underscores; also the `/btn <id>` name |
| `label` | 1–24 characters |
| `icon` | Optional, one emoji |
| `action` | One of the [action types](features.md#action-types). `submit`/`fill` take `promptId` **or** `text`; `fill` also takes `mode`: `replace` (default), `append`, `insert` |
| `order` | Position in the button row |

### Note (local only)

Markdown file `notes/<id>.md`. The first line starting with `# ` is the title. Metadata (created/updated) comes from the file system.

## Validation and recovery

- Every read and every write is validated against the schema.
- Text fields are trimmed and stripped of invisible control characters; Markdown and code are kept as-is (they are prompt content, never rendered as HTML).
- If `library.json` fails validation on load, the last valid `library.bak.json` is used, the broken file is kept as `library.broken-<time>.json`, and the user is told.
- Writes are atomic: write to a temporary file in the same folder, then rename over the original.

## Schema versions and migration

`schemaVersion` starts at 1. Each future version adds a migration function in `core/migrate/` that upgrades the previous version. A client that finds a **newer** version than it understands opens the library read-only and asks the user to update.

## What is synced

| Data | Synced to Drive |
|---|---|
| Prompts, categories, variables, buttons | Yes |
| Settings | Only `regenerate.instructions` and `continue.message`; the rest is per device |
| Notes, outbox, sync state, device ID | No |
