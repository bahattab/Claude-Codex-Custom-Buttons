---
name: prompt-bank
description: "Use the user's saved prompts (Prompt Bank): find, run, save, edit or delete them, and manage {{variables}} and custom buttons. Use when the user mentions their prompt bank, saved prompts, a prompt by name, or asks to save a prompt."
metadata:
  short-description: "Find, use and save prompts"
---

The Prompt Bank lives in the `ccb` MCP server and is shared with Claude Code and the user's other computers. Never invent prompt IDs: always look them up.

**Find and use a prompt** (for example "use my standup prompt", or the words after the skill's name: $ARGUMENTS)
1. `bank_search` with `query` set to the words (empty lists favourites and recent prompts first).
2. If several match, list their titles (and previews) and ask which one; if one matches, use it.
3. `bank_get` with that `id`, `expand: true` and `markUsed: true`. If `expanded.unanswered` lists `{{?ask}}` fields, ask the user for each value, then call `bank_get` again with `answers`.
4. Treat `expanded.text` as the user's request and carry it out.

**Save a prompt** ("save this as a prompt"): `bank_save` with a short `title` and the `body` (use `{{name}}` for values that change, and `{{?name}}` to ask each time). Optional: `category` (from `bank_list_categories`), `tags`, `favorite`. Confirm with the title.

**Edit or delete**: find it with `bank_search`, then `bank_save` with its `id`, or `bank_delete` after the user confirms.

**Variables**: `variables_list`, `variables_set` (`name`, `value`) and `variables_delete`. A variable such as `{{project}}` changes in every prompt that uses it.

**Buttons**: `buttons_list`, `buttons_save` and `buttons_delete`. Every submit or fill button, and every favourite prompt, also appears in Codex as a `$ccb-<name>` skill.

**Conflict copies** (a prompt edited on two computers at once): titles ending in "(conflict)". Offer `conflict_resolve` with `keep` set to `copy`, `original` or `both`.
