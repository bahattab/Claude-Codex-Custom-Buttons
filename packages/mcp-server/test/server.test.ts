import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STARTER_PROMPTS } from "@ccb/core";
import { LibraryStore, noteFileName } from "@ccb/store";
import { createServer } from "@ccb/mcp-server";

let home: string;
let client: Client;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ccb-mcp-"));
  const server = createServer(new LibraryStore({ home }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterEach(async () => {
  await client.close();
  await rm(home, { recursive: true, force: true });
});

interface CallResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ data: Record<string, unknown>; raw: CallResult }> {
  const raw = (await client.callTool({ name, arguments: args })) as CallResult;
  const text = raw.content[0]?.text ?? "";
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { message: text };
  }
  return { data, raw };
}

async function callOk(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const { data, raw } = await call(name, args);
  if (raw.isError) throw new Error(`${name} failed: ${raw.content[0]?.text}`);
  return data;
}

async function newPrompt(title = "Daily plan", body = "Plan my day for {{project}} focusing on {{?focus:deep work}}"): Promise<string> {
  const { saved } = (await callOk("bank_save", { title, body, tags: ["Planning"] })) as { saved: { id: string } };
  return saved.id;
}

const ALL_TOOLS = [
  "library_status",
  "bank_search",
  "bank_get",
  "bank_save",
  "bank_delete",
  "bank_list_categories",
  "categories_save",
  "categories_delete",
  "variables_list",
  "variables_set",
  "variables_delete",
  "buttons_list",
  "buttons_save",
  "buttons_delete",
  "notes_list",
  "notes_read",
  "notes_write",
  "notes_append",
  "notes_delete",
  "settings_set_shared",
  "refine_instructions",
];

describe("tool list", () => {
  it("exposes exactly the documented tools, with API-safe names", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL_TOOLS].sort());
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(t.description?.length).toBeGreaterThan(10);
    }
  });

  it("marks read-only and destructive tools", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get("bank_search")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("bank_delete")?.annotations?.destructiveHint).toBe(true);
  });
});

describe("library_status", () => {
  it("reports counts and the device", async () => {
    const data = await callOk("library_status");
    expect(data["counts"]).toMatchObject({ prompts: STARTER_PROMPTS.length, notes: 0, buttons: 0 });
    expect((data["device"] as { deviceId: string }).deviceId).toMatch(/^dev_/);
  });
});

describe("Prompt Bank tools", () => {
  it("bank_save creates and updates; bank_search finds it", async () => {
    const id = await newPrompt();
    await callOk("bank_save", { id, title: "Daily plan v2", body: "Plan v2", favorite: true });
    const { results } = (await callOk("bank_search", { query: "daily" })) as { results: Array<{ id: string; title: string; tags: string[] }> };
    expect(results[0]).toMatchObject({ id, title: "Daily plan v2", tags: ["planning"] });
  });

  it("bank_save rejects invalid input without saving", async () => {
    const { raw } = await call("bank_save", { title: "", body: "x" });
    expect(raw.isError).toBe(true);
    expect(raw.content[0]?.text).toMatch(/title/);
    const { raw: missing } = await call("bank_save", { id: "01JC8Z5K2V9Q4W7E3R6T1Y0U8I", title: "x", body: "y" });
    expect(missing.isError).toBe(true);
  });

  it("bank_search filters by category, tag and favourites", async () => {
    const data = (await callOk("bank_search", { query: "", category: "review" })) as { results: Array<{ title: string }> };
    expect(data.results.map((r) => r.title)).toEqual(["Review for security"]);
    const fav = (await callOk("bank_search", { favoritesOnly: true })) as { results: unknown[] };
    expect(fav.results).toEqual([]);
    const tag = (await callOk("bank_search", { tag: "summary" })) as { results: Array<{ title: string }> };
    expect(tag.results.map((r) => r.title)).toEqual(["Summarise the conversation"]);
  });

  it("bank_get expands variables, answers and built-ins, and records use", async () => {
    await callOk("variables_set", { name: "project", value: "Billing API" });
    const id = await newPrompt();
    const data = (await callOk("bank_get", { id, expand: true, answers: {}, markUsed: true })) as {
      expanded: { text: string };
      askFields: unknown[];
      prompt: { useCount: number };
    };
    expect(data.expanded.text).toBe("Plan my day for Billing API focusing on deep work");
    expect(data.askFields).toEqual([{ name: "focus", default: "deep work" }]);
    expect(data.prompt.useCount).toBe(1);
    const withBuiltIn = (await callOk("bank_get", {
      id: STARTER_PROMPTS[0]!.id,
      expand: true,
      builtIns: { selection: "const a = 1;" },
    })) as { expanded: { text: string } };
    expect(withBuiltIn.expanded.text).toContain("const a = 1;");
  });

  it("bank_get reports an unknown id as an error", async () => {
    const { raw } = await call("bank_get", { id: "nope" });
    expect(raw.isError).toBe(true);
  });

  it("bank_delete removes a prompt from search", async () => {
    const id = await newPrompt("Throwaway", "x");
    await callOk("bank_delete", { id });
    const { results } = (await callOk("bank_search", { query: "throwaway" })) as { results: unknown[] };
    expect(results).toEqual([]);
    expect((await call("bank_delete", { id })).raw.isError).toBe(true);
  });

  it("bank_list_categories counts prompts per category", async () => {
    const data = (await callOk("bank_list_categories")) as { categories: Array<{ id: string; prompts: number }>; uncategorised: number };
    expect(data.categories.find((c) => c.id === "coding")?.prompts).toBe(2);
    expect(data.uncategorised).toBe(0);
  });

  it("categories_save and categories_delete", async () => {
    await callOk("categories_save", { id: "ops", name: "Operations" });
    let data = (await callOk("bank_list_categories")) as { categories: Array<{ id: string; name: string }> };
    expect(data.categories.find((c) => c.id === "ops")?.name).toBe("Operations");
    await callOk("categories_delete", { id: "ops" });
    data = (await callOk("bank_list_categories")) as { categories: Array<{ id: string; name: string }> };
    expect(data.categories.find((c) => c.id === "ops")).toBeUndefined();
    expect((await call("categories_save", { id: "Bad ID!", name: "x" })).raw.isError).toBe(true);
  });
});

