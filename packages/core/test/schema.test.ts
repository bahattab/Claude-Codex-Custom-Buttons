import { describe, expect, it } from "vitest";
import {
  cleanText,
  defaultSettings,
  deriveNoteTitle,
  emptyLibrary,
  newDeviceId,
  validateDeviceFile,
  validateLibrary,
  validateRecord,
} from "../src/index.js";
import { at, ctx, newNote, newPrompt, seededRandom } from "./helpers.js";

const ch = (code: number): string => String.fromCharCode(code);

describe("cleanText", () => {
  it("removes hidden control and direction-override characters", () => {
    const dirty = `a${ch(0)}b${ch(0x7f)}c${ch(0xfeff)}d${ch(0x202e)}e${ch(0x9f)}f`;
    expect(cleanText(dirty)).toBe("abcdef");
  });

  it("keeps tabs, newlines, zero-width joiners and right-to-left marks", () => {
    const text = `x\ty\nz${ch(0x200d)}${ch(0x200f)}${ch(0x200c)}`;
    expect(cleanText(text)).toBe(text);
  });

  it("normalises Windows line endings", () => {
    expect(cleanText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("keeps Arabic text intact", () => {
    const arabic = "مرحبا بالعالم";
    expect(cleanText(arabic)).toBe(arabic);
  });
});

describe("validateLibrary", () => {
  it("accepts an empty library and fills default settings", () => {
    const result = validateLibrary({ schemaVersion: 1, revision: 0 });
    expect(result).toEqual({ ok: true, value: emptyLibrary() });
  });

  it("rejects a non-object and a wrong schema version", () => {
    expect(validateLibrary(null).ok).toBe(false);
    expect(validateLibrary({ schemaVersion: 2 }).ok).toBe(false);
  });

  it("keeps explicit settings and fills only the missing ones", () => {
    const result = validateLibrary({
      schemaVersion: 1,
      settings: { regenerate: { autoSubmit: true }, sync: { intervalSeconds: 120 } },
    });
    expect(result.ok && result.value.settings.regenerate).toEqual({ autoSubmit: true, source: "auto" });
    expect(result.ok && result.value.settings.sync.intervalSeconds).toBe(120);
    expect(result.ok && result.value.settings.sync.mode).toBe(defaultSettings().sync.mode);
  });

  it("rejects out-of-range settings", () => {
    const result = validateLibrary({ schemaVersion: 1, settings: { sync: { intervalSeconds: 5 } } });
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate record IDs", () => {
    const p = newPrompt(ctx("dev_laptop01", 0), "One");
    const result = validateLibrary({ schemaVersion: 1, prompts: [p, p] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join()).toMatch(/duplicate id/);
  });

  it("drops unknown fields", () => {
    const p = { ...newPrompt(ctx("dev_laptop01", 0), "One"), surprise: 1 };
    const result = validateLibrary({ schemaVersion: 1, prompts: [p] });
    expect(result.ok && "surprise" in result.value.prompts[0]!).toBe(false);
  });
});

describe("validateRecord: prompts", () => {
  const base = newPrompt(ctx("dev_laptop01", 0), "Title");

  it("normalises tags: trimmed, lowercased, unique", () => {
    const result = validateRecord("prompts", { ...base, tags: [" Security ", "security", "Code"] });
    expect(result.ok && result.value.tags).toEqual(["security", "code"]);
  });

  it("enforces title and body limits", () => {
    expect(validateRecord("prompts", { ...base, title: "" }).ok).toBe(false);
    expect(validateRecord("prompts", { ...base, title: "x".repeat(121) }).ok).toBe(false);
    expect(validateRecord("prompts", { ...base, body: "x".repeat(20_001) }).ok).toBe(false);
  });

  it("keeps an empty string as given instead of replacing it with a default", () => {
    const result = validateRecord("prompts", { ...base, category: null });
    expect(result.ok && result.value.category).toBeNull();
  });

  it("requires a ULID id and a valid device in updatedBy", () => {
    expect(validateRecord("prompts", { ...base, id: "not-a-ulid" }).ok).toBe(false);
    expect(validateRecord("prompts", { ...base, updatedBy: "someone" }).ok).toBe(false);
  });

  it("fills missing optional fields", () => {
    const { favorite: _f, useCount: _u, tags: _t, ...minimal } = base;
    const result = validateRecord("prompts", minimal);
    expect(result.ok && result.value).toMatchObject({ favorite: false, useCount: 0, tags: [] });
  });
});

describe("validateRecord: other collections", () => {
  const meta = { updatedAt: at(0), updatedBy: "dev_laptop01", deletedAt: null, ancestors: [] };

  it("normalises variable names", () => {
    const result = validateRecord("variables", { ...meta, id: "Project-Name", value: "x" });
    expect(result.ok && result.value.id).toBe("project_name");
  });

  it("validates button actions", () => {
    const ok = validateRecord("buttons", {
      ...meta,
      id: "btn_review",
      label: "Review",
      icon: "🛡️",
      action: { type: "fill", text: "Hello", mode: "append" },
      order: 1,
    });
    expect(ok.ok).toBe(true);
    const both = validateRecord("buttons", {
      ...meta,
      id: "btn_x",
      label: "X",
      action: { type: "submit", text: "a", promptId: "01JC8Z5K2V9Q4W7E3R6T1Y0U8I" },
    });
    expect(both.ok).toBe(false);
    const unknownType = validateRecord("buttons", { ...meta, id: "btn_x", label: "X", action: { type: "shell" } });
    expect(unknownType.ok).toBe(false);
  });

  it("derives a note title from its first line when missing", () => {
    const n = newNote(ctx("dev_laptop01", 0), "x");
    const { title: _t, ...noTitle } = n;
    const result = validateRecord("notes", { ...noTitle, body: "\n# Release checklist\n- one" });
    expect(result.ok && result.value.title).toBe("Release checklist");
    expect(deriveNoteTitle("")).toBe("Untitled note");
  });

  it("accepts long notes up to the limit", () => {
    const n = newNote(ctx("dev_laptop01", 0), "x");
    expect(validateRecord("notes", { ...n, body: "x".repeat(200_000) }).ok).toBe(true);
    expect(validateRecord("notes", { ...n, body: "x".repeat(200_001) }).ok).toBe(false);
  });

  it("accepts only known shared settings", () => {
    expect(validateRecord("sharedSettings", { ...meta, id: "continue.message", value: "Go on" }).ok).toBe(true);
    expect(validateRecord("sharedSettings", { ...meta, id: "sync.mode", value: "off" }).ok).toBe(false);
  });
});

describe("validateDeviceFile", () => {
  it("accepts a valid device file and rejects a bad device ID", () => {
    const file = { format: "ccb-device/1", schemaVersion: 1, deviceId: "dev_laptop01", deviceName: "Laptop", syncedAt: at(0) };
    expect(validateDeviceFile(file).ok).toBe(true);
    expect(validateDeviceFile({ ...file, deviceId: "laptop" }).ok).toBe(false);
    expect(validateDeviceFile({ ...file, format: "other" }).ok).toBe(false);
  });
});

describe("newDeviceId", () => {
  it("makes IDs in the documented format", () => {
    expect(newDeviceId(seededRandom(1))).toMatch(/^dev_[a-z0-9]{12}$/);
  });
});
