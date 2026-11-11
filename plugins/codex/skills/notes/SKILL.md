---
name: notes
description: "Read, write and add to the user's synced Notes (a scratchpad shared with Claude Code and their other computers). Use when the user asks to take a note, add to a note, show or search their notes."
metadata:
  short-description: "Synced scratchpad notes"
---

Notes live in the `ccb` MCP server, sync automatically through Google Drive, and also exist as Markdown files in `~/.claude-codex-buttons/notes/`.

- **Show notes**: `notes_list` (pinned first, then most recent). To show one, `notes_read` with its `id`.
- **Take a note** (the words after the skill's name): if the user means an existing note ("add to my shopping note"), find it with `notes_list` and use `notes_append` with its `id` and the text. Otherwise create one with `notes_write` and `body` (the first line becomes the title).
- **Change a note**: `notes_read`, then `notes_write` with the `id` and the whole new `body`. Show the change first if it rewrites more than a line or two.
- **Delete**: only after the user confirms, `notes_delete` with the `id`.
- **Conflict copies** ("(conflict)" in the title): the note was changed on two computers at once. Show both texts and offer `conflict_resolve` with `collection: "notes"`, `copyId` (the copy's `id`) and `keep` set to `copy`, `original` or `both`.

Never put secrets in a note unless the user asks: notes are uploaded to their Google Drive.