describe("variable tools", () => {
  it("variables_set normalises names; variables_list and variables_delete", async () => {
    await callOk("variables_set", { name: "Release Name", value: "Autumn" });
    let data = (await callOk("variables_list")) as { variables: Record<string, string> };
    expect(data.variables["release_name"]).toBe("Autumn");
    await callOk("variables_delete", { name: "release_name" });
    data = (await callOk("variables_list")) as { variables: Record<string, string> };
    expect(data.variables["release_name"]).toBeUndefined();
  });
});

describe("button tools", () => {
  it("buttons_save, buttons_list and buttons_delete", async () => {
    const promptId = await newPrompt();
    await callOk("buttons_save", { id: "btn_plan", label: "Plan", icon: "📅", action: { type: "submit", promptId } });
    await callOk("buttons_save", { id: "btn_notes", label: "Notes", action: { type: "open-pane", pane: "notes" } });
    let { buttons } = (await callOk("buttons_list")) as { buttons: Array<{ id: string; action: unknown; order: number }> };
    expect(buttons.map((b) => [b.id, b.order])).toEqual([["btn_plan", 0], ["btn_notes", 1]]); // new buttons go last
    await callOk("buttons_save", { id: "btn_notes", label: "Notes", action: { type: "open-pane", pane: "notes" }, order: 0 });
    await callOk("buttons_save", { id: "btn_plan", label: "Plan", icon: "📅", action: { type: "submit", promptId }, order: 1 });
    ({ buttons } = (await callOk("buttons_list")) as { buttons: Array<{ id: string; action: unknown; order: number }> });
    expect(buttons.map((b) => b.id)).toEqual(["btn_notes", "btn_plan"]);
    expect(buttons[1]?.action).toEqual({ type: "submit", promptId });
    await callOk("buttons_delete", { id: "btn_plan" });
    expect(((await callOk("buttons_list")) as { buttons: unknown[] }).buttons).toHaveLength(1);
  });

  it("rejects buttons pointing at missing prompts, bad IDs or both promptId and text", async () => {
    expect((await call("buttons_save", { id: "btn_x", label: "X", action: { type: "submit", promptId: "01JC8Z5K2V9Q4W7E3R6T1Y0U8I" } })).raw.isError).toBe(true);
    expect((await call("buttons_save", { id: "nope", label: "X", action: { type: "continue" } })).raw.isError).toBe(true);
    const promptId = await newPrompt();
    expect((await call("buttons_save", { id: "btn_x", label: "X", action: { type: "fill", promptId, text: "a" } })).raw.isError).toBe(true);
  });

  it("refuses an unknown action type such as a shell command", async () => {
    await expect(client.callTool({ name: "buttons_save", arguments: { id: "btn_x", label: "X", action: { type: "shell", command: "rm -rf /" } } })).resolves.toMatchObject({ isError: true });
  });
});

