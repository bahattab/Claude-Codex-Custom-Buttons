# Claude Desktop

Claude Desktop has two places this project reaches, in different ways.

| Area | Integration | Buttons and panes |
|---|---|---|
| **Code tab** | The Claude Code plugin; see [claude-code.md](claude-code.md) | Yes |
| **Chat tab** | The `ccb-mcp` server packaged as a desktop extension (`.mcpb`) | No |

## Chat tab: what you get

- **Prompt Bank entries as MCP prompts.** Each saved prompt appears in the chat's "+" menu (where MCP prompts are listed) and inserts its text. Prompts with `{{?ask}}` variables become prompt arguments.
- **Continue** and **Regenerate my prompt** as MCP prompts.
- **MCP tools** so you can ask Claude in chat to "save this as a prompt", "find my prompt about code review", or "add to my release checklist note".
- **Automatic Google Drive sync**, the same as everywhere else, because the same server runs. Notes and prompts edited on another PC are available here.

## Chat tab: what you don't get

- No button row, panes or slash commands. The Chat tab has no documented API for adding them.
- No access to selected text or the prompt box. Regenerate there works by inserting the rewrite instructions; you paste or type your text after them.

This project deliberately does **not** inject scripts into the Electron app to add buttons: such injection breaks with each app update and may conflict with the app's terms.

## Install

1. Download `claude-codex-buttons.mcpb` from the repository's Releases page, or build it yourself with `npm ci && npm run build && npm run build:plugin && npm run build:desktop`. The build writes `dist/claude-codex-buttons.mcpb`.
2. Open the file with Claude Desktop (double-click, or drag it onto the window) and confirm the install.
3. Optional: choose a **Data folder**. Leave it empty to share the usual library (`~/.claude-codex-buttons`) with Claude Code, Codex and `ccb`.
4. To sync with your other computers, connect Google Drive once: ask Claude in the chat to "connect Google Drive" (the `sync_connect` tool), or run `ccb login`.

## Packaging

```
desktop-extension/
├── manifest.json      MCPB manifest_version 0.4: the server entry (Node, runs ccb-mcp), the tool list,
│                      prompts_generated: true (Prompt Bank entries become prompts at run time),
│                      user_config (optional data folder), privacy_policies, compatibility
├── icon.png           512×512 icon
└── .mcpbignore
```

`npm run build:desktop` stages these files with the bundled `ccb-mcp` from the Claude plugin, validates the manifest, and packs `dist/claude-codex-buttons.mcpb` (about 215 KB) with the official `mcpb` tool. CI runs the same build on every pull request.

- The bundle isn't signed yet (`mcpb sign` needs a certificate); Claude Desktop shows it as unsigned.
- The privacy policy the manifest links to is [privacy-policy.md](../privacy-policy.md).
- The manifest asks for Node.js 22.12 or newer. Claude Desktop runs extensions with the Node.js it ships (D4). Whether that version is new enough, and whether the Chat tab's "+" menu lists the generated prompts (D5), are checked hands-on; see [platform-facts.md](../platform-facts.md#claude-desktop).
- If the optional data folder is left empty, the server uses the usual folder even if Claude Desktop passes the setting's placeholder through unfilled.

## Sign-in

Run `ccb login` once on the computer, or ask Claude in the chat to connect Google Drive. The extension's server finds the same sign-in in the OS credential store.
