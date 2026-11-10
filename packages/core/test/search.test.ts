import { describe, expect, it } from "vitest";
import { searchPrompts, type Prompt } from "../src/index.js";
import { at, ctx, newPrompt } from "./helpers.js";

function p(title: string, over: Partial<Prompt> = {}): Prompt {
  return { ...newPrompt(ctx("dev_laptop01", 0), title), ...over };
}

const prompts = [
  p("Review for security", { tags: ["security", "review"], body: "Find vulnerabilities" }),
  p("Explain this code", { tags: ["code"], body: "Explain step by step" }),
  p("Write tests", { tags: ["tests"], body: "Cover security edge cases", favorite: true }),
  p("Old deleted", { deletedAt: at(1), body: "security" }),
  p("Résumé helper", { category: "writing", body: "Polish a résumé" }),
];

const titles = (hits: ReturnType<typeof searchPrompts>): string[] => hits.map((h) => h.prompt.title);

describe("searchPrompts", () => {
  it("ranks title matches above body matches and skips deleted prompts", () => {
    expect(titles(searchPrompts(prompts, "security"))).toEqual(["Review for security", "Write tests"]);
  });

  it("requires every word to match somewhere", () => {
    expect(titles(searchPrompts(prompts, "explain step"))).toEqual(["Explain this code"]);
    expect(searchPrompts(prompts, "explain nonsense")).toHaveLength(0);
  });

  it("ignores case and accents", () => {
    expect(titles(searchPrompts(prompts, "RESUME"))).toEqual(["Résumé helper"]);
  });

  it("filters by category, tag and favourites", () => {
    expect(titles(searchPrompts(prompts, "", { category: "writing" }))).toEqual(["Résumé helper"]);
    expect(titles(searchPrompts(prompts, "", { tag: "Code" }))).toEqual(["Explain this code"]);
    expect(titles(searchPrompts(prompts, "", { favoritesOnly: true }))).toEqual(["Write tests"]);
  });

  it("lists favourites and recently used first for an empty query", () => {
    const list = [p("B plain"), p("A recent", { lastUsedAt: at(0) }), p("C fav", { favorite: true })];
    expect(titles(searchPrompts(list, "", { now: at(60) }))).toEqual(["C fav", "A recent", "B plain"]);
  });

  it("can include deleted prompts and limit results", () => {
    expect(searchPrompts(prompts, "security", { includeDeleted: true })).toHaveLength(3);
    expect(searchPrompts(prompts, "", { limit: 2 })).toHaveLength(2);
  });

  it("searches 1,000 prompts quickly", () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      p(`Prompt number ${i}`, { tags: [`tag${i % 20}`], body: `Body text ${i} with some words about topic ${i % 50}` }),
    );
    const runs = 20;
    const start = performance.now();
    for (let i = 0; i < runs; i++) searchPrompts(many, "topic 7 words");
    const average = (performance.now() - start) / runs;
    // Target is under 50 ms (docs/roadmap.md M1); allow headroom for slow CI machines.
    expect(average).toBeLessThan(100);
  });
});
