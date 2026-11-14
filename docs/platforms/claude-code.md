# Claude Code and the Claude Desktop Code tab

The richest integration. One Claude Code plugin, **`prompt-buttons`**, works on every surface where Claude Code runs: the terminal, the **Code tab of Claude Desktop**, the VS Code extension and mobile. Each surface draws the same elements in its own style.

> The plugin can't be called `claude-codex-buttons`: Claude Code reserves plugin names that start with `claude-` for Anthropic's own plugins (decision D23).

## Install

```bash
/plugin install prompt-buttons --marketplace bahattab/Claude-Codex-Custom-Buttons
```

This one-step form needs Claude Code 2.1.275 or later. With an older version, add the marketplace first (`/plugin marketplace add bahattab/Claude-Codex-Custom-Buttons`), then `/plugin install prompt-buttons@ccb`. The repository is public, so no GitHub sign-in is needed. For cloud sessions, see [Cloud sessions](#cloud-sessions).

Requirements: Node.js 22 or newer on the computer, which runs the bundled `ccb-mcp` server.

## What it adds (milestones M3 and M4)

| Element | What it does |
|---|---|
| **Button row** above the prompt box | **Continue**, **Regenerate**, **Prompts**, **Notes**, then your custom buttons in order; buttons beyond `buttons.maxVisible` go into a **More** list. Hidden while Claude Code shows a survey there |
| **Continue** | Sends the Continue message (yours if set, else the built-in one). Shows **Continue (cut off)**, highlighted, when the last reply stopped at the output limit |
| **Regenerate** | Rewrites your selected text, else your draft, else your last message, using your session's model. The result goes in the prompt box for review, or is sent if `regenerate.autoSubmit` is on. **Undo regenerate** appears for 30 seconds. Warns if the rewrite dropped code, file paths, URLs or numbers |
| **Custom buttons** | `submit`: send a saved prompt or text, with `{{variables}}` filled in. `fill`: put it in the prompt box (replace, append or insert). `refine`/`continue`: as above. Buttons whose prompt was deleted are dimmed and explain why when pressed. If a prompt has an unanswered `{{?ask}}` field, it's placed in the prompt box for you to complete instead of being sent |
| `/c` | Continue. (`/continue` is a built-in Claude Code command, so the plugin can't use that name.) |
| `/regen [instruction]` | Regenerate, with an optional extra instruction such as `/regen make it shorter` |
| `/regen undo` | Put back the text from before the last Regenerate |
| `/btn <id>` | Run a custom button by its ID; `/btn` alone lists them |
| **Prompt Bank** pane (**Prompts** button, `/pb`) | Search while typing, category filter, favourites only. Each prompt: **Insert**, **Send**, **Copy**, **Edit**, **Duplicate**, **Delete** (asks first, with **Undo delete**). **New** and **Save draft** open an edit form whose text survives closing the pane. **Variables** tab: set, add and delete `{{variables}}`. **Buttons** tab: make a button of any action type, or delete one; the row updates at once |
| **Notes** pane (**Notes** button, `/notes`) | Note picker (pinned first), multi-line editor that saves on its own after `notes.autosaveMs`, **New**, **Rename**, **Pin**, **Copy**, **Insert into prompt**, **Delete** (asks first). If the note changed elsewhere while you have unsaved text, choose **Keep mine** or **Load theirs** |
| `/pb <search>`, `/pb save <title>` | Open the Prompt Bank searching; save the prompt box's text as a prompt |
| `/notes <text>` | Add the text to the open note, or start a new note |

| **Sync** button in the row | `Sync ✓ 12:04`, `Sync · 2 pending`, `Sync offline · 2 pending`, `Sync ⚠ sign in`, `Sync ⚠ 1 conflict`. Pressing it syncs now, or opens the Prompt Bank when something needs your attention there. Hidden when sync is off |
| Prompt Bank sync section | The status and what's wrong. **Sync now**, and **Connect Google Drive** (or **Reconnect**) when signed out: it opens Google's sign-in in your browser and shows a link to it; sync starts once you finish. A conflict copy shows **Keep this**, **Keep other** and **Keep both** |
| Notes sync | A dot marks notes changed here and not uploaded yet. A conflict copy shows the same three choices |
| `/pb sync` | Sync now and say how it went |
| **Instant translation** | Select text and its translation appears above the prompt box (from the language detected into English, or into Arabic when it's already English; see `translate.*` settings), with Copy, Insert, Open in Translate and Close |
| **Translate** button, `/t [to <language>:] [text]` | The Translate pane: pick a language, Translate, Swap, Copy, Insert into prompt, Replace prompt, recent translations |

`insert-prompt` buttons open the Prompt Bank on their search or category; `open-pane` buttons open either pane. Opening either pane pulls other computers' changes at once. The Prompt Bank's **Settings** tab changes every setting.

### How slash commands send their message

Claude Code refuses `$.prompt.submit` from inside a slash command's hook, because the command holds the turn the submit would wait for. So `/c`, `/btn` and `/regen` with auto-submit:

1. queue the message;
2. send it from a timer just after the command returns;
3. if that send is refused, try again when the main conversation's next turn completes. Subagents' turns and turns you stopped don't count.

Several queued messages go out in order. Buttons aren't inside a turn, so they send at once. (Decision D24.)

## How it plugs in

The plugin contains a **mod**: a TypeScript hooks module Claude Code loads, which can add interface elements and react to events. Every API below was checked against the mod API type definitions of Claude Code 2.1.322 and exercised by the plugin's tests.

| Need | Mod API used |
|---|---|
| Button row above the prompt box | `ui.render` hook on `AbovePrompt`, drawing `Button` and `Select` |
| Prompt Bank and Notes panes | `$.ui.open({ id, title, focus })`, then a `ui.render` hook on `Pane` for that `requestId`, drawing `Input` (one-line and multi-line), `Select`, `Button` and `Text` |
| Copy | `$.ui.copy({ text, surface })` |
| Slash commands | `$.command.register` in `session.start`, answered by `command.run` hooks (input `args`) |
| Selected text, draft, last message | `$.ui.selection()`, `$.prompt.read()`, `$.session.messages()` |
| Put text in the prompt box / send it | `$.prompt.fill({ text, mode })` / `$.prompt.submit({ text })` |
| Rewrite a prompt | `$.model.complete` with `$.session.model()` |
| "Reply was cut off" | `turn.step` hook (an async generator, since the event streams) reading `stopReason === "max_tokens"` |
| Data: buttons, prompts, variables, settings | `$.mcp.connect("ccb")` (the server's key in `plugin.json`) returns the name `$.mcp.call` takes; then `$.mcp.call(name, tool, args)` |
| Session state (buttons, highlight, Undo, busy) | `$.state` atoms declared in `types/index.d.ts` |
| Messages | `$.ui.toast` |
| Undo expiry, sending after a command, note autosave, search pause | `$.clock.after` |

## Plugin files

```
plugins/claude/
├── .claude-plugin/plugin.json   name, version, description, types, MCP server "ccb"
├── hooks/hooks.json             { "modules": ["./register.tsx"] }
├── hooks/register.tsx           the mod's entry: button row, commands, turn hooks
├── hooks/bank.tsx               Prompt Bank pane
├── hooks/notes.tsx              Notes pane
├── hooks/client.ts              the row's buttons, variables and settings
├── hooks/mcp.ts                 calls to ccb-mcp
├── hooks/core/                  GENERATED: copy of packages/core (a mod can import only its own files)
├── server/ccb-mcp.mjs           GENERATED: ccb-mcp and its dependencies in one file, run with plain Node
├── types/index.d.ts             the $.state contract
├── test/buttons.test.tsx        button row and commands
└── test/panes.test.tsx          Prompt Bank and Notes panes, against an in-memory ccb-mcp
```

The generated files are committed, because an installed plugin gets no `npm install`. `npm run build:plugin` regenerates them, and CI's `npm run check:plugin` fails if they're out of date. The repository root's `.claude-plugin/marketplace.json` (marketplace `ccb`) lists the plugin.

The plugin's `plugin.json` declares the server:

```json
"mcpServers": { "ccb": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/server/ccb-mcp.mjs"] } }
```

Claude Code starts it when the plugin is enabled. The mod asks `$.mcp.connect("ccb")` for the server's name rather than assuming one. If the server can't be reached, the row still shows Continue and Regenerate with built-in defaults, and your buttons appear once it connects.

## Development loop

```bash
npm run build && npm run build:plugin     # compile packages, regenerate plugin files
claude plugin validate plugins/claude     # manifest and hooks as the engine reads them
claude plugin test plugins/claude         # 78 tests against the engine's test kit
claude plugin validate .                  # the marketplace
claude --plugin-dir plugins/claude        # load locally; edits hot-reload
```

## Cloud sessions

**Installing.** A cloud session starts on a fresh computer, so install the plugin from the cloud environment's setup script: see [Install: cloud sessions](../install.md#cloud-sessions). The Claude app doesn't show the button row for a cloud session (checked 2026-11-12), so the plugin also has `/prompt-buttons:<skill>` commands (`continue`, `regenerate-prompt`, `button`, `prompt-bank`, `notes`, `translate`, `drive-sync`) that do the same jobs in any session. They are the Codex plugin's skills, copied in by `npm run build:plugin`.

**Sync.** Claude Code sessions in the cloud (claude.ai/code) have no OS credential store, so Drive API sync can't keep a token there. Options:

1. work locally only in that session (`sync.mode = "off"`); or
2. use the **Claude Google Drive connector** if connected: the mod can call it through `$.mcp` with the engine's own credentials. This path is Claude-only and planned as an optional adapter, not the main sync path.

## Limitations

- The plugin only changes what Claude Code itself draws. It doesn't modify the regular Chat tab of Claude Desktop; see [claude-desktop.md](claude-desktop.md).
- A mod can't import npm packages or files outside its plugin folder, so all shared logic lives in the dependency-free `core`, copied in at build time (decision D13).
- Each `$.state` atom must be declared in the file that uses it, and `$` can't be passed to a stored callback (decision D26).
- The plugin's tests run on the engine's test kit, which stands in for Claude Code. A hands-on check in the terminal and the Claude Desktop Code tab is still needed (roadmap M3 and M4).
