# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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

- Drive sync stores one file per device instead of one shared file, because Drive's update call cannot reject a stale write (decision D12).
- Codex install uses `codex plugin marketplace add` and `codex plugin add`; Codex custom commands are generated as skills (`$ccb-<id>`), since Codex migrated custom prompts into skills.
- Minimum Node.js version is 22 (Node 20 is end-of-life).
