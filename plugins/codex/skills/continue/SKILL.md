---
name: continue
description: "Continue the previous answer exactly where it stopped, without repeating or summarising. Use when the user says continue, go on, keep going, or the last answer was cut off."
metadata:
  short-description: "Continue the last answer"
---

1. Call the `ccb` MCP tool `client_state` and read `continueMessage`. If the tool isn't available, use: "Continue exactly where you left off. Don't repeat or summarise what you already wrote."
2. Follow that message for your previous answer: pick up at the exact word, line or code block where it stopped. Keep the same format, and finish an open code block before starting anything new.
3. If the previous answer was already complete, say so in one sentence instead of adding to it.

Anything else the user asked for: $ARGUMENTS
