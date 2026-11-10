// The starter pack added on first run. IDs and timestamps are fixed, so every device
// creates identical records and they never conflict. A starter record the user deleted
// (tombstone present) is not added again.
import { deterministicUlid } from "./ids.js";
import type { Category, Library, Prompt, SyncMeta, Variable } from "./types.js";

const STARTER_TIME = "2026-01-01T00:00:00.000Z";
const STARTER_MS = Date.parse(STARTER_TIME);

function meta(id: string): SyncMeta {
  return { id, updatedAt: STARTER_TIME, updatedBy: "starter", deletedAt: null, ancestors: [] };
}

function prompt(slug: string, title: string, body: string, category: string, tags: string[]): Prompt {
  return {
    ...meta(deterministicUlid(STARTER_MS, `starter/${slug}`)),
    title,
    body,
    category,
    tags,
    favorite: false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: STARTER_TIME,
    conflictOf: null,
  };
}

export const STARTER_CATEGORIES: readonly Category[] = [
  { ...meta("coding"), name: "Coding", order: 1 },
  { ...meta("review"), name: "Review", order: 2 },
  { ...meta("writing"), name: "Writing", order: 3 },
];

export const STARTER_PROMPTS: readonly Prompt[] = [
  prompt(
    "explain-code",
    "Explain this code",
    "Explain what this code does, step by step, for someone new to {{project}}:\n\n{{selection}}",
    "coding",
    ["explain", "code"],
  ),
  prompt(
    "write-tests",
    "Write tests for",
    "Write {{?framework:the project's existing}} tests for {{selection}}. Cover normal cases, edge cases and failures. Match the style of the existing tests.",
    "coding",
    ["tests", "code"],
  ),
  prompt(
    "security-review",
    "Review for security",
    "Review {{selection}} for security issues. List each finding with its severity, why it matters and a concrete fix.",
    "review",
    ["security", "review"],
  ),
  prompt(
    "summarise-conversation",
    "Summarise the conversation",
    "Summarise this conversation so far for {{audience}}: decisions made, open questions and next steps.",
    "writing",
    ["summary"],
  ),
];

export const STARTER_VARIABLES: readonly Variable[] = [
  { ...meta("project"), value: "" },
  { ...meta("language"), value: "" },
  { ...meta("audience"), value: "my team" },
];

function addMissing<T extends SyncMeta>(existing: readonly T[], starters: readonly T[]): T[] {
  const ids = new Set(existing.map((r) => r.id));
  return [...existing, ...starters.filter((s) => !ids.has(s.id))];
}

/** Adds any starter records not already present (live or deleted). */
export function seedStarterPack(library: Library): Library {
  return {
    ...library,
    categories: addMissing(library.categories, STARTER_CATEGORIES),
    prompts: addMissing(library.prompts, STARTER_PROMPTS),
    variables: addMissing(library.variables, STARTER_VARIABLES),
  };
}
