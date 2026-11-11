---
name: regenerate-prompt
description: "Rewrite a prompt so it is clearer and more specific, keeping its meaning, code, paths and numbers. Use when the user asks to regenerate, improve, refine or rewrite a prompt."
metadata:
  short-description: "Improve a prompt"
---

The prompt to rewrite is the text after the skill's name: $ARGUMENTS
If that is empty, use the user's previous message.

1. Call the `ccb` MCP tool `refine_instructions` with `text` set to that prompt (and `extra` set to any extra instruction the user gave, such as "make it shorter"). It returns the rewriting instructions (`system`) and the request to rewrite (`user`).
2. Follow those instructions yourself to produce the rewritten prompt. Don't answer the prompt: only rewrite it.
3. Check that every code block, file path, URL and number in the original is still in the rewrite; put back anything missing.
4. Show the rewritten prompt in one code block, then ask: "Send this as your next message?" If the user says yes, carry it out as their request.

If the `ccb` tools aren't available, rewrite it with these rules: keep the intent, make the goal, context, constraints and expected output explicit, keep all code, paths and numbers, and don't add requirements the user didn't ask for.
