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
| `packages/store` (`@ccb/store`) | All file access: the lock, crash-safe writes, backups and recovery, device identity, the notes Markdown mirror. Every change goes through `LibraryStore.update`, which re-reads the latest file under the lock. | Inside `ccb-mcp`, `ccb` and the background sync service |
| `packages/sync` (`@ccb/sync`) | The sync engine (pull, merge, push, timers, backoff, status), the Drive API and Drive-folder remotes, Google sign-in and the token stores. | Inside `ccb-mcp`, `ccb` and the background sync service |
| `packages/mcp-server` (`ccb-mcp`) | Exposes MCP tools and MCP prompts over stdio, using `@ccb/store`, and runs `@ccb/sync`'s engine while it is open (the only long-running component that talks to Google Drive). | A local process started by Claude Code, Codex or Claude Desktop |
| `plugins/claude` | The Claude Code plugin: mod (UI hooks), plugin manifest, bundled MCP server entry. Draws buttons and panes and calls `ccb-mcp`. | Inside Claude Code on every surface (terminal, desktop, VS Code, mobile) |
| `plugins/codex` | The Codex plugin: skills and MCP server entry. `ccb-mcp` generates `$ccb-<id>` skills for buttons and prompts. | Inside Codex |
| `desktop-extension` | Packages `ccb-mcp` as a Claude Desktop extension (`.mcpb`) for the Chat tab. | Claude Desktop |
| `packages/cli` (`ccb`) | Google sign-in, status, config, import/export, forcing a sync or Codex skill generation, diagnostics, installing the background sync service. | User's terminal |
| Background sync service (`ccb sync --daemon`) | Keeps automatic sync running when no Claude Code or Codex session is open. Same code as `ccb-mcp`'s sync engine. | A per-user login service (Windows Run key, launchd, systemd user) |

### Why storage and sync sit behind the MCP server

- **One implementation of the Drive logic.** The Claude mod API can call MCP servers, including one bundled with the plugin (`$.mcp`), and Codex and Claude Desktop use MCP natively. Putting storage behind MCP means one tested code path for all three.
- **One writer per machine.** All tools write through the same store, which serialises writes; syncing takes its own lock so processes take turns.
- **Credentials stay in one place.** Only `ccb-mcp` and `ccb login` handle Google tokens.

If several tools run at the same time, each starts its own `ccb-mcp` process. They coordinate through a lock file (`~/.claude-codex-buttons/.lock`) and the library's revision number; see [google-drive-sync.md](google-drive-sync.md#local-concurrency).

## Data flow

### Saving a prompt

1. The user presses **Save** in the Prompt Bank pane, types in a note, or a Codex skill calls `bank_save`.
2. `ccb-mcp` validates the record with `core`, stamps `updatedAt` and `updatedBy`, increments `revision`, and writes `library.json` atomically.
3. The change now counts as pending (it differs from what was last uploaded).
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
│   ├── store/                   lock, atomic writes, backups, notes mirror
│   ├── sync/                    engine, drive, folder, google sign-in, token stores
│   ├── mcp-server/              tools and prompts + test/
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
| Google Drive and sign-in | A small client over Node's built-in `fetch` (`packages/sync/src/drive.ts`, `google.ts`) | The bundled plugin server must run on plain Node; a few documented endpoints need no library (decision D28) |
| Credential storage | The OS's own tools: `security`, `secret-tool`, PowerShell DPAPI | No native module, which a single bundled file can't carry (decision D27) |

Exact versions are pinned when the packages are created (M0/M1).

## Quality gates

Every milestone must pass the checks listed in [roadmap.md](roadmap.md). Across the project:

- `core` has unit tests for every rule, including two-device sync and conflict scenarios.
- The mod passes `claude plugin validate`, `tsc` and `claude plugin test` on both `terminal` and `desktop` surfaces.
- The MCP server has contract tests per tool and an integration test against a fake Drive.
- CI runs lint, type-check and tests on every pull request.
