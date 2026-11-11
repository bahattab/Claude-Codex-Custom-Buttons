# Features

Each feature lists its behaviour per platform and the acceptance criteria the implementation must meet. Platform names: **CC** = Claude Code on any surface, including the Code tab of Claude Desktop; **CX** = Codex; **CD** = Chat tab of Claude Desktop.

---

## 1. Custom action buttons

Users define buttons in the library. Each button has a label, an optional icon (emoji), an action type and a target.

### Action types

| Type | What it does | Target |
|---|---|---|
| `submit` | Expands variables and sends the text as a message | A prompt ID or inline text |
| `fill` | Expands variables and puts the text in the prompt box (replace, append or insert at cursor) | A prompt ID or inline text |
| `refine` | Runs Regenerate on the current source text | None |
| `continue` | Sends the configured continuation message | None |
| `insert-prompt` | Opens the Prompt Bank picker filtered by a category or search | Category or search text |
| `open-pane` | Opens the Notes or Prompt Bank pane | `notes` or `prompt-bank` |

There is deliberately **no** action type that runs shell commands, scripts or arbitrary code. See [security-and-privacy.md](security-and-privacy.md).

### Behaviour

- **CC:** buttons appear in a row above the prompt box, after the built-in Continue and Regenerate buttons (Notes and Prompts join them in M4). The row hides itself when empty space is short and keeps the first N buttons (`buttons.maxVisible`, default 6). `/btn <id>` runs any button. Buttons are created and edited in the Prompt Bank pane's **Buttons** tab.
- **CX:** buttons of type `submit` and `fill` become generated Codex skills, used as `$ccb-<name>` and rewritten automatically after every change and sync. Other types map to the matching built-in skill.
- **CD:** not available. Buttons of type `submit` are exposed as MCP prompts.

### Acceptance criteria

- A button created in CC appears in the row without restarting the session.
- Editing a prompt that a button points to changes what the button sends, with no edit to the button.
- A button pointing to a deleted prompt shows as disabled with a tooltip, rather than sending nothing.
- Pressing a button while the model is replying queues the submission until the session is idle (engine behaviour of `$.prompt.submit`).

---

## 2. Regenerate Prompt

Rewrites a rough prompt into a clearer one.

### Source text, in order of preference

1. The text currently selected in the transcript.
2. The draft in the prompt box.
3. The user's last message in this conversation.

If none exists, the user sees "Nothing to regenerate: select text or type a draft."

### Rewrite

The rewrite instructions live in `core` (`refine/instructions.ts`) and ask the model to:

- keep the user's intent, language and any code, file paths, numbers and names exactly;
- make the goal, context, constraints and expected output explicit;
- remove filler and ambiguity;
- return only the rewritten prompt, with no commentary.

Users can replace these instructions with their own in settings (`regenerate.instructions`).

### Result

- Default: the rewritten prompt **replaces** the prompt-box content so the user can review and edit it, then press Enter.
- With `regenerate.autoSubmit = true`: it is sent immediately.
- The original text is kept so **Undo regenerate** (button that appears for 30 s, or `/regen undo`) restores it.

### Per platform

- **CC:** button + `/regen [extra instruction]`; `/regen undo`. The model call uses the engine's model API (`$.model.complete`).
- **CX:** `regenerate-prompt` skill. Codex's own model performs the rewrite following the same instructions, then shows the result for the user to copy or approve.
- **CD:** an MCP prompt "Regenerate my prompt" that inserts the instructions; the user pastes their text after it.

### Acceptance criteria

- Code blocks, URLs, file paths and numbers in the source survive the rewrite unchanged (checked by a test that compares them).
- With auto-submit off, nothing is sent without a user action.
- Undo restores the exact original text.

---

## 3. Continue

Sends a standard continuation message, by default:

> Continue exactly where you stopped. Do not repeat what you already wrote. If you were in a code block, reopen it with the same language and continue the code.

