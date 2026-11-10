# Architecture

## Goals

1. Define a button, prompt or variable **once** and use it in Claude Code, Codex and Claude Desktop.
2. Keep the Prompt Bank, buttons, variables and Notes in **Google Drive** so every PC sees the same data, synced **automatically** with no user action.
3. Work **offline**; never make the interface wait for the network.
4. Use only **documented extension points** on each platform. No code injection into desktop apps.
5. Keep platform-specific code thin; put the logic in one tested core.

## Components

```
┌──────────────────────────────────────────────────────────────────────────┐
│ packages/core  (TypeScript, no input/output, no dependencies; copied into │
│                 the Claude plugin at build time)                         │
│  schema + validation · template engine ({{variables}}) · search          │
│  refine instructions (Regenerate) · merge + sync engine · migrations     │
└───────────────▲──────────────────────▲──────────────────────▲────────────┘
                │                      │                      │
┌───────────────┴───────┐  ┌───────────┴────────────┐  ┌──────┴─────────────┐
│ plugins/claude        │  │ packages/mcp-server    │  │ packages/cli       │
│ Claude Code mod:      │  │ "ccb-mcp", stdio       │  │ "ccb"              │
│  button row, panes,   │  │  bank / notes / sync   │  │  login · sync ·    │
│  slash commands,      │  │  tools, MCP prompts,   │  │  status · config · │
│  status line          │  │  Google Drive client   │  │  import/export ·   │
│  calls ccb-mcp via    │  │  local file store      │  │  sync codex ·      │
│  $.mcp                │  │                        │  │  doctor            │
└───────────────────────┘  └───────────▲────────────┘  └────────────────────┘
                                       │
              ┌────────────────────────┼─────────────────────────┐
              │                        │                         │
   ┌──────────┴─────────┐   ┌──────────┴──────────┐   ┌──────────┴─────────┐
   │ plugins/codex      │   │ desktop-extension   │   │ Claude Code (also  │
   │ skills + MCP config│   │ .mcpb for the       │   │ via the mod above) │
   │ + generated        │   │ Claude Desktop Chat │   │                    │
   │ $ccb-<id> skills   │   │ tab                 │   │                    │
   └────────────────────┘   └─────────────────────┘   └────────────────────┘
```

| Component | Responsibility | Runs where |
|---|---|---|
| `packages/core` | All rules: data schema, validation, variable expansion, search ranking, merge, the Regenerate instructions. Pure functions, fully unit-tested. | Bundled into every other component |
| `packages/mcp-server` (`ccb-mcp`) | The **only** component that touches the library files and Google Drive. Exposes MCP tools and MCP prompts. Owns the outbox and the sync timer. | A local process started by Claude Code, Codex or Claude Desktop |
| `plugins/claude` | The Claude Code plugin: mod (UI hooks), plugin manifest, bundled MCP server entry. Draws buttons and panes and calls `ccb-mcp`. | Inside Claude Code on every surface (terminal, desktop, VS Code, mobile) |
| `plugins/codex` | The Codex plugin: skills and MCP server entry. `ccb-mcp` generates `$ccb-<id>` skills for buttons and prompts. | Inside Codex |
| `desktop-extension` | Packages `ccb-mcp` as a Claude Desktop extension (`.mcpb`) for the Chat tab. | Claude Desktop |
| `packages/cli` (`ccb`) | Google sign-in, status, config, import/export, forcing a sync or Codex skill generation, diagnostics, installing the background sync service. | User's terminal |
| Background sync service (`ccb sync --daemon`) | Keeps automatic sync running when no Claude Code or Codex session is open. Same code as `ccb-mcp`'s sync engine. | A per-user login service (Task Scheduler, launchd, systemd user) |

### Why the MCP server owns storage and sync

- **One implementation of the Drive logic.** The Claude mod API can call MCP servers, including one bundled with the plugin (`$.mcp`), and Codex and Claude Desktop use MCP natively. Putting storage behind MCP means one tested code path for all three.
- **One writer per machine.** All tools write through the same server code, which serialises writes and keeps the outbox consistent.
- **Credentials stay in one place.** Only `ccb-mcp` and `ccb login` handle Google tokens.

