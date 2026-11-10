# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
