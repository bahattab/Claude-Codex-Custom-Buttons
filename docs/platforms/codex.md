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

| Tool | Purpose |
|---|---|
| `bank.search` | Search prompts by text, category, tag, favourite |
| `bank.get` | Get one prompt, optionally with variables expanded |
| `bank.save` | Create or update a prompt |
| `bank.delete` | Delete (tombstone) a prompt |
| `bank.list_categories` | List categories with counts |
| `variables.list` / `variables.set` | Read and change prompt variables |
| `buttons.list` | List buttons and their actions |
| `notes.list` / `notes.read` / `notes.write` / `notes.append` / `notes.delete` | Synced notes |
| `sync.now` / `sync.status` | Force a pull, inspect sync status |
| `refine.instructions` | Return the Regenerate instructions, so the client model can rewrite text itself |

The same tools serve Claude Code and the Claude Desktop Chat tab.

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
