# Platform facts ledger

Every platform statement the design depends on, with its evidence. Code must not depend on an **Unconfirmed** fact until it is moved to **Confirmed** (or **Changed**, with the docs updated). Milestone M0 works through this list.

Last updated: 2026-11-10.

## Claude Code mod API

Source: the mod API type definitions (`claude-code.d.ts`) and authoring reference shipped with Claude Code build 2.1.322, read on 2026-11-10.

| # | Fact | Status |
|---|---|---|
| C1 | A plugin can contain a mod: `.claude-plugin/plugin.json`, `hooks/hooks.json` listing a module, `hooks/register.tsx` exporting `register` | Confirmed |
| C2 | Surfaces: `terminal`, `desktop`, `vscode`, `mobile`; elements come from `$.ui.resolve(e)` | Confirmed |
| C3 | A band above the prompt box: `ui.render` on `AbovePrompt`; side panes: `$.ui.open` + `ui.render` on `Pane` | Confirmed |
| C4 | Elements include `Box`, `Text`, `Button`, `Input` (with `rows`, `placeholder`), `Select`, `Link`, `Code`, `Markdown` | Confirmed |
| C5 | Slash commands: `$.command.register`, answered by `command.run`, input includes `args` | Confirmed |
| C6 | `$.ui.selection()` returns the last mouse selection (or undefined where a surface has none) | Confirmed |
| C7 | `$.prompt.submit({ text })` submits a prompt as a turn once the session is idle; `$.prompt.fill` with modes `replace`, `append`, `insert`; the prompt box can be read | Confirmed |
| C8 | `$.session.messages()` returns the conversation | Confirmed |
| C9 | `$.model.complete` makes a model call | Confirmed |
| C10 | `$.mcp.call` calls a connected MCP server, and a plugin can connect MCP servers its own manifest lists | Confirmed |
| C11 | `$.fs` reads/writes files by absolute path (read limit 4 MiB); `$.store` persists across sessions; `$.state` atoms per session; `$.clock` timers; `$.http.fetch` through the host | Confirmed |
| C12 | `$.ui.status`, `$.ui.toast`, `$.ui.copy` | Confirmed |
| C13 | `claude plugin validate`, `claude plugin test`, `--plugin-dir` hot reload; `/plugin install <name> --marketplace <owner>/<repo>` with `.claude-plugin/marketplace.json` | Confirmed |
| C14 | The mod module has no DOM or Node APIs; everything outside goes through `$` | Confirmed |
| C15 | Whether a mod can import other local files or must be a single module | **Unconfirmed** (M0) |
| C16 | Whether the conversation data exposes a reply's stop reason (for the Continue highlight) | **Unconfirmed** (M3) |

## Codex

Source: third-party articles from 2026 (listed below). OpenAI's documentation site could not be reached from the environment used to write this.

| # | Fact | Status |
|---|---|---|
| X1 | Codex supports plugins with a manifest at `.codex-plugin/plugin.json` | **Unconfirmed** |
| X2 | Plugins can bundle skills, MCP servers, apps and hooks | **Unconfirmed** |
| X3 | Plugins install from the CLI (`/plugins`, `codex plugins install …`) and from marketplaces | **Unconfirmed** |
| X4 | Hooks exist but were behind a feature flag (April 2026); bundled hooks reported later | **Unconfirmed** |
| X5 | Custom slash commands in `~/.codex/prompts/<name>.md`, invoked as `/prompts:<name>`, with `$ARGUMENTS` | **Unconfirmed**, possibly superseded by skills |
| X6 | No documented API for plugins to add buttons or panes | **Unconfirmed** (absence of evidence) |
| X7 | Minimum Node.js version | **Unconfirmed** |

Secondary sources: [The New Stack: OpenAI's Codex gets plugins](https://thenewstack.io/openais-codex-gets-plugins/) · [Building a Codex CLI plugin](https://codex.danielvaughan.com/2026/04/10/building-codex-cli-plugin) · [Codex plugin marketplace and bundled hooks](https://codex.danielvaughan.com/2026/05/08/codex-cli-plugin-marketplace-remote-install-workspace-sharing-bundled-hooks/) · [Agent Plugins 1.0](https://codex.danielvaughan.com/2026/08/28/agent-plugins-1-0-open-standard-codex-cli-v0147-multi-vendor-portable-skills-mcp/) · [OpenAI Apps SDK: plugins](https://developers.openai.com/apps-sdk/build/plugins/)

## Google Drive and OAuth

| # | Fact | Status |
|---|---|---|
| G1 | `drive.file` gives per-file access to files the app creates or the user opens with it, and is a non-sensitive, recommended scope | Confirmed by Google's Drive auth page in search results ([Drive API: about auth](https://developers.google.com/drive/about-auth)); recheck wording in M0 |
| G2 | External apps in "Testing" status get refresh tokens that expire after about 7 days; publishing removes this | **Unconfirmed**: multiple community reports agree ([rclone forum](https://forum.rclone.org/t/google-drive-requires-manual-refresh-every-7-days/29023), [n8n community](https://community.n8n.io/t/can-one-use-google-sheets-longer-than-7-days-in-test-mode-without-manual-reconnecting/275424), [Nango](https://nango.dev/docs/integrations/all/google-drive)); confirm on Google's policy page |
| G3 | Drive file metadata has a version number usable to detect changes before upload; whether conditional updates are supported | **Unconfirmed** (M0) |
| G4 | Drive change feed (`changes.list` with a start page token) for cheap polling | **Unconfirmed** (M0) |
| G5 | Installed-app OAuth with a loopback redirect for desktop clients | **Unconfirmed** (M0) |

## Claude Desktop Chat tab

| # | Fact | Status |
|---|---|---|
| D1 | Desktop extensions (`.mcpb`) install local MCP servers | **Unconfirmed** (M7) |
| D2 | MCP prompts appear in the Chat tab's "+" menu | **Unconfirmed** (M7) |
| D3 | Mods do not run in the Chat tab | Inferred: mods are a Claude Code feature (C2 lists Claude Code surfaces) |
