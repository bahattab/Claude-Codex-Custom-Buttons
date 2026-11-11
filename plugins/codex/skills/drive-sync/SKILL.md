---
name: drive-sync
description: "Check or fix Google Drive sync of the Prompt Bank, buttons, variables and Notes: status, sync now, connect Google Drive. Use when the user asks about sync, whether changes reached another computer, or to connect Google Drive."
metadata:
  short-description: "Google Drive sync status"
---

Sync is automatic; the user never has to press anything. Use the `ccb` MCP tools:

1. `sync_status`, and explain its `line` and `message` in plain words: pending changes wait and upload by themselves; "offline" retries on its own.
2. If the user wants it now: `sync_now`.
3. `state` is `signed-out`: offer to connect. `sync_connect` opens Google's sign-in in the browser and returns the link (`url`); give the link too. Sync starts by itself once they finish.
4. `state` is `not-set-up`: Google Drive sync needs a one-time Google Cloud OAuth client (docs/google-cloud-setup.md in the project's repository), then a sign-in with `sync_connect` here or the `ccb login` command. Tell the user these steps; don't run `ccb` or `npx` commands yourself (the name `ccb` on npm belongs to an unrelated package). The alternative is a Google Drive for desktop folder (`ccb config set sync.mode drive-folder`, then `ccb config set sync.folderPath <folder>`).
5. `conflicts` above 0: list the "(conflict)" prompts or notes and offer `conflict_resolve` with `collection`, `copyId` (the copy's `id`) and `keep` (`copy`, `original` or `both`).

Anything the user wrote after the skill's name says what they want to know.
