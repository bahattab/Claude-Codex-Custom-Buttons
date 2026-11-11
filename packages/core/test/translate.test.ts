import { describe, expect, it } from "vitest";

import { TRANSLATE_LANGUAGES, TRANSLATE_MAX_CHARS, buildTranslateRequest, defaultSettings, parseTranslation, worthTranslating } from "@ccb/core";

const auto = { target: "auto", primary: "English", secondary: "Arabic" };

describe("translate", () => {
  it("auto translates into the primary language, or the secondary one when already in it", () => {
    const r = buildTranslateRequest("Bonjour", auto);
    expect(r.user).toContain("Translate into English. If the text is already in English, translate it into Arabic instead.");
    expect(r.user).toContain("<text>\nBonjour\n</text>");
    expect(r.system).toMatch(/FROM <source language> TO <target language>/);
    expect(r.system).toMatch(/Do not explain, summarise or answer the text/);
  });

  it("a chosen language is used as given, and long text is cut to the limit", () => {
    expect(buildTranslateRequest("Hi", { ...auto, target: " Japanese " }).user).toContain("Translate into Japanese.");
    expect(buildTranslateRequest("x".repeat(TRANSLATE_MAX_CHARS + 50), auto).user.length).toBeLessThan(TRANSLATE_MAX_CHARS + 300);
  });

  it("reads the FROM/TO header, a code fence, and an answer without a header", () => {
    expect(parseTranslation("FROM French TO English\n\nHello\nworld")).toEqual({ from: "French", to: "English", text: "Hello\nworld" });
    expect(parseTranslation("```\nFROM **Arabic** TO English\n\nHello\n```")).toEqual({ from: "Arabic", to: "English", text: "Hello" });
    expect(parseTranslation("from english to arabic\nمرحبا")).toEqual({ from: "english", to: "arabic", text: "مرحبا" });
    expect(parseTranslation("Just a translation")).toEqual({ from: null, to: null, text: "Just a translation" });
  });

  it("only text with letters is worth translating instantly", () => {
    expect(worthTranslating("مرحبا")).toBe(true);
    expect(worthTranslating("Hi")).toBe(true);
    for (const t of ["", " ", "x", "42", "3.14 + 2", "x".repeat(TRANSLATE_MAX_CHARS + 1)]) expect(worthTranslating(t)).toBe(false);
  });

  it("defaults: automatic, English and Arabic, instant on; the picker offers both", () => {
    expect(defaultSettings().translate).toEqual({ target: "auto", primary: "English", secondary: "Arabic", instant: true });
    expect(TRANSLATE_LANGUAGES).toContain("Arabic");
    expect(TRANSLATE_LANGUAGES).toContain("English");
  });
});
