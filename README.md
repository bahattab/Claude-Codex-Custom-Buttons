# Claude Codex Custom Buttons

**Reusable buttons and productivity widgets for Claude Code, Codex and Claude Desktop, with a Prompt Bank that syncs through Google Drive.**

> **Status: design phase (v0.0, documentation only).** This repository currently holds the approved architecture and specification. No installable build exists yet. Commands below marked *(planned)* describe the intended interface and will work once the matching milestone in the [roadmap](docs/roadmap.md) ships.

---

## What it does

| Feature | What you get | Claude Code / Claude Desktop (Code tab) | Codex | Claude Desktop (Chat tab) |
|---|---|---|---|---|
| **Custom action buttons** | Define your own buttons once; each runs an action such as "send this prompt", "fill the prompt box" or "open a pane" | Clickable buttons in a row above the prompt box, plus `/btn <id>` | `/prompts:<id>` commands and skills | Not available (no button API) |
| **Regenerate Prompt** | Takes your selected text, your draft or your last message, rewrites it into a clearer prompt and puts it back in the prompt box for review (auto-submit optional) | Button + `/regen` | `regenerate-prompt` skill | Saved prompt via the "+" menu |
| **Continue** | Sends a standard continuation message to finish a cut-off reply or workflow | Button + `/continue` (highlighted when the last reply was cut off) | `continue` skill | Saved prompt via the "+" menu |
| **Notes** | A scratchpad beside the chat that saves itself every few seconds | Side pane + `/notes` | `notes` skill (reads/appends the same files) | Not available |
| **Prompt Bank** | Save, categorise, edit, search and insert reusable prompts in one click | Side pane + `/pb <search>` | `prompt-bank` skill + MCP tools | Prompts appear in the "+" menu |
| **Google Drive sync** | Every prompt you save is pushed to your Google Drive within seconds; every device and tool pulls the changes | Yes | Yes | Yes |

The idea is adapted from a WordPress "reusable widgets + text tokens" plugin: define something once, use it everywhere, and change it in one place. See [docs/reference-mapping.md](docs/reference-mapping.md).

## How it works, in one picture

```
 Claude mod ──(MCP call)──┐
 Codex skills ──(MCP)─────┼──► ccb-mcp server ──► sync engine ──► Google Drive
 ccb CLI ─────────────────┘        │                               My Drive/Claude Codex Buttons/
                                   ▼                                 prompt-bank.json
                        ~/.claude-codex-buttons/
                          library.json   (local working copy, works offline)
                          outbox.json    (saves waiting to upload)
                          notes/*.md     (local notes)
```

- **One library, many tools.** Claude Code, Codex and the command-line tool all read the same library through one small MCP server, so a prompt saved in Codex shows up in Claude and the other way round.
- **Local first.** Saving never waits for the network. Changes are queued and uploaded about two seconds later, or when you are back online.
- **Safe merging.** Each prompt is merged on its own; if two devices edit the same prompt at the same time, both versions are kept.

Full details: [architecture](docs/architecture.md) · [Drive sync](docs/google-drive-sync.md) · [data model](docs/data-model.md).

## Platform support

| Platform | How the plugin plugs in | Buttons? |
|---|---|---|
| Claude Code (terminal, VS Code, mobile) and the **Code tab of Claude Desktop** | A Claude Code plugin with a "mod" (UI hooks) and a bundled MCP server | **Yes** |
| **Codex** (CLI, app, IDE extension) | A Codex plugin with skills, the MCP server and generated slash commands | No, commands and skills instead |
| **Chat tab of Claude Desktop** | The MCP server packaged as a desktop extension; Prompt Bank entries appear as MCP prompts | No |

Why the difference: only Claude Code exposes an API for adding buttons and panes. Codex and the Desktop chat do not document one, and this project does not inject code into apps. See [docs/platforms/](docs/platforms/).

## Installation *(planned)*

Requirements: Node.js 20 or newer, and a Google account for Drive sync.

### 1. Claude Code and Claude Desktop (Code tab)

```bash
/plugin install claude-codex-buttons --marketplace bahattab/Claude-Codex-Custom-Buttons
```

The repository is private, so your GitHub account needs access to it.

### 2. Codex

```bash
codex plugins install bahattab/Claude-Codex-Custom-Buttons
```

The exact Codex install command is confirmed in milestone M0; see [docs/platforms/codex.md](docs/platforms/codex.md).

### 3. Claude Desktop (Chat tab)

Download `claude-codex-buttons.mcpb` from the Releases page and open it with Claude Desktop.

### 4. Connect Google Drive (once per computer)

```bash
npx ccb login
```

