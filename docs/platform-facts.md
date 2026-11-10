# Platform facts ledger

Every platform statement the design depends on, with its evidence. Code must not depend on an **Unconfirmed** fact. **Changed** means the check found something different from the original plan and the docs were updated to match.

Last updated: 2026-11-10 (milestone M0).

## How M0 checked things

- **Claude Code:** the mod API type definitions (`claude-code.d.ts`) and authoring reference shipped with Claude Code **2.1.322**.
- **Codex:** OpenAI's documentation site (developers.openai.com) cannot be reached from the build environment, and the `openai/codex` repository's `docs/` files now only link there. The evidence is the **official Codex 0.167.0 Linux release from npm** (`@openai/codex@0.167.0-linux-x64`, published 2026-11-10). It was not run. Its text was searched for file names, command usage lines and schema identifiers. This proves an identifier exists in the shipped program, not its full behaviour, so behaviour is still checked hands-on in M6.
- **Google Drive:** Google's machine-readable **Drive v3 API definition** (discovery document, revision 20261106) and the official `google-auth-library-nodejs` README. Google's policy and help pages were unreachable.
- **MCPB:** the official `modelcontextprotocol/mcpb` repository's README and MANIFEST spec.

## Claude Code mod API

| # | Fact | Status | Evidence |
|---|---|---|---|
| C1 | A plugin can contain a mod: `.claude-plugin/plugin.json`, `hooks/hooks.json` listing a module, `hooks/register.tsx` exporting `register` | Confirmed | Authoring reference |
| C2 | Surfaces: `terminal`, `desktop`, `vscode`, `mobile`; elements come from `$.ui.resolve(e)` | Confirmed | Types |
| C3 | A band above the prompt box: `ui.render` on `AbovePrompt`; side panes: `$.ui.open` + `ui.render` on `Pane` | Confirmed | Authoring reference |
| C4 | Elements include `Box`, `Text`, `Button`, `Input` (`rows`, `placeholder`), `Select`, `Link`, `Code`, `Markdown` | Confirmed | Types |
| C5 | Slash commands: `$.command.register`, answered by `command.run`; input has `args` | Confirmed | Types |
| C6 | `$.ui.selection()` returns the last mouse selection (undefined where a surface has none) | Confirmed | Types |
| C7 | `$.prompt.submit({ text })` submits once the session is idle; `$.prompt.fill` with `replace`, `append`, `insert`; the prompt box can be read | Confirmed | Types |
| C8 | `$.session.messages()` returns the conversation | Confirmed | Types |
| C9 | `$.model.complete` makes a model call | Confirmed | Types |
| C10 | `$.mcp.call` calls a connected MCP server; a plugin can connect MCP servers its own manifest lists | Confirmed | Types |
| C11 | `$.fs` (absolute paths, 4 MiB read limit), `$.store`, `$.state`, `$.clock`, `$.http.fetch` | Confirmed | Types |
| C12 | `$.ui.status`, `$.ui.toast`, `$.ui.copy` | Confirmed | Types |
| C13 | `claude plugin validate`, `claude plugin test`, `--plugin-dir` hot reload; `/plugin install <name> --marketplace <owner>/<repo>` with `.claude-plugin/marketplace.json` | Confirmed | Authoring reference |
| C14 | The mod has no DOM or Node APIs; everything outside goes through `$` | Confirmed | Authoring reference |
| C15 | A mod can import **its own plugin's files** with `import` declarations (`.ts`, `.tsx`, `.js`, …, all ES modules). Dynamic `import()` is refused, and there is no way to import npm packages | **Confirmed** | Authoring reference. Consequence: `core` is copied into the Claude plugin at build time (decision D13) |
| C16 | The `turn.step` event reports `stopReason`, which includes `max_tokens` | **Confirmed** | Types; exercised by the plugin test for the Continue highlight. The hook must be an async generator because the event streams |
| C17 | Plugin names starting with `claude-`, `anthropic-` (and similar) are reserved | **Confirmed** | `claude plugin validate` error |
| C18 | `/continue` is a built-in command; `$.command.register` refuses built-in names | **Confirmed** | `claude plugin validate` warning |
| C19 | A plugin finds its own MCP server's name with `$.mcp.connect("<key in plugin.json>")`, which returns `{ isConnected, server }`; `server` is the name `$.mcp.call` takes | **Confirmed** | Types 2.1.322 (`McpConnectResult`); the plugin uses it instead of assuming `plugin:<plugin>:<server>` |
| C20 | `$.prompt.submit` is refused inside a `command.run` hook. A submit from a `$.clock.after` timer after the hook returns is accepted by the test kit | **Confirmed** (refusal) / **Unconfirmed** (timer path in a real session, hands-on) | Engine message in `claude plugin test`; plugin tests |
| C21 | Plugins declare MCP servers inline in `plugin.json` (`mcpServers`) or in `.mcp.json`, with `${CLAUDE_PLUGIN_ROOT}`; Claude Code starts them when the plugin is enabled | **Confirmed** | code.claude.com plugins reference and MCP docs |
| C22 | One-step install `/plugin install <plugin> --marketplace <owner/repo>` needs Claude Code 2.1.275+; otherwise `/plugin marketplace add` then `/plugin install <plugin>@<marketplace>` | **Confirmed** | code.claude.com install docs; `claude plugin validate .` |
| C23 | A `$.state` atom must be declared in the module that reads or updates it; `$` may not be passed to a stored callback, only to functions called directly | **Confirmed** | `claude plugin validate` errors (M4) |
| C24 | A plugin opens its own side pane with `$.ui.open({ id, title, focus })` and draws it in a `ui.render` hook on `Pane` for that `requestId`; `Input` with `rows` is a multi-line editor raising `onInput` per edit and `onSubmit` on Enter | **Confirmed** | Types 2.1.322; plugin tests on terminal and desktop |

