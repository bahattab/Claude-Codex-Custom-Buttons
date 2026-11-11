# Privacy policy

*Claude Codex Custom Buttons: the Claude Code plugin `prompt-buttons`, the Codex plugin `prompt-buttons-codex`, the Claude Desktop extension `claude-codex-buttons`, and the `ccb` command. Effective 11 November 2026.*

This project is open-source software that runs on your own computers. It has no server of its own, collects no analytics or telemetry, and sends nothing to its authors.

## What it stores, and where

| Data | Where |
|---|---|
| Your prompts, categories, prompt variables, custom buttons, notes, and two shared settings (the Regenerate instructions and the Continue message) | On each of your computers, in `~/.claude-codex-buttons/` (or the folder you choose), readable only by your user account. Each note is also kept as a Markdown file there |
| The same data, if you turn on sync | In **your own** Google Drive, in a folder named `Claude Codex Buttons` |
| Your Google sign-in (a refresh token), if you connect Google Drive | Your operating system's credential store (macOS Keychain, the Secret Service on Linux, or a file encrypted for your Windows account). In a file only your account can read if you choose `google.tokenStore = "file"` |
| A copy of the Google OAuth client you set up | `~/.claude-codex-buttons/google-client.json`, readable only by your user account |
| Codex skills generated from your buttons and favourite prompts | Your Codex folder (`~/.codex/skills/ccb-*`), only if Codex is installed |

## What leaves your computer

- **Google Drive, only if you connect it.** Your synced data goes to your own Google Drive through Google's API, over HTTPS. The plugin asks only for the `drive.file` permission, so it can see and change only the files it created; it can't read the rest of your Drive. Google's handling of that data is covered by Google's own privacy policy and terms. You can disconnect at any time with `ccb logout`, which also revokes the sign-in, or under *Third-party connections* in your Google Account.
- **The AI tool you use.** When you use a prompt, Regenerate or translate text (including text you select while instant translation is on in Claude Code), or ask the assistant to read a note, that text is sent to the model of the tool you're using (Claude in Claude Code or Claude Desktop, the Codex model in Codex), the same as anything you type there. That provider's policy applies.
- **Nothing else.** No usage data, crash reports or identifiers are sent anywhere. Logs stay on your computer and never contain prompt or note text.

## Your control

- **See your data:** it's plain JSON and Markdown in your data folder and your Drive folder.
- **Export it:** `ccb export`.
- **Delete it:** delete items in the plugin (deletions sync to your other computers), delete the data folder, and delete the `Claude Codex Buttons` folder in your Drive.
- **Stop syncing:** `ccb config set sync.mode off`, or `ccb logout`.
- **Remove the background sync service:** `ccb service uninstall`.

## Changes

Changes to this policy are recorded in the project's [CHANGELOG](../CHANGELOG.md) and in this file's history.

## Contact

Open an issue in the project's repository: <https://github.com/bahattab/Claude-Codex-Custom-Buttons/issues>. For security reports, see [SECURITY.md](../SECURITY.md).