- **CC:** button + `/cont` (`/continue` is a built-in Claude Code command). When the last reply stopped because it hit the output limit (`turn.step` reports `stopReason` `max_tokens`), the button is highlighted.
- **CX:** `continue` skill.
- **CD:** MCP prompt "Continue".
- The message is configurable (`continue.message`).

### Acceptance criteria

- One press sends exactly one message.
- When the session is busy, the message waits until the reply finishes.

---

## 4. Notes

A scratchpad that stays beside the chat. Notes are saved locally and synced through Google Drive, so you can open and edit them from any PC. Edits made offline sync when the connection returns.

- **Storage:** each note is a record in the library (see [data-model.md](data-model.md#note)), synced through Drive like the Prompt Bank, and mirrored to a local Markdown file in `~/.claude-codex-buttons/notes/` so any editor or tool can read it. An edit made to that file in another editor is picked up and synced too.
- **Sync:** a change is uploaded about 2 seconds after typing stops; other PCs pull it within 60 seconds, or immediately when their Notes pane opens. Offline edits stay pending and upload automatically when the connection returns. If the same note was edited on two PCs before either synced, both texts are kept: the newer stays as the note and the other appears as a conflict copy to merge (see [google-drive-sync.md](google-drive-sync.md#conflict-copies)).
- **CC:** a side pane with a note picker (pinned first), a multi-line text box, **New**, **Rename**, **Pin**, **Delete** (asks first), **Copy**, **Insert into prompt**, a dot on notes not uploaded yet, and **Keep this / Keep other / Keep both** on a conflict copy. Saves automatically `notes.autosaveMs` (2 seconds) after typing stops, also if the pane was closed meanwhile; Enter or **Save** saves at once, and switching notes saves the one being left. `/notes` opens the pane; `/notes <text>` adds the text to the open note, or starts a new note.
- **Unsaved text is never replaced.** If the open note changed elsewhere (another PC, or its Markdown file) while it has unsaved text, the pane keeps your text and offers **Keep mine** (save yours over it) or **Load theirs**. Autosave, Save, Rename, Pin and `/notes <text>` wait for that choice. If a save fails, the pane stays on the note instead of switching. If the note was deleted elsewhere, your unsaved text is kept and saves as a new note.
- **CX:** `notes` skill that lists, reads, writes and appends to notes through `ccb-mcp`, so Codex sees the same synced notes.
- **CD:** not available as a pane; Claude in the Chat tab can read and append notes through the MCP tools.

### Acceptance criteria

- Text typed in the pane is saved locally within 3 seconds.
- A note edited on one PC appears on another signed-in PC within 60 seconds while both are online.
- A note edited while offline is uploaded automatically after the connection returns, with no user action.
- Two PCs editing the same note offline both keep their text after syncing (one as a conflict copy); nothing is lost.
- Closing and reopening the pane, or restarting the session, shows the same text.
- A note edited in a text editor while the pane is open is reloaded, unless the pane has unsaved changes, in which case the user is asked which to keep.

---

## 5. Prompt Bank

A searchable library of reusable prompts, synced through Google Drive.

### Prompt fields

Title, body (with `{{variables}}`), category, tags, favourite flag, usage count, last used, created/updated times. Full schema: [data-model.md](data-model.md).

### CC pane

- **Header:** counts (prompts, favourites, notes, conflict copies), the sync status (sync is automatic; **Sync now** only makes it happen at once), and **Connect Google Drive** until signed in.
- **Search box:** matches title, tags and body while you type (after a 150 ms pause); favourites and recently used rank first.
- **Category filter** and **favourites only** toggle.
- **Each prompt:** **Insert** (fill the prompt box), **Send**, **Copy**, **Edit**, **Duplicate**, **Delete** (with confirmation and undo).
- **Save draft:** saves the current prompt-box text as a new prompt.
- **Tabs:** Prompts · Variables (set, add, delete) · Buttons (create any action type, delete) · Settings (every setting, including the shared Regenerate instructions and Continue message).
- **Unsaved edits** are kept if the pane closes and reopen with it. Only **Cancel** discards them; a failed save keeps the form and its text.
- `/pb` opens the pane; `/pb <search>` opens it with the search filled in; `/pb save <title>` saves the current draft directly; `/pb sync` syncs now.

### CX

`prompt-bank` skill using MCP tools `bank_search`, `bank_get`, `bank_save`, `bank_delete`, `bank_list_categories`. Favourite prompts are also generated as `$ccb-<name>` skills, kept up to date automatically (D34).

### CD

Every prompt is exposed as an MCP prompt, so it appears in the "+" menu. Read-only there.

### Starter pack

On first run the library is seeded with a small starter set (e.g. "Explain this code", "Write tests for", "Review for security", "Summarise the conversation") and starter variables (`project`, `language`, `audience`). Like the reference plugin's quick-add chips, starters already present are not added again.

### Acceptance criteria

- Saving a prompt shows it in the list immediately and on another signed-in device within 60 seconds.
- Search over 1,000 prompts returns results while typing (under 50 ms in `core` benchmark).
- Deleting a prompt on one device removes it everywhere after sync, and it does not reappear.

---

## 6. Translate

Instant translation of selected text, in the spirit of browser translators such as ImTranslator, using the model you're already working with: nothing goes to any other service.

- **Directions:** `translate.target` is `auto` by default: into `translate.primary` (English), or into `translate.secondary` (Arabic) when the text is already in the primary language. Pick any other language in the pane, or with `/tr to <language>: <text>`. The source language is detected and shown, for example "French → English".
- **What's kept:** code, paths, URLs, numbers, names, `{{placeholders}}` and formatting are kept as they are. The text is only translated, never answered or carried out, even when it's a question or an instruction.
- **CC:**
  - **Instant:** select text in Claude Code (in the terminal this needs fullscreen mode, where Claude Code tracks the selection), and when the selection holds still for a moment, the translation appears in a bubble above the prompt box, with **Copy**, **Insert**, **Open in Translate** and **Close**. The same text isn't translated twice; numbers, single characters, code, paths, URLs and translations already shown are skipped; selections over 2,000 characters go through the pane. Turn it off with `ccb config set translate.instant false`.
  - **Translate pane** (the **Translate** button, or `/tr`): a text box, an **Into** picker (Automatic or a language), **Translate**, **Swap** (translate the result back), **Copy**, **Insert into prompt**, **Replace prompt**, and the recent translations of this session.
  - **`/tr`:** `/tr [to <language>:] [text]`. With no text it uses the selection, else your draft, else your last message.
- **CX:** the `translate` skill, using `translate_instructions` with the same settings.
- **CD:** the `ccb-translate` prompt in the "+" menu (arguments `text`, `to`), and the `translate_instructions` tool.

### Acceptance criteria

- Selecting text in Claude Code shows its translation above the prompt box without any other action (when `translate.instant` is on), and selecting the same text again costs no second model call.
- `auto` translates English text into the secondary language and other text into the primary language.
- Code, URLs and numbers survive a translation unchanged.

---

## Prompt variables

| Kind | Syntax | Value |
|---|---|---|
| User variable | `{{project}}` | Defined in the Variables tab; synced with the Prompt Bank |
| Built-in | `{{selection}}`, `{{draft}}`, `{{last_prompt}}`, `{{date}}`, `{{time}}`, `{{cwd}}` | Computed at use time (not every built-in is available on every platform; unavailable ones expand to an empty string and show a warning) |
| Ask when run | `{{?topic}}` or `{{?topic:default text}}` | The user is asked each time |
| Literal braces | `\{{not a variable}}` | Left as typed |

Rules, adapted from the reference plugin's token rules:

- Names are lowercase letters, digits and underscores (`^[a-z][a-z0-9_]{0,63}$`). Names are normalised on save and on lookup.
- An unknown variable is left as typed and highlighted, never silently removed.
- Expansion happens once; a variable's value is not itself expanded (prevents loops).
