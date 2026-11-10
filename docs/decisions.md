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
- **Refined in M2 (D20):** file access lives in the `@ccb/store` package, used by both `ccb-mcp` and the `ccb` command, so they share one lock and one set of rules. Google Drive access stays in `ccb-mcp`.

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

## D17. Detect concurrent edits with `ancestors` (2026-11-10, M1)

- **Options:** (a) compare each version with the hash this device saw at the last sync; (b) record on each version which other devices' versions it replaced (`ancestors`), and treat a device's own later version as replacing its earlier ones.
- **Choice:** (b).
- **Why:** (a) mistakes an old version still sitting in a rarely-synced device file for a new edit, creating false conflict copies, and depends on clocks. (b) decides "newer or concurrent" from the edit history itself, so typing a note 100 times offline produces no conflict, while two PCs editing the same note do. Only foreign versions are recorded, so the list stays short (capped at 32).
- **Also decided:** a deletion that wins over a concurrent edit keeps the edit as a conflict copy, so no text is lost silently. Categories, variables, buttons and shared settings resolve by newest edit without copies.

## D18. Hand-written JSON Schema, checked by tests (2026-11-10, M1)

- **Why:** core stays dependency-free (D13), so it can't generate a JSON Schema from a schema library. `schema/library.schema.json` is written by hand and a test runs both it (through `ajv`, a development-only dependency) and the core validators over the same valid and invalid documents.

## D19. MCP tool names use underscores (2026-11-10, M2)

- **Why:** Claude's API accepts tool names matching `^[a-zA-Z0-9_-]{1,64}$`, so the documented `bank.search` style would be rejected. Tools are named `bank_search`, `notes_append` and so on; a test checks every name.

## D20. A shared `@ccb/store` package (2026-11-10, M2)

- **Options:** (a) only `ccb-mcp` touches files, and `ccb` asks the server; (b) a small storage package used by both.
- **Choice:** (b).
- **Why:** `ccb doctor` and `ccb import` must work when no server is running, for example to repair a damaged library. Both tools use the same lock and the same `update` path, so the "one writer at a time" guarantee holds either way.

## D21. Lock-file design (2026-11-10, M2; revised after independent review)

- **Choice:**
  - The lock file is created with its contents in one step: write a temporary file, then hard-link it into place, or use an exclusive create where hard links are unsupported.
  - While the lock is held, the holder refreshes the file's modification time (a heartbeat).
  - A lock counts as abandoned only when its process no longer exists, or when the heartbeat has stopped for 30 seconds. A lock that can't be read is judged by age, and a lock that disappears is simply retried.
  - Abandoned locks are cleared by one process at a time through a short "breaker" lock, with a re-check before removal. Every retry path has a deadline and a pause.
- **Why:**
  - The first design, a plain exclusive create, lost 1 of 100 changes in the multi-process test, because waiters read the new lock file before its contents were written.
  - A stress test then exposed a second race: a released lock mistaken for an abandoned one.
  - The independent review found three more problems: a live holder lost its lock after 30 seconds, several processes clearing a lock at once could release a fresh one, and the clearing path could spin with no time limit.
  - With all of these fixed: 8 concurrent processes × 50 changes kept every change (2,400/2,400 before the review fixes, 1,600/1,600 after). A test runs 8 waiters against an abandoned lock and checks that at most one is ever inside.

## D22. Recognise note-file edits by content, not timestamps (2026-11-10, M2)

- **Why:** the independent review showed timestamp comparison loses edits. Any unrelated save rewrote the files before checking them, and file systems with coarse or skewed timestamps hid edits. The store now records a hash of what it last wrote to each note file (`notes-mirror.json`). Any file whose content differs from that hash was edited elsewhere, and is imported while the lock is held, before every change.

## D23. Plugin and marketplace names (2026-11-10, M3)

- **Choice:** the Claude Code plugin is `prompt-buttons` in the marketplace `ccb`; the Codex plugin will be `prompt-buttons-codex` in `ccb-codex`. The project, repository, data folder (`~/.claude-codex-buttons`) and credential-store service name are unchanged.
- **Why:** `claude plugin validate` refuses third-party plugin names that start with `claude-` ("reserved: it passes as one of Anthropic's own") and asks for a name that describes what the plugin does.

## D24. Slash commands send their message when their turn ends (2026-11-10, M3)

- **Why:** Claude Code refuses `$.prompt.submit` inside a `command.run` hook ("it would wait on the turn this hook is holding; submit from a later event (turn.complete)"), found by the plugin's first test. Commands queue the text and the `turn.complete` hook sends it; buttons send immediately.

## D25. Ship `ccb-mcp` inside the Claude plugin as one bundled file (2026-11-10, M3)

- **Why:** an installed plugin gets no `npm install`, so its MCP server must run with Node alone. `scripts/build-plugin.mjs` bundles the server and its dependencies with esbuild (805 KB, minified) and copies `core` into the mod. The generated files are committed, and `npm run check:plugin` in CI fails if they don't match the sources.
