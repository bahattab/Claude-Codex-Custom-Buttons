# Design decisions

Each decision records the options considered, the choice and why. All were approved by the project owner on 2026-11-10 ("go with all recommended defaults").

## D1. Claude Desktop scope

- **Options:** (a) Claude Code plugin for the Code tab, plus MCP prompts for the Chat tab; (b) Code tab only; (c) inject scripts into the Electron app to add buttons to the Chat tab.
- **Choice:** (a).
- **Why:** both tabs get the Prompt Bank. (c) is fragile across app updates and may conflict with the app's terms.

## D2. Regenerate behaviour

- **Options:** (a) put the rewrite in the prompt box for review, auto-submit as an option; (b) always auto-submit.
- **Choice:** (a), `regenerate.autoSubmit = false` by default.
- **Why:** a rewrite can change meaning; the user should see it before it is sent. Undo is provided either way.

## D3. Storage location

- **Options:** (a) one shared library in `~/.claude-codex-buttons/`; (b) separate storage per tool.
- **Choice:** (a).
- **Why:** "save once, use everywhere" is the core idea, and Drive sync needs one source.

## D4. Repository visibility and name

- **Choice:** repository `bahattab/Claude-Codex-Custom-Buttons` (GitHub does not allow spaces in names). Private at first; made public on 2026-11-12 so that installing needs no GitHub sign-in, including in cloud sessions. The history was checked for secrets before the change.

## D5. Codex integration depth

- **Options:** (a) skills, MCP server and generated commands (generated skills since M0, fact X5); (b) also hooks.
- **Choice:** (a).
- **Why:** hooks were reported as experimental behind a feature flag; they can be added later without changing the data model.

## D6. License

- **Options:** MIT; GPL-2.0-or-later (as the WordPress reference).
- **Choice:** MIT.
- **Why:** no WordPress code is reused, so GPL is not required; MIT keeps reuse simple across ecosystems.

## D7. Location in Google Drive

- **Options:** (a) visible folder "Claude Codex Buttons" in My Drive; (b) hidden app-data folder.
- **Choice:** (a).
- **Why:** users can see and back up their data; with `drive.file` the app still cannot see other files.

## D8. What syncs (revised 2026-11-10)

