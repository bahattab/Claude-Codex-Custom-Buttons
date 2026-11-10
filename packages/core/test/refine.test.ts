import { describe, expect, it } from "vitest";
import {
  REFINE_INSTRUCTIONS,
  buildRefineRequest,
  cleanRefineOutput,
  missingFragments,
  protectedFragments,
} from "../src/index.js";

describe("buildRefineRequest", () => {
  it("uses the built-in instructions and wraps the source", () => {
    const r = buildRefineRequest("make it faster");
    expect(r.system).toBe(REFINE_INSTRUCTIONS);
    expect(r.user).toContain("<prompt>\nmake it faster\n</prompt>");
  });

  it("uses custom instructions and appends the extra instruction", () => {
    const r = buildRefineRequest("x", { instructions: "Be brief.", extra: "keep it short" });
    expect(r.system).toBe("Be brief.");
    expect(r.user).toContain("Additional instruction from the user: keep it short");
  });

  it("falls back to built-in instructions when the custom ones are blank", () => {
    expect(buildRefineRequest("x", { instructions: "  " }).system).toBe(REFINE_INSTRUCTIONS);
  });
});

describe("cleanRefineOutput", () => {
  it("removes a wrapping code fence or quotes", () => {
    expect(cleanRefineOutput("```\nRewritten prompt\n```")).toBe("Rewritten prompt");
    expect(cleanRefineOutput('"Rewritten prompt"')).toBe("Rewritten prompt");
  });

  it("keeps fences that are part of the prompt", () => {
    const text = "Fix this:\n```js\nlet a = 1\n```";
    expect(cleanRefineOutput(text)).toBe(text);
  });
});

describe("protected fragments", () => {
  const source = [
    "fix the bug in src/api/users.ts so GET https://api.example.com/v2/users returns 200 within 150 ms",
    "use `retryCount` and keep C:\\work\\app\\config.json unchanged",
    "```ts\nconst limit = 25;\n```",
  ].join("\n");

  it("finds code, URLs, paths and numbers", () => {
    const found = protectedFragments(source);
    expect(found).toEqual(
      expect.arrayContaining([
        "src/api/users.ts",
        "https://api.example.com/v2/users",
        "200",
        "150",
        "retryCount",
        "C:\\work\\app\\config.json",
        "const limit = 25;",
      ]),
    );
  });

  it("reports what a rewrite dropped", () => {
    const rewritten =
      "Fix the bug in src/api/users.ts so that GET https://api.example.com/v2/users returns 200 within 150 ms. " +
      "Use `retryCount`. Keep C:\\work\\app\\config.json unchanged.\n```ts\nconst limit = 25;\n```";
    expect(missingFragments(source, rewritten)).toEqual([]);
    expect(missingFragments(source, rewritten.replace("150", "a short time"))).toEqual(["150"]);
  });
});
