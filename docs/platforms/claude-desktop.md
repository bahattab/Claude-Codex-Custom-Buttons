# Claude Desktop

Claude Desktop has two places this project reaches, in different ways.

| Area | Integration | Buttons and panes |
|---|---|---|
| **Code tab** | The Claude Code plugin; see [claude-code.md](claude-code.md) | Yes |
| **Chat tab** | The `ccb-mcp` server packaged as a desktop extension (`.mcpb`) | No |

## Chat tab: what you get

- **Prompt Bank entries as MCP prompts.** Each saved prompt appears in the chat's "+" menu (where MCP prompts are listed) and inserts its text. Prompts with `{{?ask}}` variables become prompt arguments.
- **Continue** and **Regenerate my prompt** as MCP prompts.
- **MCP tools** so you can ask Claude in chat to "save this as a prompt", "find my prompt about code review", or "add a note".
- **Google Drive sync**, the same as everywhere else, because the same server runs.

## Chat tab: what you don't get

- No button row, panes or slash commands. The Chat tab has no documented API for adding them.
- No access to selected text or the prompt box. Regenerate there works by inserting the rewrite instructions; you paste or type your text after them.

This project deliberately does **not** inject scripts into the Electron app to add buttons: such injection breaks with each app update and may conflict with the app's terms.

## Packaging

```
desktop-extension/
└── manifest.json      name, version, description, server entry (node packages/mcp-server/dist/index.js),
                       user configuration fields (sync mode, Drive folder path)
```

The release workflow builds `claude-codex-buttons.mcpb` and attaches it to each GitHub release. Users install it by opening the file with Claude Desktop.

How Claude Desktop presents MCP prompts in the Chat tab, and the exact `.mcpb` manifest fields, are confirmed in milestone M7; see [platform-facts.md](../platform-facts.md).

## Sign-in

Run `npx ccb login` once on the computer; the extension's server uses the same token from the OS credential store.
