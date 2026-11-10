# Roadmap

Each milestone delivers something usable and ends with checks that must pass before the next one starts. Status values: **Planned**, **Active**, **Blocked**, **Verified**, **Done**.

| # | Milestone | Status | Depends on |
|---|---|---|---|
| M0 | Confirm platform facts, scaffold the repository, CI | **Done** (2026-11-10) | — |
| M1 | `core`: schema, validation, variables, search, Regenerate instructions, merge engine | Planned | M0 |
| M2 | `ccb-mcp` server with local storage (prompts, buttons, variables, notes), plus `ccb` basics | Planned | M1 |
| M3 | Claude mod, part 1: button row, Continue, Regenerate, slash commands | Planned | M2 |
| M4 | Claude mod, part 2: Prompt Bank pane, Notes pane, button editor | Planned | M3 |
| M5 | Automatic Google Drive sync: per-device files, Drive API and Drive-folder modes, `ccb login`, background sync service | Planned | M2 |
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

## M2: MCP server and CLI basics

- `ccb-mcp` over stdio with every tool listed in [platforms/codex.md](platforms/codex.md#mcp-tools-exposed-by-ccb-mcp) except `sync.*`, including notes as library records with their Markdown mirror files.
- Atomic writes, backup, lock file, revision check, starter pack on first run.
- MCP prompts for Prompt Bank entries, Continue and Regenerate.
- `ccb config`, `ccb import`, `ccb export`, `ccb doctor` (local checks).

**Done when:** contract tests pass for each tool; two server processes writing at once never lose a change.

## M3: Claude mod, part 1

- Button row with built-ins (Continue, Regenerate, Notes, Prompts) and user buttons.
- `/continue`, `/regen` (with `undo`), `/btn <id>`.
- Regenerate source order, model call, fill or submit, undo.
- Continue truncation highlight (if the stop reason is exposed).
- Status line placeholder for sync.

**Done when:** `claude plugin validate`, `tsc -p plugins/claude` and `claude plugin test plugins/claude` pass, with UI tests run on the `terminal` and `desktop` surfaces; manual check in the Claude Desktop Code tab.

## M4: Claude mod, part 2

- Prompt Bank pane: home, search, filter, list actions, edit form, Variables, Buttons, Settings tabs, save draft, unsaved-edit protection.
- Notes pane: picker, multi-line editor, autosave, external-change reload.
- `/pb`, `/notes`.

**Done when:** all M4 acceptance criteria in [features.md](features.md) have passing tests; manual check on terminal and desktop.

## M5: Google Drive sync

- Drive API mode: `ccb login`/`logout`, keychain storage, per-device files, automatic push with outbox and retry, automatic pull with the change feed, status reporting, **Connect/Reconnect Google Drive** from the panes.
- Background sync service for Windows (Task Scheduler), macOS (launchd) and Linux (systemd user service): `ccb service status|stop|uninstall`.
- Drive-folder fallback mode using the same per-device layout.
- Sync of prompts, categories, buttons, variables, notes and shared settings, with deterministic conflict copies and 180-day tombstones.
- `sync.now`, `sync.status`, `ccb sync`, `ccb status`; doctor checks for Drive.

**Done when:** fake-Drive integration tests pass (three devices, offline note edits, simultaneous pushes, a device returning after a long absence); a manual two-computer test shows a saved prompt and an edited note on the second computer within 60 seconds with no user action, and an offline note edit arrives after reconnecting.

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
- `marketplace.json`, release workflow, CHANGELOG entry, tagged release with `.mcpb`.

**Done when:** a clean machine can follow the README from scratch on each platform.

## Later (not committed)

- Codex prompt-submit hook to expand `{{variables}}` typed directly.
- Sharing a category with another Google account.
- Import from other prompt managers.
