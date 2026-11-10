# Claude Code and the Claude Desktop Code tab

The richest integration. One Claude Code plugin, **`prompt-buttons`**, works on every surface where Claude Code runs: the terminal, the **Code tab of Claude Desktop**, the VS Code extension and mobile. Each surface draws the same elements in its own style.

> The plugin can't be called `claude-codex-buttons`: Claude Code reserves plugin names that start with `claude-` for Anthropic's own plugins (decision D23).

## Install

```bash
/plugin install prompt-buttons --marketplace bahattab/Claude-Codex-Custom-Buttons
```

This one-step form needs Claude Code 2.1.275 or later. With an older version, add the marketplace first (`/plugin marketplace add bahattab/Claude-Codex-Custom-Buttons`), then `/plugin install prompt-buttons@ccb`. The repository is private, so your GitHub account needs access to it.

Requirements: Node.js 22 or newer on the computer, which runs the bundled `ccb-mcp` server.

## What it adds (milestone M3)

| Element | What it does |
|---|---|
| **Button row** above the prompt box | **Continue**, **Regenerate**, then your custom buttons in order; buttons beyond `buttons.maxVisible` go into a **More** list. Hidden while Claude Code shows a survey there |
| **Continue** | Sends the Continue message (yours if set, else the built-in one). Shows **Continue (cut off)**, highlighted, when the last reply stopped at the output limit |
| **Regenerate** | Rewrites your selected text, else your draft, else your last message, using your session's model. The result goes in the prompt box for review, or is sent if `regenerate.autoSubmit` is on. **Undo regenerate** appears for 30 seconds. Warns if the rewrite dropped code, file paths, URLs or numbers |
| **Custom buttons** | `submit`: send a saved prompt or text, with `{{variables}}` filled in. `fill`: put it in the prompt box (replace, append or insert). `refine`/`continue`: as above. Buttons whose prompt was deleted are dimmed and explain why when pressed. If a prompt has an unanswered `{{?ask}}` field, it's placed in the prompt box for you to complete instead of being sent |
| `/cont` | Continue. (`/continue` is a built-in Claude Code command, so the plugin can't use that name.) |
| `/regen [instruction]` | Regenerate, with an optional extra instruction such as `/regen make it shorter` |
| `/regen undo` | Put back the text from before the last Regenerate |
| `/btn <id>` | Run a custom button by its ID; `/btn` alone lists them |

The **Notes** and **Prompts** buttons and their panes arrive in M4. Until then, `insert-prompt` and `open-pane` buttons explain that they're coming. The sync status line arrives with sync in M5.

### Why slash commands send after their turn

Claude Code refuses `$.prompt.submit` from inside a slash command's hook, because the command holds the turn the submit would wait for. So `/cont`, `/btn` and `/regen` with auto-submit queue the message, and the plugin sends it when that turn completes, normally right away. Buttons aren't inside a turn, so they send at once. (Decision D24.)

## How it plugs in

The plugin contains a **mod**: a TypeScript hooks module Claude Code loads, which can add interface elements and react to events. Every API below was checked against the mod API type definitions of Claude Code 2.1.322 and exercised by the plugin's tests.

| Need | Mod API used |
|---|---|
| Button row above the prompt box | `ui.render` hook on `AbovePrompt`, drawing `Button` and `Select` |
| Slash commands | `$.command.register` in `session.start`, answered by `command.run` hooks (input `args`) |
| Selected text, draft, last message | `$.ui.selection()`, `$.prompt.read()`, `$.session.messages()` |
| Put text in the prompt box / send it | `$.prompt.fill({ text, mode })` / `$.prompt.submit({ text })` |
| Rewrite a prompt | `$.model.complete` with `$.session.model()` |
| "Reply was cut off" | `turn.step` hook (an async generator, since the event streams) reading `stopReason === "max_tokens"` |
| Data: buttons, prompts, variables, settings | `$.mcp.call("plugin:prompt-buttons:ccb", tool, args)` to the bundled server |
| Session state (buttons, highlight, Undo, busy) | `$.state` atoms declared in `types/index.d.ts` |
| Messages | `$.ui.toast` |
| Undo expiry | `$.clock.after` |

## Plugin files

```
plugins/claude/
├── .claude-plugin/plugin.json   name, version, description, types, MCP server "ccb"
├── hooks/hooks.json             { "modules": ["./register.tsx"] }
├── hooks/register.tsx           the mod
├── hooks/core/                  GENERATED: copy of packages/core (a mod can import only its own files)
├── server/ccb-mcp.mjs           GENERATED: ccb-mcp and its dependencies in one file, run with plain Node
├── types/index.d.ts             the $.state contract
└── test/buttons.test.tsx        run with `claude plugin test plugins/claude`
```

The generated files are committed, because an installed plugin gets no `npm install`. `npm run build:plugin` regenerates them, and CI's `npm run check:plugin` fails if they're out of date. The repository root's `.claude-plugin/marketplace.json` (marketplace `ccb`) lists the plugin.

The plugin's `plugin.json` declares the server:

```json
"mcpServers": { "ccb": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/server/ccb-mcp.mjs"] } }
```

Claude Code starts it when the plugin is enabled, and the mod reaches it as `plugin:prompt-buttons:ccb`. That name follows how Claude Code lists plugin servers; it is still to be confirmed in a live session (platform-facts C19). If the server can't be reached, the row still shows Continue and Regenerate with built-in defaults.

## Development loop

```bash
npm run build && npm run build:plugin     # compile packages, regenerate plugin files
claude plugin validate plugins/claude     # manifest and hooks as the engine reads them
claude plugin test plugins/claude         # 20 tests against the engine's test kit
claude plugin validate .                  # the marketplace
claude --plugin-dir plugins/claude        # load locally; edits hot-reload
```

## Cloud sessions

Claude Code sessions in the cloud (claude.ai/code) have no OS credential store, so Drive API sync can't keep a token there. Options:

1. work locally only in that session (`sync.mode = "off"`); or
2. use the **Claude Google Drive connector** if connected: the mod can call it through `$.mcp` with the engine's own credentials. This path is Claude-only and planned as an optional adapter, not the main sync path.

## Limitations

- The plugin only changes what Claude Code itself draws. It doesn't modify the regular Chat tab of Claude Desktop; see [claude-desktop.md](claude-desktop.md).
- A mod can't import npm packages or files outside its plugin folder, so all shared logic lives in the dependency-free `core`, copied in at build time (decision D13).
- The plugin's tests run on the engine's test kit, which stands in for Claude Code. A hands-on check in the Claude Desktop Code tab is still needed (roadmap M3).
