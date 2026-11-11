# Roadmap

Each milestone delivers something usable and ends with checks that must pass before the next one starts. Status values: **Planned**, **Active**, **Blocked**, **Verified**, **Done**.

| # | Milestone | Status | Depends on |
|---|---|---|---|
| M0 | Confirm platform facts, scaffold the repository, CI | **Done** (2026-11-10) | — |
| M1 | `core`: schema, validation, variables, search, Regenerate instructions, merge engine | **Done** (2026-11-10) | M0 |
| M2 | `ccb-mcp` server with local storage (prompts, buttons, variables, notes), plus `ccb` basics | **Done** (2026-11-10) | M1 |
| M3 | Claude mod, part 1: button row, Continue, Regenerate, slash commands | **Done** (2026-11-10) | M2 |
| M4 | Claude mod, part 2: Prompt Bank pane, Notes pane, button editor | Done | M3 |
| M5 | Automatic Google Drive sync: per-device files, Drive API and Drive-folder modes, `ccb login`, background sync service | Done | M2 |
| M6 | Codex plugin: skills, MCP config, generated `$ccb-<id>` skills | Planned | M2, M5 |
| M7 | Claude Desktop Chat tab: `.mcpb` desktop extension | Planned | M2, M5 |
| M8 | Hardening, documentation pass, release v0.1.0 | Planned | M4, M6, M7 |

M5 can run in parallel with M3–M4 because both only depend on the server's tool interface, which is fixed in M2.

---

## M0: Confirm facts and scaffold

- Check every **Unconfirmed** row in [platform-facts.md](platform-facts.md) against official sources: Codex plugin manifest and install command, Codex skills and custom-command locations, Codex hooks status, Drive API change detection and change feed, Google OAuth testing-mode token expiry, Claude Desktop `.mcpb` manifest and MCP prompt display.
- Confirm whether a Claude mod can import local TypeScript files or must be one bundled file.
- Create the workspace (`package.json`, `tsconfig.base.json`), `.github/workflows/ci.yml` (lint, type-check, test), `.gitignore`.

**Done when:** every M0 row in the facts ledger is Confirmed or Changed (with the docs updated), and CI runs green on an empty workspace.

**Result (2026-11-10):** done. Checked against Claude Code 2.1.322's mod API, the Codex 0.167.0 release, Google's Drive v3 API definition, the official Google auth library and the MCPB spec. Changed as a result: Codex install commands (`codex plugin marketplace add` / `codex plugin add`), Codex custom commands become generated skills, and Drive sync uses one file per device (D12). Still unconfirmed and scheduled for hands-on checks: Google's 7-day testing-mode token expiry (G2), Codex marketplace file precedence (X8, M6), MCP prompts in the Desktop Chat "+" menu (D5, M7). Workspace: npm workspaces, TypeScript 6, ESLint, Vitest, a documentation link checker, and CI on Node 22 and 24.

## M1: Core

