# Claude Code and the Claude Desktop Code tab

The richest integration. One Claude Code plugin works on every surface where Claude Code runs: the terminal, the **Code tab of Claude Desktop**, the VS Code extension and mobile. Each surface draws the same elements in its own style.

## How it plugs in

The plugin contains a **mod**: a TypeScript hooks module that Claude Code loads and that can add interface elements and react to events. Every capability below was checked against the mod API type definitions of Claude Code build 2.1.322 (see [platform-facts.md](../platform-facts.md)).

| Need | Mod API used |
|---|---|
| Button row above the prompt box | `ui.render` hook on the `AbovePrompt` site, drawing `Button` elements |
| Prompt Bank and Notes side panes | `$.ui.open({ id, title })` + `ui.render` hook on `Pane` |
| Text boxes, search box, multi-line note editor | `Input` element (`rows` for multiple lines, `placeholder`, `onInput`, `onSubmit`) |
| Category filter | `Select` element |
| Slash commands `/continue`, `/regen`, `/notes`, `/pb`, `/btn` | `$.command.register` in `session.start`, answered by `command.run` (receives `args`) |
| Selected text for Regenerate | `$.ui.selection()` |
| Prompt-box draft | `$.prompt` read (text and cursor) |
| Last user message, stop reason | `$.session.messages()` |
| Put text in the prompt box | `$.prompt.fill` (modes `replace`, `append`, `insert`) |
| Send a message | `$.prompt.submit({ text })` (waits until the session is idle) |
| Rewrite a prompt | `$.model.complete` |
| Talk to the storage/sync server | `$.mcp` (calls the MCP server bundled in this plugin's manifest) |
| Pane state, drafts, "unsaved" flag | `$.state` atoms, declared in `types/index.d.ts` |
| Small cache that survives restarts | `$.store` |
| Sync status | `$.ui.status(text)` |
| Confirmations | `$.ui.toast(text)` |
| Copy to clipboard | `$.ui.copy({ text })` |
| Autosave and sync timers | `$.clock` |
| Which surface is drawing | `e.surface`: `terminal`, `desktop`, `vscode`, `mobile` |

## Plugin files

```
plugins/claude/
├── .claude-plugin/plugin.json     name, version, description, "types", userConfig options, MCP server entry
├── hooks/hooks.json               { "modules": ["./register.tsx"] }
├── hooks/register.tsx             the mod: export const register: Register = (on, options) => { ... }
├── types/index.d.ts               interface PluginState: the $.state values the mod uses
└── tests/*.test.tsx               run with `claude plugin test plugins/claude`
```

Repository root also has `.claude-plugin/marketplace.json` so Claude Code can install straight from GitHub:

```bash
/plugin install claude-codex-buttons --marketplace bahattab/Claude-Codex-Custom-Buttons
```

## Surface differences

| Surface | Notes |
|---|---|
| Terminal | Buttons drawn as keyboard-selectable items; panes open beside the transcript where the terminal has room |
| Claude Desktop (Code tab) | Full mouse interaction; panes seat in the app's side panel |
| VS Code | Same elements in the extension's panel |
| Mobile | Compact drawing; the button row may collapse into an overflow menu |

Tests run every UI scenario on at least the `terminal` and `desktop` surfaces.

## Development loop

```bash
claude plugin validate plugins/claude     # checks manifest and hooks the engine will accept
tsc -p plugins/claude                     # type-check against the generated API types
claude plugin test plugins/claude         # runs tests/*.test.tsx against the engine
claude --plugin-dir plugins/claude        # load the plugin locally; edits hot-reload
```

## Cloud sessions

Claude Code sessions running in the cloud (claude.ai/code) have no OS credential store, so Drive API sync can't keep a token there. Options:

1. Work locally only in that session (`sync.mode = "off"`); or
2. use the **Claude Google Drive connector** if connected: the mod can call it through `$.mcp` with the engine's own credentials. This path is Claude-only and is planned as an optional adapter, not the main sync path.

## Limitations

- The plugin only changes what Claude Code itself draws. It does not modify the regular Chat tab of Claude Desktop; see [claude-desktop.md](claude-desktop.md).
- The truncation highlight on **Continue** depends on the conversation data exposing why a reply stopped; confirmed in milestone M3.
