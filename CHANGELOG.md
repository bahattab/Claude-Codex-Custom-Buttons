# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Milestone M9, Translate: instant translation of selected text in Claude Code (a bubble above the prompt box), a Translate pane with a language picker, Swap, Copy, Insert and recent translations, the Translate button and `/tr`; the Codex `translate` skill, the Claude Desktop `ccb-translate` prompt, the `translate_instructions` tool and `translate.*` settings.
- Milestone M7, the Claude Desktop extension `claude-codex-buttons.mcpb`: an MCPB 0.4 manifest, `npm run build:desktop` (validated and packed with the official `mcpb` tool, also in CI), a privacy policy, and a project icon also used by the Claude and Codex plugins.
- Milestone M6, the Codex plugin `prompt-buttons-codex` (marketplace `ccb-codex`):
  - skills `continue`, `regenerate-prompt`, `prompt-bank`, `notes` and `drive-sync`, plus the bundled `ccb-mcp` server;
  - generated `$ccb-<name>` skills for buttons and favourite prompts, rewritten automatically, and `ccb sync codex`;
  - installed and checked with the real Codex CLI 0.167.1.
- Milestone M5b:
  - the background sync service: `ccb sync --daemon`, `ccb service install|status|stop|uninstall`, offered by `ccb login`; `--home`;
  - in the Claude Code plugin: a sync button in the row, a Prompt Bank sync section with **Sync now** and **Connect Google Drive**, **Keep this / Keep other / Keep both** for conflict copies, a dot on notes not uploaded yet, `/pb sync`, and a pull when a pane opens;
  - `conflict_resolve` and `sync_connect` tools.
- Milestone M5a, automatic Google Drive sync:
  - the sync engine in a new package `@ccb/sync`: uploads 2 seconds after a change, pulls every 60 seconds and at start, and retries offline changes with backoff (2 s to 5 min);
  - Drive API mode (a small `fetch` client using the change feed and the `drive.file` scope) and Drive for desktop folder mode;
  - Google sign-in with PKCE; the sign-in is kept by the OS (macOS Keychain, Linux Secret Service, Windows DPAPI), or in a private file with `google.tokenStore = "file"`;
  - `ccb login`, `ccb logout`, `ccb sync`, `ccb status`, and Drive checks in `ccb doctor`;
  - `sync_now` and `sync_status` tools.
- Milestone M4, the Claude Code plugin's panes:
  - **Prompt Bank** pane: search while typing, category and favourites filters, Insert, Send, Copy, Edit, Duplicate, Delete with Undo, New and Save draft; a Variables tab and a Buttons tab for making and deleting custom buttons;
  - **Notes** pane: pinned-first picker, editor with autosave, Rename, Pin, Copy, Insert into prompt, Delete; Keep mine / Load theirs when a note changed elsewhere while you had unsaved text;
  - built-in **Prompts** and **Notes** buttons; `/pb [search]`, `/pb save <title>`, `/notes [text]`; `insert-prompt` and `open-pane` buttons now work.
- Milestone M3, the Claude Code plugin `prompt-buttons`:
  - a button row above the prompt box with Continue (highlighted when a reply was cut off), Regenerate (with Undo and a warning when the rewrite dropped code, paths or numbers) and your custom buttons, with a More list beyond `buttons.maxVisible`;
  - `/cont`, `/regen [instruction|undo]` and `/btn <id>`.
- `ccb-mcp` `client_state` tool.
- `ccb-mcp` bundled into the plugin as one file (`npm run build:plugin`, drift check `npm run check:plugin`).
- Marketplace `ccb` at the repository root.

### Fixed (from the independent M6 review)

- The Codex plugin's server now starts: `.mcp.json` sets `"cwd": "."` (Codex otherwise used the project's folder) and passes `CODEX_HOME` and `CCB_HOME`.
- Codex skills no longer tell the agent to run `npx ccb` (an unrelated npm package) and no longer rely on `$1`/`$ARGUMENTS`, which Codex doesn't substitute.
- Generated Codex skills: written only when the Codex plugin is installed, emoji are no longer cut in half, and two libraries on one computer no longer remove each other's skills.

### Fixed (from the independent M5 review)

- A new prompt or note could be deleted everywhere when another computer's clock ran ahead or its upload raced with this one. Deletions are now inferred only from a device that dropped the record (D31).
- Signing in to another Google account could delete local data; each sign-in now has its own sync state.
- A trashed Drive folder or device file is re-created and uploaded again.
- Note-file edits are synced even when nothing else changed.
- `ccb login` changes settings only after sign-in succeeds.
- "Keep other" on a conflict copy whose original was deleted is refused instead of leaving nothing.
- After two computers created the Drive folder at once, a device's file in the oldest folder is no longer ignored.
- The Windows background service uses the per-user Run key (no administrator rights) and can be stopped.
- Request timeouts, a clear message when Drive access wasn't granted, resumable uploads for libraries over 4 MB, a weekly re-upload, and the token is never shown in error messages.

