# Claude Codex Custom Buttons

**Reusable buttons and productivity widgets for Claude Code, Codex and Claude Desktop, with a Prompt Bank and Notes that sync automatically through Google Drive.**

> **Status: early development (v0.0).** The design is complete and the workspace is set up (milestone M0). No installable build exists yet. Commands marked *(planned)* describe the intended interface and will work once the matching milestone in the [roadmap](docs/roadmap.md) ships.

---

## What it does

| Feature | What you get | Claude Code / Claude Desktop (Code tab) | Codex | Claude Desktop (Chat tab) |
|---|---|---|---|---|
| **Custom action buttons** | Define your own buttons once; each runs an action such as "send this prompt", "fill the prompt box" or "open a pane" | Clickable buttons in a row above the prompt box, plus `/btn <id>` | Generated skills, used as `$ccb-<id>` | Not available (no button API) |
| **Regenerate Prompt** | Takes your selected text, your draft or your last message, rewrites it into a clearer prompt and puts it back in the prompt box for review (auto-submit optional) | Button + `/regen` | `regenerate-prompt` skill | Saved prompt via the "+" menu |
| **Continue** | Sends a standard continuation message to finish a cut-off reply or workflow | Button + `/continue` (highlighted when the last reply was cut off) | `continue` skill | Saved prompt via the "+" menu |
| **Notes** | A scratchpad beside the chat that saves itself as you type and syncs through Google Drive, so you can open and edit notes from any PC | Side pane + `/notes` | `notes` skill (same synced notes) | Read/append through MCP tools |
| **Prompt Bank** | Save, categorise, edit, search and insert reusable prompts in one click | Side pane + `/pb <search>` | `prompt-bank` skill + MCP tools | Prompts appear in the "+" menu |
| **Automatic Google Drive sync** | The Prompt Bank, custom buttons, variables and Notes are saved locally and synced through your Google Drive automatically. Offline edits sync when the connection returns | Yes | Yes | Yes |

The idea is adapted from a WordPress "reusable widgets + text tokens" plugin: define something once, use it everywhere, and change it in one place. See [docs/reference-mapping.md](docs/reference-mapping.md).

## Automatic sync

You never press a sync button. After a one-time Google sign-in:

- **Every change uploads by itself** about 2 seconds after you save a prompt, edit a button or variable, or stop typing in a note.
- **Every other PC pulls changes by itself** within 60 seconds, and immediately when Claude Code or Codex starts or a pane opens.
- **Offline is fine.** Changes wait on your computer and upload by themselves when the connection returns.
- **Works even with Claude Code and Codex closed**, thanks to a small background sync service that `ccb login` sets up (you can decline it).
- **Nothing is lost.** If the same prompt or note is changed on two PCs before they sync, both versions are kept for you to merge.

Details: [docs/google-drive-sync.md](docs/google-drive-sync.md).

## How it works, in one picture

```
 Claude mod ──(MCP call)──┐
 Codex skills ──(MCP)─────┼──► ccb-mcp server ──► sync engine ──► Google Drive
 Background sync service ─┤        │                               My Drive/Claude Codex Buttons/
 ccb CLI ─────────────────┘        ▼                                 devices/<this-pc>.json
                        ~/.claude-codex-buttons/                     devices/<other-pc>.json
                          library.json   (local working copy, works offline)
                          outbox.json    (changes waiting to upload)
                          notes/*.md     (Markdown copy of each note)
```

- **One library, many tools.** Claude Code, Codex and the command-line tool all read the same library through one small MCP server, so a prompt saved in Codex shows up in Claude and the other way round.
- **Local first.** Saving never waits for the network.
- **One file per PC in Drive.** Each computer writes only its own file and reads the others, so two PCs can never overwrite each other's upload.

Full details: [architecture](docs/architecture.md) · [Drive sync](docs/google-drive-sync.md) · [data model](docs/data-model.md).

## Platform support

| Platform | How the plugin plugs in | Buttons? |
|---|---|---|
| Claude Code (terminal, VS Code, mobile) and the **Code tab of Claude Desktop** | A Claude Code plugin with a "mod" (UI hooks) and a bundled MCP server | **Yes** |
| **Codex** (CLI, app, IDE extension) | A Codex plugin with skills and the MCP server | No, skills instead |
| **Chat tab of Claude Desktop** | The MCP server packaged as a desktop extension (`.mcpb`); Prompt Bank entries appear as MCP prompts | No |

Why the difference: only Claude Code exposes an API for adding buttons and panes. Codex and the Desktop chat do not offer one, and this project does not inject code into apps. See [docs/platforms/](docs/platforms/).

## Installation *(planned)*

Requirements: Node.js 22 or newer, and a Google account for sync.

### 1. Claude Code and Claude Desktop (Code tab)

```bash
/plugin install claude-codex-buttons --marketplace bahattab/Claude-Codex-Custom-Buttons
```

The repository is private, so your GitHub account needs access to it.

### 2. Codex

```bash
codex plugin marketplace add bahattab/Claude-Codex-Custom-Buttons
```

```bash
codex plugin add claude-codex-buttons-codex@claude-codex-buttons
```

See [docs/platforms/codex.md](docs/platforms/codex.md).

### 3. Claude Desktop (Chat tab)