If several tools run at the same time, each starts its own `ccb-mcp` process. They coordinate through a lock file (`~/.claude-codex-buttons/.lock`) and the library's revision number; see [google-drive-sync.md](google-drive-sync.md#local-concurrency).

## Data flow

### Saving a prompt

1. The user presses **Save** in the Prompt Bank pane, types in a note, or a Codex skill calls `bank.save`.
2. `ccb-mcp` validates the record with `core`, stamps `updatedAt` and `updatedBy`, increments `revision`, and writes `library.json` atomically.
3. The change is added to `outbox.json`.
4. After about 2 seconds without further changes, the sync engine uploads this device's own file to Drive, automatically (see [sync](google-drive-sync.md)).
5. The status line changes from `Sync · 1 pending` to `Sync ✓`.

### Pressing Regenerate (Claude Code)

1. The mod picks the source text: current selection (`$.ui.selection()`), else the prompt-box draft, else the last user message (`$.session.messages()`).
2. It builds a request with the Regenerate instructions from `core` and calls the model (`$.model.complete`).
3. The rewritten prompt is placed in the prompt box (`$.prompt.fill`, mode `replace`) for review.
4. If `regenerate.autoSubmit` is on, it is submitted instead (`$.prompt.submit`).

### Pressing a custom button

1. The mod looks up the button by ID in the cached library.
2. It expands `{{variables}}` with `core`, asking for any `{{?ask}}` values in a small input.
3. It runs the button's action type (see [features.md](features.md#action-types)).

## Repository layout (planned)

```
.
├── README.md · LICENSE · CHANGELOG.md · CONTRIBUTING.md · SECURITY.md
├── package.json                 npm workspaces root
├── tsconfig.base.json
├── schema/
│   └── library.schema.json      JSON Schema for library.json
├── packages/
│   ├── core/                    src/{schema,template,search,refine,sync,migrate}/ + test/
│   ├── mcp-server/              src/{tools,prompts,store,notes,drive,outbox}/ + test/
│   └── cli/                     src/{commands,service}/ + test/
├── plugins/
│   ├── claude/
│   │   ├── .claude-plugin/plugin.json
│   │   ├── hooks/hooks.json
│   │   ├── hooks/register.tsx   the mod
│   │   ├── hooks/core/          copy of packages/core (generated, decision D13)
│   │   ├── types/index.d.ts     $.state contract
│   │   └── tests/*.test.tsx
│   └── codex/
│       ├── .codex-plugin/plugin.json
│       ├── .mcp.json
│       └── skills/{continue,regenerate-prompt,prompt-bank,notes}/SKILL.md
├── desktop-extension/
│   └── manifest.json
├── .claude-plugin/
│   └── marketplace.json         Claude Code marketplace (lists the Claude plugin)
├── .agents/plugins/
│   └── marketplace.json         Codex marketplace (lists the Codex plugin)
├── scripts/check-links.mjs      documentation link checker
├── docs/
└── .github/workflows/ci.yml
```

## Technology choices

| Need | Choice | Reason |
|---|---|---|
| Language | TypeScript 6.0 | Required by the Claude mod API; pinned below 7 until `typescript-eslint` supports 7 (decision D16) |
| Runtime | Node.js 22 or newer | Node 20 is end-of-life; Vitest 5 needs 22.12+ (decision D15) |
| Packaging | npm workspaces; a build step copies `core` into the Claude plugin | A mod can import only its own plugin's files (fact C15, decision D13) |
| Tests | Vitest for packages; `claude plugin test` for the mod | The mod's own test kit exercises real surfaces |
| MCP | `@modelcontextprotocol/sdk`, `zod` for tool input schemas | Standard SDK |
| Google Drive | `@googleapis/drive`, `google-auth-library` | Official client libraries, Drive-only package keeps size down |
| Credential storage | `@napi-rs/keyring` | Maintained OS keychain binding (`keytar` is archived) |

Exact versions are pinned when the packages are created (M0/M1).

## Quality gates

Every milestone must pass the checks listed in [roadmap.md](roadmap.md). Across the project:

- `core` has unit tests for every rule, including two-device sync and conflict scenarios.
- The mod passes `claude plugin validate`, `tsc` and `claude plugin test` on both `terminal` and `desktop` surfaces.
- The MCP server has contract tests per tool and an integration test against a fake Drive.
- CI runs lint, type-check and tests on every pull request.
