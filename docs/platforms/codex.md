# Codex

Codex (CLI, desktop app and IDE extension) gets every feature except clickable buttons and side panes, through a Codex plugin. Facts below were checked against the Codex 0.167.0 release in milestone M0; see [platform-facts.md](../platform-facts.md#codex-01670) for the evidence and what still needs hands-on testing.

## How it plugs in

| Feature | Codex form |
|---|---|
| Custom buttons | Each `submit` or `fill` button becomes a generated skill, used as `$ccb-<id>`; other button types map to the matching built-in skill |
| Regenerate Prompt | `regenerate-prompt` skill |
| Continue | `continue` skill |
| Notes | `notes` skill, using `ccb-mcp` note tools on the same synced notes |
| Prompt Bank | `prompt-bank` skill + `ccb-mcp` tools; each prompt can also be generated as a `$ccb-<slug>` skill |
| Automatic Google Drive sync | `ccb-mcp`, the same server Claude Code uses, plus the background sync service |

Codex has no plugin API for buttons or panes (X7), so skills are the closest equivalent: you type `$` and pick one.

## Plugin files

```
plugins/codex/
├── .codex-plugin/plugin.json           name, version, description, skills, mcpServers, interface
├── .mcp.json                           starts ccb-mcp over stdio
└── skills/
    ├── continue/SKILL.md
    ├── regenerate-prompt/SKILL.md
    ├── prompt-bank/SKILL.md
    └── notes/SKILL.md
```

Each `SKILL.md` has front-matter `name` and `description` (what triggers it) and step-by-step instructions that call the `ccb-mcp` tools. The `interface` block gives the plugin a display name and a `defaultPrompt` for the Codex app.

The Claude and Codex plugins are separate folders. Codex also reads `.claude-plugin/plugin.json` manifests (X1), but the Claude plugin's `hooks/hooks.json` is a mod module list, not Codex hooks, so the Claude plugin must not be installed into Codex.

## Marketplace

Codex reads marketplace files from `.agents/plugins/marketplace.json` and also `.claude-plugin/marketplace.json` (X4). This repository will ship:

- `.claude-plugin/marketplace.json` listing the Claude plugin (`claude-codex-buttons`);
- `.agents/plugins/marketplace.json` listing the Codex plugin (`claude-codex-buttons-codex`).

Both marketplaces are named `claude-codex-buttons`. Which file Codex prefers when both exist is checked hands-on in M6 (X8). If Codex merges both, the Codex plugin's distinct name keeps the choice clear.

## MCP tools exposed by `ccb-mcp`

Built in M2 (`packages/mcp-server/src/server.ts`). Tool names use only letters, digits and `_`, because Claude's API rejects other characters in tool names.

| Tool | Purpose |
|---|---|
| `library_status` | Counts of prompts, categories, variables, buttons, notes and conflicts; this device's ID |
| `bank_search` | Search prompts by text, category, tag, favourite |
| `bank_get` | One prompt, optionally with `{{variables}}`, `{{?ask}}` answers and built-ins filled in; `markUsed` records use |
| `bank_save` | Create (no `id`) or update a prompt |
| `bank_delete` | Delete (tombstone) a prompt |
| `bank_list_categories` | Categories with prompt counts |
| `categories_save` / `categories_delete` | Create, rename or delete a category |
| `variables_list` / `variables_set` / `variables_delete` | Prompt variables |
| `buttons_list` / `buttons_save` / `buttons_delete` | Custom buttons (no action type can run commands) |
| `notes_list` / `notes_read` / `notes_write` / `notes_append` / `notes_delete` | Synced notes; reads pick up edits made to the Markdown files |
| `settings_set_shared` | Regenerate instructions and Continue message for every device |
| `refine_instructions` | The Regenerate instructions, or a full request for the client's own model; `ccb-mcp` never calls a model |

Planned for M5: `sync_now` and `sync_status`.

The server also offers **MCP prompts**: `ccb-continue`, `ccb-regenerate` (arguments `text`, `extra`) and one `ccb-<title>` prompt per Prompt Bank entry, whose `{{?ask}}` fields become prompt arguments. The list updates as prompts are saved.

The same tools and prompts serve Claude Code and the Claude Desktop Chat tab.

## Generated skills

Codex migrated its old custom-prompt commands into skills (X5). `ccb-mcp` therefore turns buttons and prompts into skills, not command files:

- Location: `$CODEX_HOME/skills/ccb-<id>/SKILL.md` (default `~/.codex/skills`).
- `{{?ask}}` variables become `$1`, `$2`, … and the skill's description lists them; `$ARGUMENTS` passes free text.
- Each generated `SKILL.md` carries a marker comment so `ccb` only ever rewrites or removes its own skills.
- Regeneration is automatic after every sync that changes buttons or prompts (`codex.autoSync`, default on); `npx ccb sync codex` forces it.

## Hooks

Not used in v1 (decision D5). Codex 0.167 does support hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse` and others; X6), so a later version may use `UserPromptSubmit` to expand `{{variables}}` typed directly into the Codex prompt.

## Install (planned)

```bash
codex plugin marketplace add bahattab/Claude-Codex-Custom-Buttons
```

```bash
codex plugin add claude-codex-buttons-codex@claude-codex-buttons
```

```bash
npx ccb login
```
