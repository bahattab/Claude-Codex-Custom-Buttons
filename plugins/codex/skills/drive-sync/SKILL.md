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
4. `state` is `not-set-up`: Google Drive sync needs a one-time Google Cloud OAuth client (see docs/google-cloud-setup.md in the plugin's repository), then `npx ccb login`. Or use a Google Drive for desktop folder: `npx ccb config set sync.mode drive-folder` and `npx ccb config set sync.folderPath <folder>`.
5. `conflicts` above 0: list the "(conflict)" prompts or notes and offer `conflict_resolve`.

$ARGUMENTS