describe("note tools", () => {
  it("notes_write, notes_read, notes_append, notes_list and notes_delete", async () => {
    const { saved } = (await callOk("notes_write", { body: "# Trip\n- passport" })) as { saved: { id: string; title: string } };
    expect(saved.title).toBe("Trip");
    await callOk("notes_append", { id: saved.id, text: "- tickets" });
    const { note } = (await callOk("notes_read", { id: saved.id })) as { note: { body: string } };
    expect(note.body).toBe("# Trip\n- passport\n- tickets");
    await callOk("notes_write", { id: saved.id, body: note.body, pinned: true });
    const { notes } = (await callOk("notes_list")) as { notes: Array<{ id: string; pinned: boolean }> };
    expect(notes).toEqual([expect.objectContaining({ id: saved.id, pinned: true })]);
    await callOk("notes_delete", { id: saved.id });
    expect(((await callOk("notes_list")) as { notes: unknown[] }).notes).toEqual([]);
    expect((await call("notes_read", { id: saved.id })).raw.isError).toBe(true);
    expect((await call("notes_append", { id: saved.id, text: "x" })).raw.isError).toBe(true);
  });

  it("notes_read sees edits made to the Markdown file in another editor", async () => {
    const { saved } = (await callOk("notes_write", { body: "Draft" })) as { saved: { id: string } };
    const file = join(home, "notes", noteFileName({ id: saved.id, title: "Draft" }));
    await writeFile(file, "Draft, edited elsewhere");
    const { utimes } = await import("node:fs/promises");
    const future = new Date(Date.now() + 5000);
    await utimes(file, future, future);
    const { note } = (await callOk("notes_read", { id: saved.id })) as { note: { body: string } };
    expect(note.body).toBe("Draft, edited elsewhere");
  });
});

describe("settings and Regenerate", () => {
  it("refine_instructions returns the built-in instructions or a full request", async () => {
    const plain = await callOk("refine_instructions");
    expect(String(plain["instructions"])).toMatch(/rewrite/i);
    const full = await callOk("refine_instructions", { text: "make it faster", extra: "short" });
    expect(String(full["user"])).toContain("make it faster");
  });

  it("settings_set_shared changes the instructions and the Continue prompt", async () => {
    await callOk("settings_set_shared", { id: "regenerate.instructions", value: "Be brief." });
    expect((await callOk("refine_instructions"))["instructions"]).toBe("Be brief.");
    await callOk("settings_set_shared", { id: "continue.message", value: "Keep going." });
    const p = await client.getPrompt({ name: "ccb-continue" });
    expect(p.messages[0]?.content).toEqual({ type: "text", text: "Keep going." });
    await callOk("settings_set_shared", { id: "regenerate.instructions", value: null });
    expect(String((await callOk("refine_instructions"))["instructions"])).toMatch(/rewrite/i);
  });
});

describe("prompts", () => {
  it("lists Continue, Regenerate and one prompt per Prompt Bank entry", async () => {
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["ccb-continue", "ccb-regenerate", "ccb-explain-this-code"]));
    expect(names).toHaveLength(2 + STARTER_PROMPTS.length);
    const tests = prompts.find((p) => p.name === "ccb-write-tests-for");
    expect(tests?.arguments).toEqual([{ name: "framework", description: "Default: the project's existing", required: false }]);
  });

  it("reflects new prompts and fills arguments and variables", async () => {
    await callOk("variables_set", { name: "project", value: "Billing API" });
    await newPrompt();
    const { prompts } = await client.listPrompts();
    const plan = prompts.find((p) => p.name === "ccb-daily-plan");
    expect(plan?.arguments).toEqual([{ name: "focus", description: "Default: deep work", required: false }]);
    const result = await client.getPrompt({ name: "ccb-daily-plan", arguments: { focus: "reviews" } });
    expect(result.messages[0]?.content).toEqual({ type: "text", text: "Plan my day for Billing API focusing on reviews" });
  });

  it("keeps names unique when titles collide", async () => {
    await newPrompt("Same", "one");
    await newPrompt("Same", "two");
    const names = (await client.listPrompts()).prompts.map((p) => p.name).filter((n) => n.startsWith("ccb-same"));
    expect(new Set(names).size).toBe(2);
  });

  it("builds a Regenerate prompt from the given text", async () => {
    const result = await client.getPrompt({ name: "ccb-regenerate", arguments: { text: "fix login bug" } });
    const content = result.messages[0]?.content as { text: string };
    expect(content.text).toContain("<prompt>\nfix login bug\n</prompt>");
  });

  it("rejects an unknown prompt name", async () => {
    await expect(client.getPrompt({ name: "ccb-nope" })).rejects.toThrow();
  });
});

describe("as a real process", () => {
  it("starts over stdio and answers tools/list", async () => {
    const bin = join(import.meta.dirname, "..", "dist", "bin.js");
    const transport = new StdioClientTransport({ command: process.execPath, args: [bin], env: { ...process.env, CCB_HOME: home } as Record<string, string> });
    const real = new Client({ name: "spawn-test", version: "0" });
    await real.connect(transport);
    try {
      const { tools } = await real.listTools();
      expect(tools).toHaveLength(ALL_TOOLS.length);
      const status = (await real.callTool({ name: "library_status", arguments: {} })) as CallResult;
      expect(status.isError).toBeFalsy();
    } finally {
      await real.close();
    }
  });
});