- Schema and validation, `schema/library.schema.json` generated from it.
- Template engine for `{{variables}}`, built-ins and `{{?ask}}`.
- Search with ranking (favourites, recent use, title > tags > body).
- Regenerate instructions and a checker that code blocks, paths, URLs and numbers survive.
- Merge engine implementing every row of the [merge table](google-drive-sync.md#merge-rules) for prompts, categories, variables, buttons and notes; tombstones; deterministic conflict copies.
- Migration framework (`schemaVersion` 1).

**Done when:** unit tests cover each rule; merge tests include two-device, offline and conflict scenarios; search over 1,000 prompts runs under 50 ms.

**Result (2026-11-10):** done. `packages/core` has 101 tests in 9 files (93% line, 86% branch, 100% function coverage; CI enforces minimums). The merge was mutation-checked: each of 9 deliberately broken rules makes at least one test fail. Search over 1,000 prompts averaged 0.5 ms on the development machine (target: under 50 ms). `schema/library.schema.json` is checked against the validators by tests. Design changes recorded as D17 (conflict detection by `ancestors`) and D18 (hand-written JSON Schema with agreement tests).

## M2: MCP server and CLI basics

- `ccb-mcp` over stdio with every tool listed in [platforms/codex.md](platforms/codex.md#mcp-tools-exposed-by-ccb-mcp) except `sync.*`, including notes as library records with their Markdown mirror files.
- Atomic writes, backup, lock file, revision check, starter pack on first run.
- MCP prompts for Prompt Bank entries, Continue and Regenerate.
- `ccb config`, `ccb import`, `ccb export`, `ccb doctor` (local checks).

**Done when:** contract tests pass for each tool; two server processes writing at once never lose a change.

**Result (2026-11-10):** done.
- `@ccb/store` holds the lock, crash-safe writes, backups and recovery, the device identity and the notes Markdown mirror. Edit operations live in `@ccb/core` (`ops.ts`), so the server, the CLI and later the mod share them.
- `ccb-mcp` has 21 tools, each with a contract test through a real MCP client, plus dynamic MCP prompts and a real-process start test.
- `ccb` has `config`, `export`, `import` and `doctor`.
- The multi-process test (6 processes × 40 changes) passes. The test exposed two lock races, both now fixed: 2,400 of 2,400 changes kept under an 8-process stress run (decision D21).
- Tool names changed from `bank.search` to `bank_search` style (D19).
- `doctor`'s Drive checks move to M5.

## M3: Claude mod, part 1

- Button row with built-ins (Continue, Regenerate) and user buttons. *(Notes and Prompts built-ins moved to M4, where their panes are built.)*
- `/cont` (`/continue` is built into Claude Code), `/regen` (with `undo`), `/btn <id>`.
- Regenerate source order, model call, fill or submit, undo.
- Continue truncation highlight (if the stop reason is exposed).
- *(Sync status line moved to M5: nothing to show before sync exists.)*

**Done when:** `claude plugin validate`, `tsc -p plugins/claude` and `claude plugin test plugins/claude` pass, with UI tests run on the `terminal` and `desktop` surfaces; manual check in the Claude Desktop Code tab.

**Result (2026-11-10):** done, except the hands-on check in the Claude Desktop Code tab, which needs your computer.
- The plugin `prompt-buttons` validates; its mod type-checks against Claude Code 2.1.322; 24 plugin tests pass on terminal and desktop. Breaking eight behaviours one at a time made a test fail each time.
- The independent review found 4 major issues, all fixed: command messages could be sent on the wrong turn or never; Undo never expired; the busy mark could stick; the server name was assumed. It also found 5 minor issues, fixed too.
- `ccb-mcp` gained `client_state`. It is bundled into the plugin as one file that runs on plain Node (tested from an empty folder), with a CI drift check.
- Engine rules found by validation and tests:
  - plugin names may not start with `claude-` (D23);
  - `/continue` is built in, so the command is `/cont`;
  - a slash command can't submit during its own turn, so it sends from a timer just after it returns (D24);
  - streaming hooks must be async generators.
- Marketplace `ccb` at the repository root.

## M4: Claude mod, part 2

- Prompt Bank pane: counts, search, filter, list actions, edit form, Variables and Buttons tabs, save draft, unsaved-edit protection. *(Settings tab moved to M8; sync status, **Sync now** and **Connect Google Drive** moved to M5.)*
- Notes pane: picker, multi-line editor, autosave, external-change reload. *(Per-note sync indicator moved to M5.)*
- Built-in **Prompts** and **Notes** buttons (moved here from M3).
- `/pb`, `/pb <search>`, `/pb save <title>`, `/notes`, `/notes <text>`. *(`/pb sync` moved to M5.)*

**Done when:** all M4 acceptance criteria in [features.md](features.md) have passing tests; manual check on terminal and desktop.

**Result (2026-11-10):** done, except the hands-on check on your computer.
- 35 new plugin tests (59 in all) run on terminal and desktop against an in-memory stand-in for `ccb-mcp`. It answers with the server's shapes and refuses what the server's validation refuses. Breaking six behaviours one at a time made a test fail each time, and so did undoing each review fix.
- The independent review found 5 major and 5 minor issues, all fixed:
  - autosave could overwrite a change made elsewhere before you chose Keep mine or Load theirs;
  - a failed save followed by switching notes lost the text;
  - `/notes <text>` or reopening Notes could discard a new, unsaved note;
  - new buttons could silently replace an existing one with the same ID (any non-Latin label gave `btn_untitled`);
  - Save draft could replace an open edit form.
  Saves now run one at a time, and a late save reply can't land on another note.
- The mod is now split into modules: `register.tsx` (button row and commands), `bank.tsx`, `notes.tsx`, `client.ts` (the row's data) and `mcp.ts` (server calls).
- Engine rules found by validation (D26):
  - a `$.state` atom must be declared in the file that reads or updates it;
  - `$` can't be handed to a stored callback, so modules call each other's functions directly.

## M5: Google Drive sync

Delivered in two parts: **M5a** (sync engine, both modes, sign-in, commands and tools) and **M5b** (background service and the plugin's sync interface).

- Drive API mode: `ccb login`/`logout`, keychain storage, per-device files, automatic push with outbox and retry, automatic pull with the change feed, status reporting, **Connect/Reconnect Google Drive** from the panes.
- Background sync service for Windows (per-user Run key), macOS (launchd) and Linux (systemd user service): `ccb service install|status|stop|uninstall`.
- Drive-folder fallback mode using the same per-device layout.
- Sync of prompts, categories, buttons, variables, notes and shared settings, with deterministic conflict copies and 180-day tombstones.
- `sync_now`, `sync_status`, `ccb sync`, `ccb status`; doctor checks for Drive.
- In the panes (moved from M4): sync status and **Sync now** in the Prompt Bank, a sync indicator per note, `/pb sync`, and choosing which text to keep for a conflict copy.

**Done when:** fake-Drive integration tests pass (three devices, offline note edits, simultaneous pushes, a device returning after a long absence); a manual two-computer test shows a saved prompt and an edited note on the second computer within 60 seconds with no user action, and an offline note edit arrives after reconnecting.

**M5a result (2026-11-11):** done, except the hands-on checks.
- New package `@ccb/sync`: the engine (pull, merge, push; push 2 s after a change; pull every 60 s and at start; backoff 2 s to 5 min), the Drive API remote over `fetch` with the change feed, the Drive-folder remote, PKCE sign-in, and the OS token stores (D27–D30).
- `ccb login [--client <file>] [--no-browser]`, `ccb logout`, `ccb sync`, `ccb status`; Drive checks in `ccb doctor`; `sync_now` and `sync_status` tools; `ccb-mcp` syncs while it runs and after every change; new setting `google.tokenStore`.
- Tests against an in-memory Google Drive and simulated computers:
  - three computers converging, deletions travelling, and conflict copies;
  - offline edits uploading by themselves, with backoff;
  - the push delay, the interval pull and the change feed;
  - two processes on one computer;
  - invalid device files, and two folders created at once;
  - 401 refresh, sign-out, 429/5xx, a disabled API, a deleted own file and an expired feed position;
  - the sign-in flow and the token-store commands.
- **Not verified here (needs your computers):** a real Google account; the OS credential tools (G7); that two computers see each other's files with `drive.file` (G6). The two-computer check above covers these.

**M5b result (2026-11-11):** done, except the hands-on checks.
- Background service: `ccb sync --daemon`, `ccb service install|status|stop|uninstall` (systemd user unit, launchd agent, Windows per-user Run key with a hidden VBScript launcher), offered by `ccb login`; `--home`.
- Claude Code plugin:
  - a sync button in the row;
  - a Prompt Bank sync section with **Sync now** and **Connect Google Drive** (sign-in from the pane through the new `sync_connect` tool);
  - **Keep this / Keep other / Keep both** for conflict copies (`conflict_resolve` tool, core `resolveConflict`);
  - a dot on notes not uploaded yet, and `/pb sync`;
  - a pull when a pane opens.
- The independent review of M5a found 3 critical and 4 major problems, all fixed with regression tests (undoing each fix fails its test):
  - **Critical:** a new record was lost when another computer's clock ran ahead, or when its upload raced (D31);
  - **Critical:** switching Google account could delete local data;
  - **Major:** a trashed folder or own file was never uploaded again;
  - **Major:** note-file edits weren't synced by the background engine;
  - **Major:** `ccb login` changed settings before sign-in succeeded.

  Most of the minor findings were fixed too: request timeouts, a missing Drive permission, uploads over 5 MB, the lock-timeout state, the weekly re-upload, and scrubbing the token from error messages.
- A second independent review (of M5b and the fixes) found no data-loss case in the new deletion rule. It found 4 major problems, all fixed:
  - "Keep other" when the original was already deleted left nothing; it's now refused;
  - a device's file in the oldest folder could be ignored after a duplicate-folder start; it now triggers a full listing;
  - on Windows the service couldn't be stopped, and a log-on task may need administrator rights. It's now a per-user Run value, stopped through the daemon's pid file, and the launcher is saved as UTF-16.

  Smaller fixes: systemd `%`/`$` escaping; notes first in the pending list; one Connect at a time; refreshing the row after a note is saved.
- Delivered in one pull request with M5a (D32).
- **Hands-on still needed:** the service on each OS, and Connect from the Claude Desktop Code tab.

## M6: Codex plugin

- Plugin manifest, four skills, MCP server entry.
- Generated `$ccb-<id>` skills for buttons and prompts, regenerated automatically after sync (`codex.autoSync`).

**Done when:** the plugin installs in Codex from this repository; each skill runs end to end against a local library; generated commands appear and work.

## M7: Claude Desktop Chat tab

- `desktop-extension/manifest.json` (with `prompts_generated` and the required `privacy_policies` entry), release build of `.mcpb`.
- A privacy policy page for the project, required by the MCPB manifest because the extension talks to Google Drive.

**Done when:** installing the `.mcpb` shows Prompt Bank entries in the Chat tab's "+" menu, or the limitation is documented if Claude Desktop does not show them.

## M8: Release v0.1.0

- Security review against [security-and-privacy.md](security-and-privacy.md).
- Documentation pass: remove every **planned** marker for shipped behaviour.
- Prompt Bank **Settings** tab (moved from M4). Until then, settings are changed with `ccb config`.
- `marketplace.json`, release workflow, CHANGELOG entry, tagged release with `.mcpb`.

**Done when:** a clean machine can follow the README from scratch on each platform.

## Later (not committed)

- Codex prompt-submit hook to expand `{{variables}}` typed directly.
- Sharing a category with another Google account.
- Import from other prompt managers.