Download `claude-codex-buttons.mcpb` from the Releases page and open it with Claude Desktop.

### 4. Connect Google Drive (once per computer)

Open the Prompt Bank or Notes pane and press **Connect Google Drive**, or run:

```bash
npx ccb login
```

This opens a browser window to sign in to Google, then offers to keep syncing in the background. From then on sync is automatic. The plugin only asks for the `drive.file` permission, which lets it see the files it creates and nothing else in your Drive. Before the first sign-in, whoever runs the plugin needs a Google Cloud OAuth client; follow [docs/google-cloud-setup.md](docs/google-cloud-setup.md).

No Google Cloud setup? Point the library at your **Google Drive for desktop** folder instead; see [Fallback mode](docs/google-drive-sync.md#fallback-google-drive-for-desktop-folder).

## Quick start *(planned)*

| You want to | In Claude Code | In Codex |
|---|---|---|
| Finish a cut-off answer | Press **Continue** or type `/continue` | `$continue` |
| Improve a prompt | Select text (or type a draft) and press **Regenerate** or `/regen` | `$regenerate-prompt` |
| Save the current draft as a prompt | Prompt Bank pane → **Save draft** | Ask: "save this to my prompt bank" |
| Use a saved prompt | Prompt Bank pane → **Insert** or **Send**, or `/pb <search>` | `$prompt-bank` or `$ccb-<prompt>` |
| Make your own button | Prompt Bank pane → **Buttons** → **New** | Appears as a `$ccb-<id>` skill |
| Take a note | **Notes** button or `/notes` | `$notes` |
| See sync status | Status line (`Sync ✓ 12:04`) | `npx ccb status` |

### Prompt variables

Write `{{name}}` in any saved prompt. Values come from:

- **Your variables**, defined once, e.g. `{{project}}` = `Billing API`. Change a value once and every prompt using it changes.
- **Built-ins**: `{{selection}}`, `{{last_prompt}}`, `{{draft}}`, `{{date}}`, `{{cwd}}`.
- **Ask when run**: `{{?topic}}` asks you for a value each time the prompt is used.

Details: [docs/features.md](docs/features.md#prompt-variables).

## Configuration

Settings live in `~/.claude-codex-buttons/library.json` and can be changed from the Prompt Bank pane, the Claude Code plugin options menu, or `npx ccb config`. Key settings: auto-submit after Regenerate (default off), the Continue message, the sync interval (default 60 s) and the sync mode. Full list: [docs/configuration.md](docs/configuration.md).

## Privacy and security

- Your prompts and notes live in your own Google Drive and on your own computers. There is no third-party server.
- The plugin asks Google only for `drive.file`, so it cannot read your other Drive files.
- Sign-in tokens are kept in your operating system's credential store, never in the library file.
- **Regenerate** sends the text being rewritten to the model of the tool you are using (Claude in Claude Code, the Codex model in Codex). Nothing else leaves your machine except Drive sync.
- Buttons cannot run shell commands or scripts.
- Don't store passwords or API keys in prompts or notes: they would be copied to Drive.

More: [docs/security-and-privacy.md](docs/security-and-privacy.md) · [SECURITY.md](SECURITY.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/architecture.md](docs/architecture.md) | Components, data flow, repository layout |
| [docs/features.md](docs/features.md) | The five features in detail, with acceptance criteria |
| [docs/data-model.md](docs/data-model.md) | Library and Drive file formats, field rules |
| [docs/google-drive-sync.md](docs/google-drive-sync.md) | Automatic sync, merge and conflict rules, background service, fallback mode |
| [docs/google-cloud-setup.md](docs/google-cloud-setup.md) | Step-by-step Google Cloud OAuth setup |
| [docs/platforms/](docs/platforms/) | Claude Code, Claude Desktop and Codex integration details |
| [docs/configuration.md](docs/configuration.md) | Every setting, path and environment variable |
| [docs/security-and-privacy.md](docs/security-and-privacy.md) | Threat model and data handling |
| [docs/roadmap.md](docs/roadmap.md) | Milestones and the check each must pass |
| [docs/decisions.md](docs/decisions.md) | Design decisions and why they were made |
| [docs/platform-facts.md](docs/platform-facts.md) | What has been checked against primary sources and what has not |
| [docs/reference-mapping.md](docs/reference-mapping.md) | How the WordPress reference plugin maps to this project |

## FAQ

**Do I have to sync manually?** No. Sync is automatic; **Sync now** only exists to force an immediate pull.

**Can I edit my notes on another PC?** Yes. Notes sync through Google Drive like prompts. Open the Notes pane on any signed-in PC.

**Does editing a saved prompt update it everywhere?** Yes. Buttons and Codex skills point at the prompt's ID, so they use the new text after the next sync.

**Does it work offline?** Yes. Everything works from the local copy; changes upload by themselves when you reconnect.

**What if I edit the same prompt or note on two computers at once?** Both versions are kept. The older one appears as a "conflict copy" for you to merge or delete.

**Why no buttons in Codex?** Codex does not offer a way for plugins to add buttons. You get the same actions as skills.

**Can a button run a shell script?** No, by design. See [docs/security-and-privacy.md](docs/security-and-privacy.md).

## Development

```bash
npm install
npm run check      # lint, type-check, tests, documentation links
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
