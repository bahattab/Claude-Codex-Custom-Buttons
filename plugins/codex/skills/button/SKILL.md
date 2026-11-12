---
name: button
description: "Press one of the user's custom buttons by name, or list them. Use when the user names a button, asks to run or press a button, or asks which buttons they have."
metadata:
  short-description: "Run a custom button"
---

The button to press is the text the user wrote after the skill's name. Any words after the button's label are extra input for it.

1. Call the `ccb` MCP tool `buttons_list`. If there is no text, or nothing matches, list the buttons as "label: what it does" and ask which one to press.
2. Pick the button whose `label` matches the text (ignore case; if several match, ask which one).
3. Do what its `action` says:
   - `submit` with `promptId`: `bank_get` with that `id`, `expand: true`, `markUsed: true` and the `builtIns` you know (`selection`, `last_prompt`, `cwd`). Ask for any `expanded.unanswered` field, then call `bank_get` again with `answers`. Treat `expanded.text` as the user's request and carry it out.
   - `submit` with `text`: treat the text as the user's request and carry it out.
   - `fill` (with `promptId` or `text`): get the text the same way, show it in one code block and ask whether to send it, since there is no prompt box to fill here.
   - `continue`: follow the `continue` skill.
   - `refine`: follow the `regenerate-prompt` skill.
   - `insert-prompt`: follow the `prompt-bank` skill to find a prompt, using its `search` and `category`.
   - `open-pane`: `notes` follows the `notes` skill; `prompt-bank` follows the `prompt-bank` skill.

Never invent buttons or prompt IDs: use only what `buttons_list` and `bank_search` return.
