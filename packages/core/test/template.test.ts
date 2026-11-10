import { describe, expect, it } from "vitest";
import { askFields, dateBuiltIns, expand, usedVariables } from "../src/index.js";

const ctx = (over: Partial<Parameters<typeof expand>[1]> = {}): Parameters<typeof expand>[1] => ({
  variables: { project: "Billing API" },
  builtIns: { selection: "SELECTED", date: "2026-11-10" },
  answers: {},
  ...over,
});

describe("expand", () => {
  it("fills user variables and built-ins", () => {
    const r = expand("Review {{selection}} in {{project}} on {{date}}", ctx());
    expect(r.text).toBe("Review SELECTED in Billing API on 2026-11-10");
    expect(r.unknown).toEqual([]);
  });

  it("normalises names: case, spaces and hyphens", () => {
    expect(expand("{{ Project }}", ctx()).text).toBe("Billing API");
    expect(expand("{{my-var}}", ctx({ variables: { my_var: "ok" } })).text).toBe("ok");
  });

  it("user variables take precedence over built-ins with the same name", () => {
    expect(expand("{{date}}", ctx({ variables: { date: "mine" } })).text).toBe("mine");
  });

  it("leaves unknown variables as typed and reports them", () => {
    const r = expand("Hello {{nobody}}", ctx());
    expect(r.text).toBe("Hello {{nobody}}");
    expect(r.unknown).toEqual(["nobody"]);
  });

  it("expands unavailable built-ins to empty text and reports them", () => {
    const r = expand("[{{cwd}}]", ctx());
    expect(r.text).toBe("[]");
    expect(r.unavailable).toEqual(["cwd"]);
  });

  it("fills ask fields from answers, then defaults", () => {
    expect(expand("Use {{?framework}}", ctx({ answers: { framework: "Vitest" } })).text).toBe("Use Vitest");
    expect(expand("Use {{?framework:Jest}}", ctx()).text).toBe("Use Jest");
    const r = expand("Use {{?framework}}", ctx());
    expect(r.text).toBe("Use {{?framework}}");
    expect(r.unanswered).toEqual(["framework"]);
  });

  it("keeps escaped braces literal", () => {
    expect(expand("Write \\{{project}} literally", ctx()).text).toBe("Write {{project}} literally");
  });

  it("expands only once, so values can't loop", () => {
    const r = expand("{{a}}", ctx({ variables: { a: "{{a}} {{project}}" } }));
    expect(r.text).toBe("{{a}} {{project}}");
  });

  it("leaves text without variables unchanged", () => {
    const text = "function f() { return {a: 1}; } and {single} braces";
    expect(expand(text, ctx()).text).toBe(text);
  });
});

describe("askFields and usedVariables", () => {
  it("lists ask fields once, in order, with defaults", () => {
    expect(askFields("{{?topic}} {{?Tone:friendly}} {{?topic}} {{project}}")).toEqual([
      { name: "topic", default: null },
      { name: "tone", default: "friendly" },
    ]);
  });

  it("lists used variables without asks or escapes", () => {
    expect(usedVariables("{{project}} {{?topic}} \\{{x}} {{Selection}}")).toEqual(["project", "selection"]);
  });
});

describe("dateBuiltIns", () => {
  it("formats UTC date and time", () => {
    expect(dateBuiltIns(new Date("2026-11-10T07:05:09Z"))).toEqual({ date: "2026-11-10", time: "07:05" });
  });
});
