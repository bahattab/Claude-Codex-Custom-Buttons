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

- **Options:** (a) skills, MCP server and generated slash commands; (b) also hooks.
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

## D8. What syncs

- **Options:** (a) Prompt Bank, buttons and variables; (b) also Notes; (c) Prompt Bank only.
- **Choice:** (a).
- **Why:** buttons and variables are useless on another device without the prompts they reference. Notes are often machine-specific scratch work; opt-in Notes sync is on the "later" list.

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
