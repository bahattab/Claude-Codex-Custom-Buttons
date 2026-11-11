# Codex

Codex (CLI, desktop app and IDE extension) gets every feature except clickable buttons and side panes, through a Codex plugin. Facts below were checked against the Codex 0.167.0 release in milestone M0 and, in M6, by installing the plugin with Codex 0.167.1 and reading the Codex source; see [platform-facts.md](../platform-facts.md#codex-01670) for the evidence and what still needs hands-on testing.

## How it plugs in

| Feature | Codex form |
|---|---|
| Custom buttons | Each `submit` or `fill` button becomes a generated skill, used as `$ccb-<name>`; other button types map to the matching built-in skill |
| Regenerate Prompt | `regenerate-prompt` skill |
| Translate | `translate` skill |
| Continue | `continue` skill |
| Notes | `notes` skill, using `ccb-mcp` note tools on the same synced notes |
| Prompt Bank | `prompt-bank` skill + `ccb-mcp` tools; each prompt can also be generated as a `$ccb-<slug>` skill |
| Automatic Google Drive sync | `ccb-mcp`, the same server Claude Code uses, plus the background sync service |

Codex has no plugin API for buttons or panes (X7), so skills are the closest equivalent: you type `$` and pick one.

## Plugin files

```
plugins/codex/
├── .codex-plugin/plugin.json           name, version, description, skills, mcpServers, interface
├── .mcp.json                           starts ccb-mcp over stdio: node ./server/ccb-mcp.mjs
├── server/ccb-mcp.mjs                  GENERATED: the same bundled server as the Claude plugin
└── skills/
    ├── continue/SKILL.md
    ├── regenerate-prompt/SKILL.md
    ├── prompt-bank/SKILL.md
    ├── notes/SKILL.md
    ├── drive-sync/SKILL.md             sync status, Sync now, Connect Google Drive, conflicts
    └── translate/SKILL.md              translate text with the session's model
```

`.mcp.json` sets `"cwd": "."`: Codex resolves it against the plugin folder, so `./server/ccb-mcp.mjs` is found. Without it, Codex would start the server in your project's folder and it would fail (X10, found by the M6 review). `env_vars` passes `CODEX_HOME` and `CCB_HOME` through, because Codex hands a plugin server only a few environment variables. Codex lists plugin skills under the plugin's name, for example `prompt-buttons-codex:continue`; mention one with `$` or let Codex pick it from its description (X11).

Each `SKILL.md` has front-matter `name` and `description` (what triggers it) and step-by-step instructions that call the `ccb-mcp` tools. The `interface` block gives the plugin a display name and a `defaultPrompt` for the Codex app.

The Claude and Codex plugins are separate folders. Codex also reads `.claude-plugin/plugin.json` manifests (X1), but the Claude plugin's `hooks/hooks.json` is a mod module list, not Codex hooks, so the Claude plugin must not be installed into Codex.

## Marketplace

Codex reads marketplace files from `.agents/plugins/marketplace.json` and also `.claude-plugin/marketplace.json` (X4). This repository will ship:

- `.claude-plugin/marketplace.json`: marketplace `ccb`, listing the Claude plugin `prompt-buttons` (exists since M3);
- `.agents/plugins/marketplace.json`: marketplace `ccb-codex`, listing the Codex plugin `prompt-buttons-codex` (M6).

Names starting with `claude-` are reserved by Claude Code (decision D23), so neither uses one. With both files present, Codex 0.167.1 uses `.agents/plugins/marketplace.json`: `codex plugin marketplace add` on this repository adds the marketplace `ccb-codex` (X8, confirmed in M6).

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
| `translate_instructions` | The request for translating text with the client's own model, following the translate settings |
| `sync_status` / `sync_now` | Google Drive sync status (pending changes, conflicts, other devices), and an immediate sync; sync runs by itself |
| `sync_connect` | Start the one-time Google sign-in from the chat (opens the browser) |
| `conflict_resolve` | Settle a conflict copy: keep the original, the copy, or both |

The server also offers **MCP prompts**: `ccb-continue`, `ccb-regenerate` (arguments `text`, `extra`) and one `ccb-<title>` prompt per Prompt Bank entry, whose `{{?ask}}` fields become prompt arguments. The list updates as prompts are saved.

The same tools and prompts serve Claude Code and the Claude Desktop Chat tab.

## Generated skills

Codex migrated its old custom-prompt commands into skills (X5). `ccb-mcp` therefore turns buttons and prompts into skills, not command files:

- **Which:** one skill per `submit` or `fill` button, then one per **favourite** prompt (decision D34). Mark a prompt as a favourite to get it as a skill.
- **Location:** `$CODEX_HOME/skills/ccb-<name>/SKILL.md` (default `~/.codex/skills`). The name comes from the button ID (`btn_standup` → `ccb-standup`) or the prompt's title. A name already taken, or one of the plugin's own skill names, gets a short suffix from the ID.
- **Variables:** `{{variables}}` are filled in. Each `{{?ask}}` field becomes `<value 1: name>`, `<value 2: name>` …, which the model fills from what you write after the skill's name; the description lists them with any defaults. (Codex doesn't substitute `$1` or `$ARGUMENTS` in skills, X5.) Built-ins Codex can't know, such as `{{selection}}` and `{{date}}`, are described to the model instead, for example "(today's date)".
- **Safety:** each generated `SKILL.md` carries a marker and the library it came from, so only those files are rewritten or removed, and two libraries on one computer leave each other's skills alone. Removing a skill deletes only its `SKILL.md` (and the folder when it's then empty). A skill of your own with the same name is left alone.
- **Updates:** while the Codex plugin is installed, `ccb-mcp` rewrites them shortly after a change made through it, and after a sync that brings changes (`codex.autoSync`, default on); so does the background service. Edits made with `ccb import` show up at the next of those, or at once with `ccb sync codex`.

## Hooks

Not used in v1 (decision D5). Codex 0.167 does support hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse` and others; X6), so a later version may use `UserPromptSubmit` to expand `{{variables}}` typed directly into the Codex prompt.

## Install

Checked with Codex 0.167.1 (M6):

```bash
codex plugin marketplace add bahattab/Claude-Codex-Custom-Buttons
```

```bash
codex plugin add prompt-buttons-codex@ccb-codex
```

```bash
codex mcp list
```

`codex mcp list` should show the server `ccb` (`node ./server/ccb-mcp.mjs`). Node.js 22 or newer must be installed, because the plugin's server runs on it. To sync through Google Drive, run `npx ccb login` once (see [the sync guide](../google-drive-sync.md)).

Don't install the Claude plugin (`prompt-buttons`) into Codex: its `hooks/hooks.json` is a Claude Code mod module list, not Codex hooks.