This opens a browser window to sign in to Google. The plugin only asks for the `drive.file` permission, which lets it see the files it creates and nothing else in your Drive. Before the first login, whoever runs the plugin needs a Google Cloud OAuth client; follow [docs/google-cloud-setup.md](docs/google-cloud-setup.md).

No Google Cloud setup? Point the library at your **Google Drive for desktop** folder instead; see [Fallback mode](docs/google-drive-sync.md#fallback-google-drive-for-desktop-folder).

## Quick start *(planned)*

| You want to | In Claude Code | In Codex |
|---|---|---|
| Finish a cut-off answer | Press **Continue** or type `/continue` | `$continue` (skill) |
| Improve a prompt | Select text (or type a draft) and press **Regenerate** or `/regen` | `$regenerate-prompt` |
| Save the current draft as a prompt | Prompt Bank pane → **Save draft** | Ask: "save this to my prompt bank" |
| Use a saved prompt | Prompt Bank pane → **Insert** or **Send**, or `/pb <search>` | `/prompts:<id>` or `$prompt-bank` |
| Make your own button | Prompt Bank pane → **Buttons** → **New** | Synced as a slash command |
| Take a note | **Notes** button or `/notes` | `$notes` |
| Check sync | Look at the status line, or `/pb sync` | `npx ccb status` |

### Prompt variables

Write `{{name}}` in any saved prompt. Values come from:

- **Your variables**, defined once, e.g. `{{project}}` = `Billing API`. Change a value once and every prompt using it changes.
- **Built-ins**: `{{selection}}`, `{{last_prompt}}`, `{{draft}}`, `{{date}}`, `{{cwd}}`.
- **Ask when run**: `{{?topic}}` asks you for a value each time the prompt is used.

Details: [docs/features.md](docs/features.md#prompt-variables).

## Configuration

Settings live in `~/.claude-codex-buttons/library.json` (`settings` block) and can be changed from the Prompt Bank pane, the Claude Code plugin options menu, or `npx ccb config`. Key settings: auto-submit after Regenerate (default off), the Continue message, the sync interval (default 60 s) and the sync mode. Full list: [docs/configuration.md](docs/configuration.md).

## Privacy and security

- Your prompts live in your own Google Drive and on your own computers. There is no third-party server.
- The plugin asks Google only for `drive.file`, so it cannot read your other Drive files.
- Sign-in tokens are kept in your operating system's credential store, never in the library file.
- **Regenerate** sends the text being rewritten to the model of the tool you are using (Claude in Claude Code, the Codex model in Codex). Nothing else leaves your machine except Drive sync.
- Buttons cannot run shell commands or scripts.
- Don't store passwords or API keys in prompts: they would be copied to Drive.

More: [docs/security-and-privacy.md](docs/security-and-privacy.md) · [SECURITY.md](SECURITY.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/architecture.md](docs/architecture.md) | Components, data flow, repository layout |
| [docs/features.md](docs/features.md) | The five features in detail, with acceptance criteria |
| [docs/data-model.md](docs/data-model.md) | `library.json` format, prompt/button/variable fields |
| [docs/google-drive-sync.md](docs/google-drive-sync.md) | Sync design, merge and conflict rules, fallback mode |
| [docs/google-cloud-setup.md](docs/google-cloud-setup.md) | Step-by-step Google Cloud OAuth setup |
| [docs/platforms/](docs/platforms/) | Claude Code, Claude Desktop and Codex integration details |
| [docs/configuration.md](docs/configuration.md) | Every setting, path and environment variable |
| [docs/security-and-privacy.md](docs/security-and-privacy.md) | Threat model and data handling |
| [docs/roadmap.md](docs/roadmap.md) | Milestones and the check each must pass |
| [docs/decisions.md](docs/decisions.md) | Design decisions and why they were made |
| [docs/platform-facts.md](docs/platform-facts.md) | What has been checked against official sources and what has not |
| [docs/reference-mapping.md](docs/reference-mapping.md) | How the WordPress reference plugin maps to this project |

## FAQ

**Does editing a saved prompt update it everywhere?** Yes. Buttons, slash commands and Codex commands all point at the prompt's ID, so they use the new text after the next sync.

**Does it work offline?** Yes. Everything works from the local copy; saves are uploaded when you reconnect.

**What if I edit the same prompt on two computers at once?** Both versions are kept. The second appears as a "conflict copy" for you to merge or delete.

**Why no buttons in Codex?** Codex does not document a way for plugins to add buttons. You get the same actions as commands and skills.

**Can a button run a shell script?** No, by design. See [docs/security-and-privacy.md](docs/security-and-privacy.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
