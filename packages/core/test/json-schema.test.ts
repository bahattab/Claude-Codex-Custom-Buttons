// Checks schema/library.schema.json agrees with the core validators on the stored form.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  emptyLibrary,
  seedStarterPack,
  toDeviceFile,
  validateDeviceFile,
  validateLibrary,
  type Library,
} from "../src/index.js";
import { at, ctx, newNote, newPrompt } from "./helpers.js";

const schema = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "schema", "library.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
ajv.addSchema(schema);
const validLibrary = ajv.getSchema(schema.$id)!;
const validDevice = ajv.getSchema(`${schema.$id}#/$defs/deviceFile`)!;

function fullLibrary(): Library {
  const c = ctx("dev_laptop01", 0);
  const seeded = seedStarterPack(emptyLibrary());
  return {
    ...seeded,
    revision: 3,
    prompts: [...seeded.prompts, { ...newPrompt(c, "Mine"), tags: ["a", "b"], favorite: true, lastUsedAt: at(1) }],
    notes: [newNote(c, "# Checklist\n- one"), { ...newNote(c, "Deleted"), deletedAt: at(2) }],
    buttons: [
      { id: "btn_a", label: "A", icon: "🛡️", action: { type: "fill", text: "x", mode: "append" }, order: 0, updatedAt: at(0), updatedBy: "dev_laptop01", deletedAt: null, ancestors: [] },
      { id: "btn_b", label: "B", icon: null, action: { type: "insert-prompt", category: null, search: "tests" }, order: 1, updatedAt: at(0), updatedBy: "dev_laptop01", deletedAt: null, ancestors: [] },
      { id: "btn_c", label: "C", icon: null, action: { type: "open-pane", pane: "notes" }, order: 2, updatedAt: at(0), updatedBy: "dev_laptop01", deletedAt: null, ancestors: [] },
    ],
    sharedSettings: [{ id: "continue.message", value: "Go on", updatedAt: at(0), updatedBy: "dev_laptop01", deletedAt: null, ancestors: ["0123456789abcdef0123456789ab"] }],
  };
}

describe("JSON Schema agrees with the core validators", () => {
  it("accepts what the validators produce", () => {
    const result = validateLibrary(fullLibrary());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validLibrary(result.value), JSON.stringify(validLibrary.errors)).toBe(true);
    expect(validLibrary(emptyLibrary())).toBe(true);
  });

  it("accepts device files the validators accept", () => {
    const lib = fullLibrary();
    const file = toDeviceFile(lib, { deviceId: "dev_laptop01", deviceName: "Laptop", now: at(5) });
    expect(validateDeviceFile(file).ok).toBe(true);
    expect(validDevice(file), JSON.stringify(validDevice.errors)).toBe(true);
  });

  const broken: Array<[string, (l: Library) => unknown]> = [
    ["wrong schema version", (l) => ({ ...l, schemaVersion: 2 })],
    ["empty prompt title", (l) => ({ ...l, prompts: [{ ...l.prompts[0]!, title: "" }] })],
    ["bad ULID", (l) => ({ ...l, prompts: [{ ...l.prompts[0]!, id: "nope" }] })],
    ["bad timestamp", (l) => ({ ...l, notes: [{ ...l.notes[0]!, updatedAt: "yesterday" }] })],
    ["unknown button action", (l) => ({ ...l, buttons: [{ ...l.buttons[0]!, action: { type: "shell" } }] })],
    ["bad variable name", (l) => ({ ...l, variables: [{ ...l.variables[0]!, id: "1abc" }] })],
    ["unknown shared setting", (l) => ({ ...l, sharedSettings: [{ ...l.sharedSettings[0]!, id: "sync.mode" }] })],
    ["out-of-range setting", (l) => ({ ...l, settings: { ...l.settings, buttons: { maxVisible: 99, showBuiltIns: true } } })],
    ["bad ancestor hash", (l) => ({ ...l, notes: [{ ...l.notes[0]!, ancestors: ["xyz"] }] })],
  ];

  for (const [name, breakIt] of broken) {
    it(`both reject: ${name}`, () => {
      const doc = breakIt(fullLibrary());
      expect(validateLibrary(doc).ok).toBe(false);
      expect(validLibrary(doc)).toBe(false);
    });
  }
});
