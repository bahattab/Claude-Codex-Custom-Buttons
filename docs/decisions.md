# Design decisions

Each decision records the options considered, the choice and why. All were approved by the project owner on 2026-11-10 ("go with all recommended defaults").

## D1. Claude Desktop scope

- **Options:** (a) Claude Code plugin for the Code tab, plus MCP prompts for the Chat tab; (b) Code tab only; (c) inject scripts into the Electron app to add buttons to the Chat tab.
- **Choice:** (a).
- **Why:** both tabs get the Prompt Bank. (c) is fragile across app updates and may conflict with the app's terms.

## D2. Regenerate behaviour

- **Options:** (a) put the rewrite in the prompt box for review, auto-submit as an option; (b) always auto-submit.
- **Choice:** (a), `regenerate.autoSubmit = false` by default.
- **Why:** a rewrite can change meaning; the user should see it before it is sent. Undo is provided either way.

## D3. Storage location

- **Options:** (a) one shared library in `~/.claude-codex-buttons/`; (b) separate storage per tool.
- **Choice:** (a).
- **Why:** "save once, use everywhere" is the core idea, and Drive sync needs one source.

## D4. Repository visibility and name

- **Choice:** private repository `bahattab/Claude-Codex-Custom-Buttons` (GitHub does not allow spaces in names).

## D5. Codex integration depth

- **Options:** (a) skills, MCP server and generated commands (generated skills since M0, fact X5); (b) also hooks.
- **Choice:** (a).
- **Why:** hooks were reported as experimental behind a feature flag; they can be added later without changing the data model.

## D6. License

- **Options:** MIT; GPL-2.0-or-later (as the WordPress reference).
- **Choice:** MIT.
- **Why:** no WordPress code is reused, so GPL is not required; MIT keeps reuse simple across ecosystems.

## D7. Location in Google Drive

- **Options:** (a) visible folder "Claude Codex Buttons" in My Drive; (b) hidden app-data folder.
- **Choice:** (a).
- **Why:** users can see and back up their data; with `drive.file` the app still cannot see other files.

## D8. What syncs (revised 2026-11-10)

- **Options:** (a) Prompt Bank, buttons and variables; (b) also Notes; (c) Prompt Bank only.
- **Original choice:** (a).
- **Revised choice:** (b), at the project owner's request: "Notes are saved locally and synced through Google Drive, so you can access and edit them from any PC. Offline edits sync when the connection returns. Sync now includes Prompt Bank, custom buttons, variables, and Notes."
- **Why:** notes are part of the working set the owner wants on every PC. Notes become synced library records with a local Markdown mirror (see [data-model.md](data-model.md#note)).

## D9. Drive connection mode

- **Options:** (a) Drive API through `ccb-mcp`, with the Drive for desktop folder as fallback; (b) Drive for desktop folder only; (c) Claude's Google Drive connector.
- **Choice:** (a).
- **Why:** works on any computer and with Codex; nearly instant; per-prompt merging. (b) has no control over upload timing and creates duplicate files under contention. (c) is unavailable to Codex.

## D10. Who owns storage and sync

- **Choice:** the MCP server (`ccb-mcp`) is the only component that reads/writes the library and talks to Drive; the Claude mod reaches it through `$.mcp`.
- **Why:** one implementation shared by all three platforms; credentials in one place. Recorded during documentation; follows from D3 and D9.

## D11. No code-running actions

- **Choice:** buttons cannot run shell commands or scripts.
- **Why:** a synced library that can run code would let anyone with access to the Drive file run commands on every device. The reference plugin's unescaped `custom_html` type is the analogous risk and is not carried over.

## D12. One Drive file per device (2026-11-10, M0)

- **Options:** (a) one shared `prompt-bank.json`, read-merge-write with a version check; (b) one file per device, each written only by its device, all merged on read.
- **Choice:** (b).
- **Why:** M0 found that Drive's update call has no "only if unchanged" condition (fact G3), so (a) can silently lose one device's upload when two devices push together. (b) has no shared writer, so that race cannot happen, and it also prevents Google Drive for desktop "(1)" duplicates in the fallback mode. Costs: each pull may download several small files (only changed ones, via the change feed), and conflict copies need deterministic IDs so devices don't each create their own.

## D13. Copy `core` into the Claude plugin at build time (2026-11-10, M0)

- **Why:** a mod may import only files inside its own plugin and no npm packages (fact C15). `core` stays dependency-free, and a build step copies its compiled modules into `plugins/claude/hooks/core/`. CI checks the copy is up to date.

## D14. Sync is always automatic (2026-11-10)

- **Choice:** sync needs no user action after the one-time sign-in: changes push about 2 s after saving, pulls run on start, on pane open and every 60 s, offline changes retry, and a **background sync service** keeps syncing when no Claude Code or Codex session is open. Sign-in can start from a **Connect Google Drive** button in the panes.
- **Why:** the project owner's requirement ("sync has to be automatic"). The background service is per-user (no administrator rights) and can be declined at `ccb login` or removed with `ccb service uninstall`.

## D15. Node.js 22 or newer (2026-11-10, M0)

- **Why:** Node.js 20 reached end of life in April 2026, and the test runner (Vitest 5) needs Node 22.12 or newer. Claude Desktop ships its own Node for the desktop extension.

## D16. TypeScript 6 for now (2026-11-10, M0)

- **Why:** TypeScript 7.0.2 is the latest release, but `typescript-eslint` 8.72 supports TypeScript below 6.1. The project pins TypeScript 6.0.3 and moves to 7 when the linter supports it.
