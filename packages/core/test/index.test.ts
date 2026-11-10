import { describe, expect, it } from "vitest";
import { DATA_DIR_NAME, SCHEMA_VERSION } from "../src/index.js";

describe("core constants", () => {
  it("starts at schema version 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("uses the documented data folder", () => {
    expect(DATA_DIR_NAME).toBe(".claude-codex-buttons");
  });
});