## Codex (0.167.0)

| # | Fact | Status | Evidence |
|---|---|---|---|
| X1 | Codex reads plugin manifests from `.codex-plugin/plugin.json`, and also from `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, or a root `plugin.json` declaring the Agent Plugins `$schema` `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` | **Confirmed** | Manifest paths and schema URL in the release |
| X2 | Plugins can bundle `skills`, `mcpServers` (also a `.mcp.json` file; stdio or streamable HTTP), `hooks` (`hooks/hooks.json`), apps (`.app.json`), and an `interface` block (`displayName`, `defaultPrompt`, `brandColor`) | **Confirmed** (keys present) | Manifest structure names in the release |
| X3 | Install flow: `codex plugin marketplace add owner/repo [--ref <ref>] [--sparse <path>]` (or a local path), then `codex plugin add <plugin>@<marketplace>`; also `codex plugin list [--available] [--json]`, `codex plugin remove`, `codex plugin marketplace upgrade` | **Changed** (was `codex plugins install`) | Usage lines in the release |
| X4 | Marketplace manifests are read from `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json` and `.cursor-plugin/marketplace.json` | **Confirmed** | Paths in the release |
| X5 | The old custom-prompt commands (`~/.codex/prompts/`, `/prompts:<name>`) have been migrated into **skills**. Skills accept `$ARGUMENTS`, `$ARGUMENTS[N]` and `$N`. User skills live in `$CODEX_HOME/skills/<name>/` (default `~/.codex/skills`) and are invoked by mentioning them (`$name`) | **Changed** | No `.codex/prompts` strings; "migrated-command-skills"/command-migration identifiers; skills installer and argument help text in the release |
| X6 | Hooks exist with events including `SessionStart`, `UserPromptSubmit` and `PreToolUse`; plugins can bundle hooks; admins can restrict to managed hooks | **Confirmed** (behaviour untested) | Hook schemas in the release; `docs/config.md` in `openai/codex` |
| X7 | No API for plugins to add buttons or panes | Unchanged (nothing found) | No such identifiers found; `interface.defaultPrompt` is plugin metadata, not a button |
| X8 | Which marketplace file Codex prefers when a repository has both `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json` | **Unconfirmed** (M6) | — |
| X9 | Node.js requirement | Confirmed: the npm launcher declares Node ≥ 16; the program itself is native | npm metadata |

## Google Drive and OAuth

| # | Fact | Status | Evidence |
|---|---|---|---|
| G1 | `drive.file`: "See, edit, create, and delete only the specific Google Drive files you use with this app" | **Confirmed** | Drive v3 discovery document. Its classification as a non-sensitive, recommended scope comes from Google's Drive auth page via search results ([Drive API: about auth](https://developers.google.com/drive/about-auth)) |
| G2 | External apps in "Testing" status get refresh tokens that expire after about 7 days; publishing removes this | **Unconfirmed** | Community reports agree ([rclone forum](https://forum.rclone.org/t/google-drive-requires-manual-refresh-every-7-days/29023), [n8n community](https://community.n8n.io/t/can-one-use-google-sheets-longer-than-7-days-in-test-mode-without-manual-reconnecting/275424), [Nango](https://nango.dev/docs/integrations/all/google-drive)); Google's policy page unreachable. The design copes either way: an expired token shows **Reconnect Google Drive** and queued changes upload afterwards |
| G3 | Files have a `version` that "increases monotonically … reflects every change made to the file on the server", but `files.update` has **no conditional (only-if-unchanged) parameter** | **Changed** | Drive v3 discovery document. Consequence: one file per device (decision D12) |
| G4 | Change feed: `changes.getStartPageToken`, `changes.list` (also `changes.watch`, which needs a public HTTPS endpoint and is not used) | **Confirmed** | Drive v3 discovery document |
| G5 | Desktop OAuth with a local loopback redirect (`http://localhost:<port>`), `access_type: 'offline'` to get a refresh token, `prompt: 'consent'` to force a new one | **Confirmed** | `google-auth-library-nodejs` README |

## Claude Desktop

| # | Fact | Status | Evidence |
|---|---|---|---|
| D1 | Claude for macOS and Windows installs MCP Bundles (`.mcpb`): a zip with a local MCP server and `manifest.json` (`manifest_version` 0.3/0.4, `server`, `user_config`, `compatibility`, `privacy_policies`) | **Confirmed** | MCPB README and MANIFEST spec |
| D2 | A bundle can declare static `prompts` and set `prompts_generated: true` when the server generates prompts at run time | **Confirmed** | MCPB MANIFEST spec |
| D3 | `privacy_policies` is required when the extension connects to external services that process user data, which includes Google Drive | **Confirmed** | MCPB MANIFEST spec. Consequence: a privacy policy page is needed before M7 |
| D4 | Node.js ships with Claude Desktop, so a Node MCP server needs no separate install | **Confirmed** | MCPB README |
| D5 | MCP prompts appear in the Chat tab's "+" menu | **Unconfirmed** (M7, hands-on) | — |
| D6 | Mods do not run in the Chat tab | Inferred | Mods are a Claude Code feature (C2 lists Claude Code surfaces) |
