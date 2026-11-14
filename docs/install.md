# Installation guide

This guide installs Claude Codex Custom Buttons v0.1.0 step by step. Install only the parts you use; each part works on its own, and they share one library when they run on the same computer.

| Part | What you get | Section |
|---|---|---|
| Claude Code plugin `prompt-buttons` | Button row, Prompt Bank, Notes and Translate panes, slash commands, instant translation. Works in the terminal, the Code tab of Claude Desktop, VS Code and mobile | [1](#1-claude-code-and-the-claude-desktop-code-tab) |
| Codex plugin `prompt-buttons-codex` | Skills: continue, regenerate-prompt, prompt-bank, notes, translate, drive-sync, button, plus `$ccb-*` skills for your buttons and favourite prompts | [2](#2-codex) |
| Chrome extension | A button row above the prompt box on claude.ai in Chrome, Edge or Brave, including cloud sessions at claude.ai/code | [Chrome extension](#chrome-extension-claudeai-in-the-browser) |
| Claude Desktop extension `.mcpb` | Your saved prompts in the Chat tab, plus tools to save prompts and notes | [3](#3-claude-desktop-chat-tab) |
| The `ccb` command | Google sign-in, settings, background sync, import/export, diagnostics | [4](#4-the-ccb-command) |
| Google Drive sync | The same prompts, buttons, variables and notes on every computer | [5](#5-turn-on-google-drive-sync) |

## Before you start

- **Node.js 22.12 or newer** on every computer. Check with `node --version`; get it from [nodejs.org](https://nodejs.org/).
- **Nothing for GitHub.** The repository is public, so no GitHub account or sign-in is needed to install.
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
- `/pb` opens the Prompt Bank, `/n` opens Notes, `/t hello` translates.
- In the terminal, instant translation of selected text needs Claude Code's fullscreen mode.

The Code tab of Claude Desktop uses the same plugin: installing it once in Claude Code is enough on that computer.

**Update or remove:** `/plugin marketplace update ccb` fetches the latest version; `/plugin uninstall prompt-buttons` removes it (your data folder stays).

### Cloud sessions

Cloud sessions (claude.ai/code, and the **Cloud** sessions in Claude Desktop) start on a fresh computer every time, so a plugin installed on your own computer isn't there. Install it from the cloud environment's **setup script**, which runs at the start of every new session:

1. Open a cloud session, click the environment name in the session's title bar, then **Edit**.
2. Add these lines at the end of **Setup script**:

   ```bash
   claude plugin marketplace add bahattab/Claude-Codex-Custom-Buttons || true
   claude plugin install prompt-buttons@ccb || true
   rm -rf /opt/ccb
   git clone -q --depth 1 https://github.com/bahattab/Claude-Codex-Custom-Buttons /opt/ccb || true
   ```

3. Under **Environment variables**, add:

   ```
   CLAUDE_CODE_PLUGIN_DIRS=/opt/ccb/plugins/claude
   ```

4. Save, then start a **new** cloud session (an open session doesn't run the script again). Send a first message; the plugin's commands appear once the session has started.

The first two lines install the plugin: its skills (`/prompt-buttons:...`) and its MCP server. A cloud session doesn't load the commands of an installed plugin's mod (`/c`, `/t`, `/pb` and the others); it loads them from a plugin folder named in `CLAUDE_CODE_PLUGIN_DIRS`, which the `git clone` line downloads. Claude can add the script lines for you but not the variable: you add that yourself. `|| true` keeps a session starting even if a step fails.

What works in a cloud session:

- **Works:** the `/` commands below, and the Prompt Bank, Notes, Translate and settings by asking Claude ("show my prompt bank", "translate this to English").
- **Doesn't show:** the button row above the prompt box, or any of the plugin's panes. In a cloud session the Claude desktop app draws only the plugin's text: command output and the status line (checked 2026-11-14: a row above the prompt box, a pane, buttons in a command's output and buttons under a reply all stayed hidden).
- **Shows:** a line in the status bar, under the prompt box, naming the short commands: `Buttons: /c · /r · /t · /pb · /n · /btn`.

The short commands run straight away, without Claude reading instructions first, and answer in text where a pane would open on your computer:

| Command | Does what the button does |
|---|---|
| `/c` | **Continue** the last answer |
| `/r [extra instruction]` | **Regenerate**: rewrite your draft into a clearer prompt; `/r undo` puts it back |
| `/t [to <language>:] [text]` | **Translate** the text, your draft or your last message; the translation is the command's answer |
| `/pb [search]` | **Prompts**: a numbered list of your prompts; `/pb use 2` puts number 2 in the prompt box, `/pb send 2` sends it, `/pb save <title>` saves the prompt box |
| `/n [read <n> \| text]` | **Notes**: a numbered list; `/n read 1` shows one; `/n <text>` adds to a note |
| `/btn [name]` | Press one of your own buttons by its name; with no name, lists them |

These longer commands do the same through Claude, and also work in local sessions:

| Command | Does what the button does |
|---|---|
| `/prompt-buttons:continue` | **Continue** the last answer |
| `/prompt-buttons:regenerate-prompt [text]` | **Regenerate**: rewrite a prompt (yours, or your last message) and offer to send it |
| `/prompt-buttons:button <label> [extra input]` | Press one of your custom buttons; with no label, lists them |
| `/prompt-buttons:prompt-bank [search]` | **Prompts**: find, run or save a prompt |
| `/prompt-buttons:notes [text]` | **Notes**: show notes, or take a note |
| `/prompt-buttons:translate [to <language>:] text` | **Translate** |
| `/prompt-buttons:drive-sync` | **Sync** status, sync now, connect Google Drive |
- **Starts empty:** each cloud session has its own new library, so your saved prompts and notes from your computer aren't there. Google Drive sync needs a saved sign-in, which a cloud session can't keep (see [Claude Code: cloud sessions](platforms/claude-code.md#cloud-sessions)).

### A Prompt Buttons page in the claude.ai sidebar

For buttons you can see next to any session (cloud, local or a chat), there is also a page you can pin to the claude.ai sidebar: [`extras/prompt-buttons-page.html`](../extras/prompt-buttons-page.html), published as a private claude.ai Artifact.

- **Continue** and your own buttons copy their text; paste it into the prompt box. A page can't type into the prompt box itself.
- **Regenerate** and **Translate** run inside the page, with Claude on your account, then copy the result.
- **Prompt Bank**: search, copy, star, add and delete prompts.
- **Google Drive** tab: sync with the plugin through a folder you choose anywhere in your Google Drive (below).
- **Import and export** in the `ccb export` format, for moving data without Drive (`ccb import prompt-buttons.json` on your computer).

The page is one more device in the plugin's sync: it uses the same folder layout (`<folder>/devices/<device>.json`) and the plugin's own merge code, bundled in by `npm run build:plugin` from [`extras/prompt-buttons-page.template.html`](../extras/prompt-buttons-page.template.html).

**Sync the page with your computers through Google Drive:**

1. The page uses the **Google Drive connector** of your claude.ai account (Settings, Connectors). Signing in to Claude with Google doesn't give it Drive access by itself; the connector does.
2. In the page, open **Google Drive**, search for a folder and press **Sync with this folder**, or create a new one (in My Drive, or inside a folder you found). The page asks once to use Google Drive.
3. On each computer, install **Google Drive for desktop** and point the plugin at the same folder:

   ```bash
   ccb config set sync.mode drive-folder
   ```

   ```bash
   ccb config set sync.folderPath "<that folder's path in Google Drive on this computer>"
   ```

The page syncs when it opens, about 2 seconds after each change, every minute while it's visible, and when you press **Sync now**.

With the plugin's Google Drive API mode instead of the folder mode, the page still reads the plugin's data, but the plugin doesn't see the page's changes: the plugin only asks Google for the `drive.file` permission, which shows it the files it created itself (decision D37).

To publish your own copy, ask Claude in any session to publish `extras/prompt-buttons-page.html` as an Artifact with the `db`, `user`, `sample` and `downloads` capabilities and the Google Drive connector tools `search_files`, `download_file_content`, `create_file` and `trash_file`, and pin it.

**Keep the page beside a session.** In a Claude Desktop Code session, click the globe icon in the session's top bar (next to the `⋯` menu) and open the page's link there: it opens in a panel beside the session, so you can copy a button's text and paste it without switching views. The `⋯` menu itself has no entry for pages. Elsewhere, open the link from **Pinned**, or in a browser window placed beside Claude.

A newly pinned page shows under **Pinned** only after the sidebar reloads: press `Ctrl+R` (`Cmd+R` on a Mac) in Claude Desktop, or reopen the app. Until then it is under **Artifacts**.

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

## Chrome extension (claude.ai in the browser)

The Claude app doesn't show the plugin's button row in cloud sessions. In a browser it can: the extension in [`extensions/chrome`](../extensions/chrome) adds a row above the prompt box on claude.ai, in chats and in Claude Code sessions at claude.ai/code. It works in Chrome, Edge, Brave and other Chromium browsers; the Claude Desktop app doesn't load browser extensions.

| Button | What it does |
|---|---|
| **Continue** | Puts the Continue message in the box and sends it |
| **Regenerate** | Turns the text in the box into a request to rewrite it (the plugin's rewrite instructions). Press Send, then use the rewritten prompt Claude gives back |
| **Translate ▾** | Pick a language; the text in the box is sent with the plugin's translation instructions |
| **Prompts ▾** | Search your prompts and put one in the box |
| your buttons | A button that sends puts its text in the box and sends it; a button that fills only puts the text in the box |
| **☆ Save** | Saves the text in the box as a prompt |

**Install (once, about a minute):**

1. Get the repository's files: on GitHub, **Code**, then **Download ZIP**, and unzip it (or `git clone` it).
2. Open `chrome://extensions` (in Edge, `edge://extensions`), and turn on **Developer mode**.
3. Press **Load unpacked** and choose the `extensions/chrome` folder.
4. Open or reload claude.ai. The row appears above the prompt box.

**Your library:** the extension icon in the toolbar opens a popup where you add and delete buttons, delete prompts, and import or export. The file format is the same as `ccb export`, so you can bring your library over from your computer with `ccb export` and take changes back with `ccb import`. The library is kept in Chrome's own sync storage, so Chrome keeps it the same on every computer where you're signed in to Chrome with your Google account. If it grows past what Chrome sync holds (about 90 KB), it stays on that computer only and the popup says so.

**Privacy:** the extension runs only on claude.ai and asks only for the `storage` permission. It sends nothing to any server: the text goes into claude.ai's prompt box, and Claude's own Send button sends it.

If claude.ai changes its page and the row disappears, the extension will need an update; your library is unaffected.

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
| "Failed to add marketplace" | Check the computer can reach github.com; update Claude Desktop or Claude Code, then try again |
| Prompt Buttons page not inside a session | Open its link with the globe icon in the session's top bar; the `⋯` menu has no entry for pages |
| Prompt Buttons page not in the sidebar | Reload the sidebar (`Ctrl+R`, `Cmd+R` on a Mac) or reopen the app; it is also under **Artifacts** |
| No buttons in a cloud session | Expected: the desktop app shows no plugin buttons there. Use the short commands named in the status bar; see [Cloud sessions](#cloud-sessions) |
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
