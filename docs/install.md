# Installation guide

This guide installs Claude Codex Custom Buttons v0.1.0 step by step. Install only the parts you use; each part works on its own, and they share one library when they run on the same computer.

| Part | What you get | Section |
|---|---|---|
| Claude Code plugin `prompt-buttons` | Button row, Prompt Bank, Notes and Translate panes, slash commands, instant translation. Works in the terminal, the Code tab of Claude Desktop, VS Code and mobile | [1](#1-claude-code-and-the-claude-desktop-code-tab) |
| Codex plugin `prompt-buttons-codex` | Skills: continue, regenerate-prompt, prompt-bank, notes, translate, drive-sync, plus `$ccb-*` skills for your buttons and favourite prompts | [2](#2-codex) |
| Claude Desktop extension `.mcpb` | Your saved prompts in the Chat tab, plus tools to save prompts and notes | [3](#3-claude-desktop-chat-tab) |
| The `ccb` command | Google sign-in, settings, background sync, import/export, diagnostics | [4](#4-the-ccb-command) |
| Google Drive sync | The same prompts, buttons, variables and notes on every computer | [5](#5-turn-on-google-drive-sync) |

## Before you start

- **Node.js 22.12 or newer** on every computer. Check with `node --version`; get it from [nodejs.org](https://nodejs.org/).
- **GitHub access to the repository.** It is private, so Claude Code and Codex must be able to read `bahattab/Claude-Codex-Custom-Buttons` with your GitHub account (signed in with `gh auth login`, or Git credentials that can clone it).
- **For Google Drive sync:** a Google account, and either a Google Cloud OAuth client (once, see [step 5](#5-turn-on-google-drive-sync)) or Google Drive for desktop.

Your data is kept in `~/.claude-codex-buttons/` on each computer (`C:\Users\<you>\.claude-codex-buttons\` on Windows). Every part uses that same folder.

## 1. Claude Code and the Claude Desktop Code tab

1. Open Claude Code (in a terminal: `claude`).
2. Type:

   ```bash
   /plugin install prompt-buttons --marketplace bahattab/Claude-Codex-Custom-Buttons
   ```

   This one-step form needs Claude Code 2.1.275 or later. With an older version, use the two commands instead:

   ```bash
   /plugin marketplace add bahattab/Claude-Codex-Custom-Buttons
   ```

   ```bash
   /plugin install prompt-buttons@ccb
   ```

3. Restart Claude Code (or start a new session).

**Check that it works:**

- Above the prompt box you see **Continue**, **Regenerate**, **Prompts**, **Notes** and **Translate** (and **Sync** once sync is on).
- `/pb` opens the Prompt Bank, `/notes` opens Notes, `/tr hello` translates.
- In the terminal, instant translation of selected text needs Claude Code's fullscreen mode.

The Code tab of Claude Desktop uses the same plugin: installing it once in Claude Code is enough on that computer.

**Update or remove:** `/plugin marketplace update ccb` fetches the latest version; `/plugin uninstall prompt-buttons` removes it (your data folder stays).

## 2. Codex

1. Add the marketplace and the plugin:

   ```bash
   codex plugin marketplace add bahattab/Claude-Codex-Custom-Buttons
   ```

   ```bash
   codex plugin add prompt-buttons-codex@ccb-codex
   ```

2. Check that Codex sees the server:

   ```bash
   codex mcp list
   ```

   The list shows `ccb` with the command `node ./server/ccb-mcp.mjs`.

3. Start Codex and try: "show my prompt bank", "take a note: call the bank", or "translate this to French: good morning". You can also name a skill, such as `$prompt-bank` or `$translate`.

**Generated skills:** every button that sends or fills a prompt, and every **favourite** prompt, appears as a `$ccb-<name>` skill in `~/.codex/skills`, updated automatically. Mark a prompt as a favourite to get it as a skill.

**Update or remove:** `codex plugin marketplace upgrade` then `codex plugin add prompt-buttons-codex@ccb-codex`; `codex plugin remove prompt-buttons-codex --marketplace ccb-codex` removes it.

Don't install the Claude plugin (`prompt-buttons`) into Codex: it is built for Claude Code only.

## 3. Claude Desktop (Chat tab)

1. Download **`claude-codex-buttons.mcpb`** from the [v0.1.0 release](https://github.com/bahattab/Claude-Codex-Custom-Buttons/releases/tag/v0.1.0).
2. Double-click the file, or drag it onto the Claude Desktop window, and confirm the install. (Claude Desktop shows it as unsigned.)
3. Optional: choose a **Data folder**. Leave it empty to share the usual library with Claude Code, Codex and `ccb`.

**Check that it works:** in a chat, open the **+** menu and look for your prompts and **Translate**, or ask Claude: "find my prompt about code review". If the prompts don't show in the menu, everything still works by asking Claude.

**Build it yourself instead:** `npm ci && npm run build && npm run build:plugin && npm run build:desktop` writes `dist/claude-codex-buttons.mcpb`.

## 4. The `ccb` command

You need `ccb` for the Google sign-in, the background sync service and a few settings. Pick one way:

**A. The single file from the release (recommended)**

1. Download **`ccb.mjs`** from the [v0.1.0 release](https://github.com/bahattab/Claude-Codex-Custom-Buttons/releases/tag/v0.1.0).
2. Run it with Node:

   ```bash
   node ccb.mjs doctor
   ```

3. To type just `ccb`, put it on your `PATH`.

   macOS or Linux:

   ```bash
   mkdir -p ~/.local/bin
   ```

   ```bash
   mv ccb.mjs ~/.local/bin/ccb
   ```

   ```bash
   chmod +x ~/.local/bin/ccb
   ```

   (Make sure `~/.local/bin` is on your `PATH`.)

   Windows: keep `ccb.mjs` in a lasting folder such as `C:\Tools`, and run it as `node C:\Tools\ccb.mjs ...`.

**B. From a clone of the repository**

```bash
git clone https://github.com/bahattab/Claude-Codex-Custom-Buttons.git
```

```bash
cd Claude-Codex-Custom-Buttons && npm ci && npm run build
```

Then run `node packages/cli/dist/bin.js ...`.

Keep `ccb` in a lasting place before you install the background service: the service remembers where `ccb` was when you installed it.

**Don't use `npx ccb`**: that name on npm belongs to an unrelated package.

Useful commands: `ccb --help`, `ccb doctor` (checks everything and explains problems), `ccb status`, `ccb config list`.

## 5. Turn on Google Drive sync

Sync is automatic once it's on: changes upload about 2 seconds after you make them, and other computers pick them up within a minute. Choose one of two ways.

### Option A: Google Drive API (recommended)

**Once (on any computer): create the OAuth client.** Follow [Google Cloud setup](google-cloud-setup.md): create a project, enable the Google Drive API, set up the consent screen with the `drive.file` permission only, and create an OAuth client of type **Desktop app**. Download its JSON file (`client_secret_....json`). Keep it private; don't commit it.

**On each computer:**

1. Sign in:

   ```bash
   ccb login --client /path/to/client_secret.json
   ```

   Your browser opens Google's sign-in. Allow access. The client is remembered, so on later sign-ins `ccb login` is enough.

2. Answer **Y** when asked "Keep syncing in the background?". This installs a small per-user service that starts when you log in, with no administrator rights:

   - Linux: a systemd user service;
   - macOS: a launchd agent;
   - Windows: an entry in your user's Run key.

   Without it, sync still runs whenever Claude Code, Codex or Claude Desktop is open.

3. Check:

   ```bash
   ccb status
   ```

   You should see `Sync ✓` followed by the time.

You can also sign in from Claude Code: open the Prompt Bank (**Prompts**) and press **Connect Google Drive**. In Codex or Claude Desktop, ask "connect Google Drive".

Where the sign-in is kept: the macOS Keychain, the Secret Service on Linux (needs `secret-tool`, package `libsecret-tools`), or a file encrypted for your Windows account. On a Linux machine without a desktop session, use a private file instead: `ccb config set google.tokenStore file`.

While the Google Cloud app is in **Testing** status, Google asks you to sign in again about every 7 days. Publishing the app removes this; see [Google Cloud setup](google-cloud-setup.md#publishing-status).

### Option B: a Google Drive for desktop folder (no Google Cloud setup)

If Google Drive for desktop is installed, sync through a folder inside it:

```bash
ccb config set sync.mode drive-folder
```

```bash
ccb config set sync.folderPath "/path/to/Google Drive/My Drive/Claude Codex Buttons"
```

Do the same on each computer, with that computer's path to the same Drive folder. Drive for desktop does the uploading.

## 6. Optional settings

Change settings in the Prompt Bank pane's **Settings** tab (Claude Code), by asking Claude or Codex, or with `ccb config set <key> <value>`. Common ones:

| Setting | Default | Example |
|---|---|---|
| `translate.primary` / `translate.secondary` | English / Arabic | `ccb config set translate.primary French` |
| `translate.instant` | `true` | `ccb config set translate.instant false` |
| `regenerate.autoSubmit` | `false` | `ccb config set regenerate.autoSubmit true` |
| `sync.intervalSeconds` | `60` | `ccb config set sync.intervalSeconds 120` |
| `codex.autoSync` | `true` | `ccb config set codex.autoSync false` |

Full list: [Configuration](configuration.md).

## 7. Troubleshooting

| Problem | What to do |
|---|---|
| No buttons in Claude Code | Restart Claude Code; run `/plugin` to check `prompt-buttons` is enabled; check `node --version` is 22.12 or newer |
| "ccb-mcp is not connected" | Node.js missing or too old; install Node 22.12+ and restart |
| `Sync not set up` | Do [step 5](#5-turn-on-google-drive-sync) |
| `Sync ⚠ sign in` | Run `ccb login` (or press **Reconnect Google Drive**) |
| `Sync ⚠ no credential store` | Linux: install `secret-tool`, or `ccb config set google.tokenStore file` |
| `Sync offline · N pending` | Nothing to do: changes upload by themselves when the connection returns |
| "Access blocked: app has not completed verification" | Add your Google account as a test user in the Google Cloud consent screen, or publish the app |
| `redirect_uri_mismatch` | The OAuth client must be of type **Desktop app** |
| Codex skills don't reach the tools | `codex mcp list` must show `ccb`; reinstall with `codex plugin add prompt-buttons-codex@ccb-codex` |
| Anything else | `ccb doctor` checks the data folder, sign-in, sync and service, and explains each problem |

## Uninstall

1. `ccb service uninstall`, then `ccb logout` (revokes the Google sign-in).
2. Claude Code: `/plugin uninstall prompt-buttons`. Codex: `codex plugin remove prompt-buttons-codex --marketplace ccb-codex`. Claude Desktop: remove the extension in Settings, Extensions.
3. To delete your data too: delete `~/.claude-codex-buttons/`, the `ccb-*` folders in `~/.codex/skills/`, and the `Claude Codex Buttons` folder in your Google Drive.