### Fixed (from the independent M4 review)

- Notes: autosave no longer overwrites a change made elsewhere before you choose Keep mine or Load theirs; a failed save no longer loses the text when you switch notes; `/notes <text>` and reopening the pane no longer discard a new, unsaved note; saves run one at a time; Rename and the delete confirmation survive a completed turn.
- Prompt Bank: a new button never replaces an existing one with the same ID; Save draft no longer replaces an open edit form; the variable notice shows the saved name; search buttons can open on a category.

### Fixed (from the independent M3 review)

- Slash-command messages are sent from a timer just after the command returns. They were waiting for a turn end that may never come, and could be triggered by a subagent's or a stopped turn. Several queued messages now go out in order.
- Undo regenerate now disappears after 30 seconds, and isn't offered when the rewrite was sent rather than placed in the box.
- A Regenerate interrupted by a reload no longer leaves the button stuck on "Regenerating...".
- The plugin asks Claude Code for its server's name (`$.mcp.connect`) instead of assuming it.
- The More list has a heading and runs the picked button; buttons refresh only after the main conversation's turns.

- Milestone M2, the local storage server and command line:
  - `@ccb/store`: a cross-process lock, crash-safe writes, backups with automatic recovery, a read-only mode for newer files, device identity, and a Markdown copy of each note (edits made in other editors are picked up).
  - `ccb-mcp`: 21 MCP tools for the Prompt Bank, categories, variables, buttons, notes, shared settings and Regenerate, plus MCP prompts built from the Prompt Bank.
  - `ccb`: `config list/get/set`, `export`, `import` and `doctor`.
  - Edit operations in `@ccb/core` (`ops.ts`).
- Tests: a contract test for every MCP tool, a multi-process "no lost changes" test, CLI tests and real-process start tests.
- `@ccb/core` (milestone M1), dependency-free and free of file/network access:
  - validation and cleanup for the library, device files and every record type, with default settings;
  - `{{variables}}` with built-ins, ask-when-run fields, escapes and single-pass expansion;
  - Prompt Bank search with ranking;
  - Regenerate instructions plus a check that code, URLs, paths and numbers survive a rewrite;
  - the sync merge (newer-vs-concurrent detection, deterministic conflict copies, tombstones, stale and returning devices);
  - schema migrations and the starter pack.
- `schema/library.schema.json`, kept in agreement with the core validators by tests.
- 101 tests with coverage thresholds enforced in CI; the merge was mutation-checked.
- Workspace scaffold (milestone M0): npm workspaces, TypeScript 6 base config, ESLint, Vitest, `packages/core` skeleton with tests, a documentation link checker (`npm run check:links`), and CI on Node 22 and 24.
- Notes now sync through Google Drive alongside the Prompt Bank, custom buttons and variables; offline edits upload when the connection returns.
- Automatic sync design: no manual step after the one-time sign-in, **Connect/Reconnect Google Drive** from the panes, and a per-user background sync service so sync continues when Claude Code and Codex are closed.
- Platform facts ledger filled in from primary sources: Claude Code 2.1.322 mod API, Codex 0.167.0 release, Google Drive v3 API definition, Google auth library, MCPB specification.
- Project documentation: README, architecture, feature specification, data model, Google Drive sync design, Google Cloud setup guide, platform guides (Claude Code, Claude Desktop, Codex), configuration reference, security and privacy, roadmap, design decisions, reference mapping.
- MIT license, contributing guide, security policy.

### Changed

- MCP tool names use underscores (`bank_search`), as Claude's API requires.
- New buttons and categories are placed after the last existing one.

### Fixed (from the independent M2 review)

- Edits made to a note's Markdown file in another editor could be overwritten by an unrelated change, or missed on file systems with coarse timestamps.
- Importing note-file edits could race with other changes.
- A missing `library.json` started a new library and later overwrote a good backup; recovery could also leave no `library.json` if interrupted.
- A slow but live process could lose its lock after 30 seconds; several processes clearing an abandoned lock at once could release a fresh one; clearing could retry forever.
- A damaged library with a backup from a newer version was reset.
- `ccb import` reported old conflict copies as new; older `library.json` files are now upgraded before import.
- MCP prompt names could change when a similar prompt was added, and could exceed 64 characters.
- Using a deleted prompt counted as a use; `buttons_list` now flags buttons whose prompt was deleted.
- Drive sync stores one file per device instead of one shared file, because Drive's update call cannot reject a stale write (decision D12).
- Codex install uses `codex plugin marketplace add` and `codex plugin add`; Codex custom commands are generated as skills (`$ccb-<id>`), since Codex migrated custom prompts into skills.
- Minimum Node.js version is 22 (Node 20 is end-of-life).
