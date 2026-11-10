# Contributing

Thanks for helping. The project is in its design phase; implementation follows the [roadmap](docs/roadmap.md).

## Before you start

- Read [docs/architecture.md](docs/architecture.md) and the [design decisions](docs/decisions.md).
- If your change depends on a platform behaviour, check [docs/platform-facts.md](docs/platform-facts.md). Don't build on an **Unconfirmed** fact; confirm it first and update the ledger with the source.
- Open an issue for anything larger than a small fix so the approach can be agreed first.

## Development setup

```bash
git clone https://github.com/bahattab/Claude-Codex-Custom-Buttons
cd Claude-Codex-Custom-Buttons
npm install             # Node.js 22.12 or newer
npm run check           # everything below, in order
npm run lint
npm run typecheck
npm test
npm run check:links     # documentation links and anchors
npm run coverage        # tests with a coverage report and minimum thresholds
```

Claude mod checks *(from M3)*:

```bash
claude plugin validate plugins/claude
tsc -p plugins/claude
claude plugin test plugins/claude
```

Use `CCB_HOME=$(mktemp -d)` to run against a throwaway library instead of your real one.

## Rules

- **Logic goes in `packages/core`.** Platform code (mod, MCP server, CLI, Codex skills) stays thin. Core has no dependencies and no file, network or clock access: pass time, randomness and data in.
- **Write `\uXXXX` escapes for invisible characters** in source; a test fails on literal ones.
- **Only `ccb-mcp` touches the library files and Google Drive.**
- **Tests with every change:** a failing test first for bug fixes; UI tests on both `terminal` and `desktop` surfaces for mod changes.
- **No code-running button actions** (decision D11).
- **Never log prompt or note text.**
- **Never commit secrets** or `client_secret*.json`.
- Keep changes focused; don't refactor unrelated code in the same pull request.
- Update the docs in the same pull request when behaviour changes, and add a line to [CHANGELOG.md](CHANGELOG.md) under *Unreleased*.

## Pull requests

- Branch from `main`; one topic per branch.
- Describe what changed, why, and how it was tested.
- CI (lint, type-check, tests) must pass.

## Commit messages

Short imperative summary line (`Add prompt search ranking`), blank line, then details if needed.