- **Options:** (a) Prompt Bank, buttons and variables; (b) also Notes; (c) Prompt Bank only.
- **Original choice:** (a).
- **Revised choice:** (b), at the project owner's request: "Notes are saved locally and synced through Google Drive, so you can access and edit them from any PC. Offline edits sync when the connection returns. Sync now includes Prompt Bank, custom buttons, variables, and Notes."
- **Why:** notes are part of the working set the owner wants on every PC. Notes become synced library records with a local Markdown mirror (see [data-model.md](data-model.md#note)).

## D9. Drive connection mode

- **Options:** (a) Drive API through `ccb-mcp`, with the Drive for desktop folder as fallback; (b) Drive for desktop folder only; (c) Claude's Google Drive connector.
- **Choice:** (a).
- **Why:** works on any computer and with Codex; nearly instant; per-prompt merging. (b) has no control over upload timing and creates duplicate files under contention. (c) is unavailable to Codex.

## D10. Who owns storage and sync

- **Choice:** the MCP server (`ccb-mcp`) is the only component that reads/writes the library and talks to Drive; the Claude mod reaches it through `$.mcp`.
- **Why:** one implementation shared by all three platforms; credentials in one place. Recorded during documentation; follows from D3 and D9.
- **Refined in M2 (D20):** file access lives in the `@ccb/store` package, used by both `ccb-mcp` and the `ccb` command, so they share one lock and one set of rules. Google Drive access stays in `ccb-mcp`.

## D11. No code-running actions

- **Choice:** buttons cannot run shell commands or scripts.
- **Why:** a synced library that can run code would let anyone with access to the Drive file run commands on every device. The reference plugin's unescaped `custom_html` type is the analogous risk and is not carried over.

## D12. One Drive file per device (2026-11-10, M0)

- **Options:** (a) one shared `prompt-bank.json`, read-merge-write with a version check; (b) one file per device, each written only by its device, all merged on read.
- **Choice:** (b).
- **Why:** M0 found that Drive's update call has no "only if unchanged" condition (fact G3), so (a) can silently lose one device's upload when two devices push together. (b) has no shared writer, so that race cannot happen, and it also prevents Google Drive for desktop "(1)" duplicates in the fallback mode. Costs: each pull may download several small files (only changed ones, via the change feed), and conflict copies need deterministic IDs so devices don't each create their own.

## D13. Copy `core` into the Claude plugin at build time (2026-11-10, M0)

- **Why:** a mod may import only files inside its own plugin and no npm packages (fact C15). `core` stays dependency-free, and a build step copies its compiled modules into `plugins/claude/hooks/core/`. CI checks the copy is up to date.

## D14. Sync is always automatic (2026-11-10)

- **Choice:** sync needs no user action after the one-time sign-in: changes push about 2 s after saving, pulls run on start, on pane open and every 60 s, offline changes retry, and a **background sync service** keeps syncing when no Claude Code or Codex session is open. Sign-in can start from a **Connect Google Drive** button in the panes.
- **Why:** the project owner's requirement ("sync has to be automatic"). The background service is per-user (no administrator rights) and can be declined at `ccb login` or removed with `ccb service uninstall`.

## D15. Node.js 22 or newer (2026-11-10, M0)

- **Why:** Node.js 20 reached end of life in April 2026, and the test runner (Vitest 5) needs Node 22.12 or newer. Claude Desktop ships its own Node for the desktop extension.

## D16. TypeScript 6 for now (2026-11-10, M0)

- **Why:** TypeScript 7.0.2 is the latest release, but `typescript-eslint` 8.72 supports TypeScript below 6.1. The project pins TypeScript 6.0.3 and moves to 7 when the linter supports it.

## D17. Detect concurrent edits with `ancestors` (2026-11-10, M1)

- **Options:** (a) compare each version with the hash this device saw at the last sync; (b) record on each version which other devices' versions it replaced (`ancestors`), and treat a device's own later version as replacing its earlier ones.
- **Choice:** (b).
- **Why:** (a) mistakes an old version still sitting in a rarely-synced device file for a new edit, creating false conflict copies, and depends on clocks. (b) decides "newer or concurrent" from the edit history itself, so typing a note 100 times offline produces no conflict, while two PCs editing the same note do. Only foreign versions are recorded, so the list stays short (capped at 32).
- **Also decided:** a deletion that wins over a concurrent edit keeps the edit as a conflict copy, so no text is lost silently. Categories, variables, buttons and shared settings resolve by newest edit without copies.

## D18. Hand-written JSON Schema, checked by tests (2026-11-10, M1)

- **Why:** core stays dependency-free (D13), so it can't generate a JSON Schema from a schema library. `schema/library.schema.json` is written by hand and a test runs both it (through `ajv`, a development-only dependency) and the core validators over the same valid and invalid documents.

## D19. MCP tool names use underscores (2026-11-10, M2)

- **Why:** Claude's API accepts tool names matching `^[a-zA-Z0-9_-]{1,64}$`, so the documented `bank.search` style would be rejected. Tools are named `bank_search`, `notes_append` and so on; a test checks every name.

## D20. A shared `@ccb/store` package (2026-11-10, M2)

- **Options:** (a) only `ccb-mcp` touches files, and `ccb` asks the server; (b) a small storage package used by both.
- **Choice:** (b).
- **Why:** `ccb doctor` and `ccb import` must work when no server is running, for example to repair a damaged library. Both tools use the same lock and the same `update` path, so the "one writer at a time" guarantee holds either way.

## D21. Lock-file design (2026-11-10, M2; revised after independent review)

- **Choice:**
  - The lock file is created with its contents in one step: write a temporary file, then hard-link it into place, or use an exclusive create where hard links are unsupported.
  - While the lock is held, the holder refreshes the file's modification time (a heartbeat).
  - A lock counts as abandoned only when its process no longer exists, or when the heartbeat has stopped for 30 seconds. A lock that can't be read is judged by age, and a lock that disappears is simply retried.
  - Abandoned locks are cleared by one process at a time through a short "breaker" lock, with a re-check before removal. Every retry path has a deadline and a pause.
- **Why:**
  - The first design, a plain exclusive create, lost 1 of 100 changes in the multi-process test, because waiters read the new lock file before its contents were written.
  - A stress test then exposed a second race: a released lock mistaken for an abandoned one.
  - The independent review found three more problems: a live holder lost its lock after 30 seconds, several processes clearing a lock at once could release a fresh one, and the clearing path could spin with no time limit.
  - With all of these fixed: 8 concurrent processes × 50 changes kept every change (2,400/2,400 before the review fixes, 1,600/1,600 after). A test runs 8 waiters against an abandoned lock and checks that at most one is ever inside.

## D22. Recognise note-file edits by content, not timestamps (2026-11-10, M2)

- **Why:** the independent review showed timestamp comparison loses edits. Any unrelated save rewrote the files before checking them, and file systems with coarse or skewed timestamps hid edits. The store now records a hash of what it last wrote to each note file (`notes-mirror.json`). Any file whose content differs from that hash was edited elsewhere, and is imported while the lock is held, before every change.

## D23. Plugin and marketplace names (2026-11-10, M3)

- **Choice:** the Claude Code plugin is `prompt-buttons` in the marketplace `ccb`; the Codex plugin will be `prompt-buttons-codex` in `ccb-codex`. The project, repository, data folder (`~/.claude-codex-buttons`) and credential-store service name are unchanged.
- **Why:** `claude plugin validate` refuses third-party plugin names that start with `claude-` ("reserved: it passes as one of Anthropic's own") and asks for a name that describes what the plugin does.

## D24. Slash commands send their message just after they return (2026-11-10, M3; revised after independent review)

- **Why:** Claude Code refuses `$.prompt.submit` inside a `command.run` hook ("it would wait on the turn this hook is holding"), as the plugin's first test showed.
- **First choice:** queue the text and send it from the `turn.complete` hook. The independent review showed three flaws:
  - a command that makes no model call may have no turn end of its own;
  - a subagent's or a stopped turn's end would send the message at the wrong moment;
  - a single slot lost the first of two queued messages.
- **Revised choice:** commands queue messages, in order, and send them from a `$.clock.after(0)` timer once the hook has returned. Anything refused there is sent when the main conversation's next turn completes; subagents' and aborted turns don't count. Buttons send immediately.
- **Still to confirm hands-on:** that a real session accepts the submit from the timer. The test kit does.

## D25. Ship `ccb-mcp` inside the Claude plugin as one bundled file (2026-11-10, M3)

- **Why:** an installed plugin gets no `npm install`, so its MCP server must run with Node alone. `scripts/build-plugin.mjs` bundles the server and its dependencies with esbuild (805 KB, minified) and copies `core` into the mod. The generated files are committed, and `npm run check:plugin` in CI fails if they don't match the sources.

## D26. One owner per piece of mod state; modules call each other directly (2026-11-10, M4)

- **Choice:** each `$.state` atom is declared in the one file that reads and updates it: `client.ts` owns the button row's data, `bank.tsx` the Prompt Bank's view and data, `notes.tsx` the Notes view, `register.tsx` the row's own state. Other modules use exported functions such as `refreshClient($)` and `autosaveMs($)`.
- **Why:** `claude plugin validate` refuses two patterns:
  - an atom imported from another module and read or updated there;
  - `$` handed to a stored callback (`hooks.onLibraryChanged($)`): "$ is always spelled $.noun.event(...) at the call site".
  A direct call to an imported function that takes `$` is accepted. The first design passed callbacks into each pane module; it was replaced.

## D27. Keep the Google sign-in with the OS's own tools (2026-11-11, M5)

- **Choice:** macOS Keychain through `security`, Linux Secret Service through `secret-tool`, Windows a DPAPI-encrypted file through PowerShell. A file readable only by you is used only when `google.tokenStore` is `"file"`. The token goes to these tools on standard input, never on a command line; a token with unexpected characters is refused rather than quoted.
- **Why:** the plan named `@napi-rs/keyring`, a native module. The Claude plugin's server is one bundled JavaScript file run by plain Node with no `npm install` (D25), so it can't carry per-platform native binaries. The project owner chose this option (2026-11-11).
- **Limits:** the commands are tested with a stand-in command runner only; they still need a hands-on check on each OS (platform-facts G7).

## D28. A small fetch-based Drive and OAuth client (2026-11-11, M5)

- **Choice:** call the documented Drive v3 endpoints (`files.list`, `files.create`, media upload and download, `changes.getStartPageToken`, `changes.list`) and Google's OAuth endpoints (authorise with PKCE, token, revoke) with Node's built-in `fetch`, instead of `@googleapis/drive` and `google-auth-library`.
- **Why:** sync needs a handful of calls; the bundled server stays small (834 KB) and has no new dependencies; a fake Drive behind the same `fetch` tests every path. Chosen by the project owner (2026-11-11).

## D29. "Pending" is derived from hashes, not an outbox log (2026-11-11, M5)

- **Choice:** a record is pending while its content hash differs from the hash saved at the last successful upload (`sync-state.json`). There is no `outbox.json`.
- **Why:** a log can drift from the library (a crash between writing the library and the log, edits by another process). Comparing hashes can't: after any crash, whatever differs from Drive is uploaded on the next run, once.

## D30. One sync at a time per computer, with a cache of device files (2026-11-11, M5)

- **Choice:** a sync run (pull, merge, push) holds `.sync.lock`, and the newest copy of every other device's file is kept in `sync-cache/`.
- **Why:** two `ccb-mcp` processes on one computer (Claude Code and Codex open together) could otherwise upload an older view after a newer one. The change feed downloads only changed files, but the merge needs every device file (a record missing from every newer file counts as deleted), so the others come from the cache.

## D31. Infer a deletion only from a device that dropped the record (2026-11-11, M5; revises D17's deletion rule)

- **Choice:** a record that exists only on this computer, unchanged since the last sync, counts as deleted only when another device's file held it at the last merge and no longer does (its tombstone expired there). The merge remembers which records each device's file held (`SyncBase.devices`).
- **Note:** a device whose sync state predates this rule infers no deletions on its first merge, so after 180 days offline it can bring back records whose tombstones expired elsewhere. Don't sync with devices running an older version.
- **Why:** the first rule ("absent from every device file that synced after our last pull") compared one device's clock with another's. The independent M5 review showed that a new record was deleted everywhere when another computer's clock ran ahead, or when its upload raced with ours. Both cases now have tests.

## D32. Sync delivered in one pull request (2026-11-11, M5)

- **Choice:** M5a and M5b went into one pull request.
- **Why:** the independent review of M5a found data-loss bugs while M5b was under way in the same files (engine, server, CLI), and the project owner asked for the work to continue to the end without stopping. The milestone is still reported in two parts in the roadmap.

## D33. On Windows, start the background service from the per-user Run key (2026-11-11, M5)

- **Choice:** a value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` runs a hidden VBScript launcher at log-on. `ccb service stop` and `uninstall` end the daemon through the pid file it writes.
- **Why:** the independent review pointed out that `schtasks /Create /SC ONLOGON` is widely reported to need administrator rights, against D14, and that stopping the task couldn't stop the daemon the launcher had already started.

## D34. Codex skills for buttons and favourite prompts only (2026-11-11, M6)

- **Choice:** generated `$ccb-<name>` skills come from every `submit` or `fill` button and every favourite prompt, not from every prompt.
- **Why:** Codex lists every skill to the model, so hundreds of prompts would crowd out other skills and use context. Marking a prompt as a favourite is the switch. Every prompt stays reachable through the `prompt-bank` skill.

## D35. Translate with the model the user is already using (2026-11-11, M9)

- **Choice:** translations come from the session's own model (`$.model.complete` in Claude Code, the Codex model through the `translate` skill, Claude in Claude Desktop through the prompt), following `translate_instructions`. No translation service such as Google Translate is called.
- **Why:**
  - no new account, key or network host (the privacy policy now says that selected text goes to the session's model);
  - the text goes only where the user's chat already goes;
  - a language model keeps code, placeholders and formatting.
- **Instant translation** polls the selection, because there's no selection event (C26), and translates a selection only once it has held still for one interval. Results are cached; numbers, single characters, code, paths, URLs and already-shown translations are skipped; and the bubble uses a smaller answer limit. So the model isn't called while text is still being selected, or when you select a translation to copy it. It can be turned off with `translate.instant`.

## D36. `/` commands for cloud sessions (2026-11-12)

- **Problem:** the Claude app doesn't show a plugin's button row in cloud sessions; it draws its own interface there (checked by the project owner on 2026-11-12).
- **Options:** (a) give the Claude plugin skills, which appear as `/prompt-buttons:<skill>` commands in every session; (b) a browser extension that adds buttons to claude.ai; (c) a page pinned in the Claude sidebar.
- **Choice:** (a) now: the Codex skills are copied into the Claude plugin at build time, so both plugins share one text and `npm run check:plugin` catches drift. A new `button` skill presses a custom button by its label. (b) is rejected for the same reason as D1(c). (c) is added as `extras/prompt-buttons-page.html` (see the install guide): it copies text rather than typing into the prompt box, which no page can do.

## D37. The sidebar page syncs as one more device, through the Google Drive connector (2026-11-13)

- **Options:** (a) the page reads and writes its own device file in a Drive folder the user chooses, through the claude.ai Google Drive connector, with the plugin in Drive-folder mode; (b) the plugin's Drive API mode; (c) widen the plugin's Google permission from `drive.file` to all of Drive.
- **Choice:** (a), chosen by the project owner, with the folder picked anywhere in Drive.
- **Why:** with `drive.file` (decision D27's least privilege), the plugin's API mode never sees files another app created, so (b) is one-way (the page reads the plugin's data). (c) would let the plugin read every file in the user's Drive. In (a) Google Drive for desktop puts the page's file in the local folder, where the plugin reads it like any device's.
- **How:** the page bundles the plugin's core (edit operations, validation and merge), so its records, ancestors and deletions follow the same rules. The connector can't rewrite a file, so each upload moves the page's old file to the trash and creates the new one; a device file missing for a moment deletes nothing, because a deletion is inferred only from a file that is present and no longer holds a record (D31).
- **Checked:** `extras/test-page-sync.cjs` runs the page in a browser against a folder standing in for Drive and the real `ccb` in folder mode: data flows both ways, a deletion in the page reaches the plugin, and an edit on the computer reaches the page. On 2026-11-13 the project owner picked a folder in the published page and it synced with the real connector: its device file appeared in that folder's `devices/`.

## D38. A Chrome extension for claude.ai (2026-11-14)

- **Context:** the project owner asked for a button row in cloud sessions like the one the Prompt Perfect extension adds to claude.ai. D1(c) and D36(b) had set browser injection aside as fragile.
- **Choice:** our own Manifest V3 extension (`extensions/chrome`), written from scratch (Prompt Perfect is a closed commercial product, so none of its code is used). It runs only on `https://claude.ai/*` and asks only for `storage`.
- **Why now:** it is the only way to put buttons in the cloud-session view itself, and the owner chose it knowing the cost. The fragility is contained: the row lives in a shadow root, finds the prompt box by claude.ai's editor and falls back to the lowest visible text box, re-attaches when the page redraws, and removes itself cleanly; if claude.ai changes, only the row stops working, never the library.
- **Differences from Prompt Perfect:** nothing goes to a third-party server (Prompt Perfect sends prompt text to its own server to rewrite it); Regenerate and Translate ask Claude in the conversation with the plugin's own instructions; no sign-in.
- **Library:** the plugin's format and edit operations (the core bundle, with the Continue, Regenerate and Translate texts, generated by `npm run build:plugin`), kept in `chrome.storage.sync` so Chrome syncs it across the owner's computers. It doesn't join the Google Drive sync: the extension's own Google permission would be `drive.file`, which can't see the plugin's or the page's files (see D37). Import and export in the `ccb export` format connect it to the rest.
- **Checked:** `extras/test-chrome-extension.cjs` loads the extension into Chromium on a stand-in claude.ai page: the row appears above the box, Continue sends, Regenerate fills without sending, a saved prompt inserts from the menu, the popup adds a button and imports a `ccb export`, the row updates without a reload, a custom button sends, and the row comes back after the page redraws. Not yet checked on the live claude.ai.

## D39. In cloud sessions the short commands are the buttons (2026-11-14)

- **Context:** the project owner wanted the buttons in the Claude desktop app's cloud sessions, anywhere in the window: above the prompt box, beside the 🌐 icon, in the context panel or the status bar.
- **Checked** with a test mod in a live cloud session in the desktop app: a row above the prompt box, a pane (`$.ui.open` answered `isPlaced: false`), a page served from the session for the 🌐 preview, buttons drawn in a command's output and buttons under each reply all stayed hidden; the app showed a command's output and the status line as text only. The title bar, the 🌐 menu, the context panel and the message toolbar are the app's own; a plugin has no way to add to them.
- **Choice:** make the mod's short commands (`/cont`, `/regen`, `/tr`, `/pb`, `/notes`, `/btn`) do everything the buttons do when no pane can open: `/pb` and `/notes` answer with numbered lists (`/pb use <n>`, `/pb send <n>`, `/notes read <n>`), `/tr` answers with the translation, `/btn` takes a button's name; the status line names the commands. Each command checks `isPlaced` from `$.ui.open`, so on a computer they still open the panes.
