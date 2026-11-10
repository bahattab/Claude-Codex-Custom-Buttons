// Prompt variables: {{name}}, built-ins, {{?ask}} / {{?ask:default}}, and \{{literal}}.
// Rules: docs/features.md#prompt-variables. Expansion is a single pass: values are never
// expanded again, so a value containing "{{x}}" cannot loop.
import { VARIABLE_NAME_RE, normalizeVariableName } from "./schema.js";

export const BUILT_IN_VARIABLES = ["selection", "draft", "last_prompt", "date", "time", "cwd"] as const;
export type BuiltInVariable = (typeof BUILT_IN_VARIABLES)[number];

// One token: an escaped "\{{", or "{{" + optional "?" + name + optional ":default" + "}}".
const TOKEN_RE = /\\\{\{|\{\{\s*(\?)?\s*([A-Za-z][A-Za-z0-9_ -]{0,63}?)\s*(?::([^}]*?))?\s*\}\}/g;

export interface AskField {
  name: string;
  default: string | null;
}

export interface ExpandContext {
  /** User variables by name. */
  variables: Readonly<Record<string, string>>;
  /** Built-in values available on this platform; a missing key means unavailable here. */
  builtIns: Readonly<Partial<Record<BuiltInVariable, string>>>;
  /** Answers to {{?ask}} fields, by name. */
  answers: Readonly<Record<string, string>>;
}

export interface ExpandResult {
  text: string;
  /** {{names}} that are neither user variables nor built-ins: left as typed. */
  unknown: string[];
  /** Built-ins used but not available on this platform: expanded to "". */
  unavailable: BuiltInVariable[];
  /** {{?asks}} with no answer and no default: left as typed. */
  unanswered: string[];
}

function isBuiltIn(name: string): name is BuiltInVariable {
  return (BUILT_IN_VARIABLES as readonly string[]).includes(name);
}

/** The {{?ask}} fields in a template, in order of first use, without duplicates. */
export function askFields(template: string): AskField[] {
  const fields: AskField[] = [];
  for (const m of template.matchAll(TOKEN_RE)) {
    if (m[0] === "\\{{" || m[1] !== "?" || m[2] === undefined) continue;
    const name = normalizeVariableName(m[2]);
    if (!VARIABLE_NAME_RE.test(name) || fields.some((f) => f.name === name)) continue;
    fields.push({ name, default: m[3] !== undefined ? m[3].trim() : null });
  }
  return fields;
}

/** Every {{name}} (not asks, not escaped) used in a template. */
export function usedVariables(template: string): string[] {
  const names = new Set<string>();
  for (const m of template.matchAll(TOKEN_RE)) {
    if (m[0] === "\\{{" || m[1] === "?" || m[2] === undefined) continue;
    names.add(normalizeVariableName(m[2]));
  }
  return [...names];
}

/** Expands a template once. Never throws; reports what it could not fill. */
export function expand(template: string, ctx: ExpandContext): ExpandResult {
  const unknown = new Set<string>();
  const unavailable = new Set<BuiltInVariable>();
  const unanswered = new Set<string>();

  const text = template.replace(TOKEN_RE, (whole, ask: string | undefined, rawName: string | undefined, def: string | undefined) => {
    if (whole === "\\{{") return "{{";
    if (rawName === undefined) return whole;
    const name = normalizeVariableName(rawName);
    if (!VARIABLE_NAME_RE.test(name)) return whole;

    if (ask === "?") {
      const answer = ctx.answers[name];
      if (answer !== undefined) return answer;
      if (def !== undefined) return def.trim();
      unanswered.add(name);
      return whole;
    }
    const userValue = ctx.variables[name];
    if (userValue !== undefined) return userValue;
    if (isBuiltIn(name)) {
      const value = ctx.builtIns[name];
      if (value !== undefined) return value;
      unavailable.add(name);
      return "";
    }
    unknown.add(name);
    return whole;
  });

  return { text, unknown: [...unknown], unavailable: [...unavailable], unanswered: [...unanswered] };
}

/** Built-in values for date and time, from a timestamp. Other built-ins come from the platform. */
export function dateBuiltIns(now: Date): Pick<Record<BuiltInVariable, string>, "date" | "time"> {
  const iso = now.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
