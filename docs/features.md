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

- **CC:** buttons appear in a row above the prompt box, after the built-in Continue, Regenerate, Notes and Prompts buttons. The row hides itself when empty space is short and keeps the first N buttons (`buttons.maxVisible`, default 6). `/btn <id>` runs any button. Buttons are created and edited in the Prompt Bank pane's **Buttons** tab.
- **CX:** buttons of type `submit` and `fill` are generated as Codex slash commands by `ccb sync codex` (format confirmed in M0). Other types map to the matching skill.
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

- **CC:** button + `/regen [extra instruction]`. The model call uses the engine's model API (`$.model.complete`).
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

- **CC:** button + `/continue`. When the last assistant message ended because it hit the output limit, the button is highlighted (if the conversation data exposes the stop reason; checked in M3).
- **CX:** `continue` skill.
- **CD:** MCP prompt "Continue".
- The message is configurable (`continue.message`).

### Acceptance criteria

- One press sends exactly one message.
- When the session is busy, the message waits until the reply finishes.

---

## 4. Notes

A scratchpad that stays beside the chat.

- **Storage:** one Markdown file per note in `~/.claude-codex-buttons/notes/`. Plain files, so any editor or tool can read them. Notes are **not** synced to Drive (default decision; see [decisions.md](decisions.md)).
- **CC:** a side pane with a note picker, a multi-line text box, **New**, **Rename**, **Delete**, **Copy**, **Insert into prompt**. Saves automatically 2 seconds after typing stops and when the pane closes. `/notes [text]` opens the pane, or appends the text to the current note.
- **CX:** `notes` skill that lists, reads and appends to the same files through `ccb-mcp`.
- **CD:** not available.

### Acceptance criteria

- Text typed in the pane is on disk within 3 seconds.
- Closing and reopening the pane, or restarting the session, shows the same text.
- A note edited in a text editor while the pane is open is reloaded, unless the pane has unsaved changes, in which case the user is asked which to keep.

---

## 5. Prompt Bank

A searchable library of reusable prompts, synced through Google Drive.

### Prompt fields

Title, body (with `{{variables}}`), category, tags, favourite flag, usage count, last used, created/updated times. Full schema: [data-model.md](data-model.md).

### CC pane

- **Home:** counts (prompts, categories, favourites, variables), sync status, **Sync now**.
- **Search box:** matches title, tags and body; favourites and recently used rank first.
- **Category filter** and **favourites only** toggle.
- **Each prompt:** **Insert** (fill the prompt box), **Send**, **Copy**, **Edit**, **Duplicate**, **Delete** (with confirmation and undo).
- **Save draft:** saves the current prompt-box text as a new prompt.
- **Tabs:** Prompts · Variables · Buttons · Settings.
- **Unsaved edits** are kept as a draft if the pane closes, and the user is asked before discarding them.
- `/pb <search>` opens the pane with the search filled in; `/pb sync` syncs now; `/pb save <title>` saves the current draft.

### CX

`prompt-bank` skill using MCP tools `bank.search`, `bank.get`, `bank.save`, `bank.delete`, `bank.list_categories`. `ccb sync codex` also writes each prompt as a slash command.

### CD

Every prompt is exposed as an MCP prompt, so it appears in the "+" menu. Read-only there.

### Starter pack

On first run the library is seeded with a small starter set (e.g. "Explain this code", "Write tests for", "Review for security", "Summarise the conversation") and starter variables (`project`, `language`, `audience`). Like the reference plugin's quick-add chips, starters already present are not added again.

### Acceptance criteria

- Saving a prompt shows it in the list immediately and on another signed-in device within 60 seconds.
- Search over 1,000 prompts returns results while typing (under 50 ms in `core` benchmark).
- Deleting a prompt on one device removes it everywhere after sync, and it does not reappear.

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
