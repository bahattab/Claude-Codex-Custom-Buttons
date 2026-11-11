import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyLibrary, saveButton, savePrompt, setVariable, type Library } from "@ccb/core";
import { CODEX_MARKER, codexHome, codexSkills, writeCodexSkills } from "@ccb/store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccb-codex-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ctx = { now: "2026-11-11T09:00:00.000Z", deviceId: "dev_aaaaaa1" };
let n = 0;
const rnd = () => ((n = (n * 9301 + 49297) % 233280) / 233280);

function ok<T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
}

function library(): { lib: Library; standup: string } {
  let lib = emptyLibrary();
  lib = ok(setVariable(lib, "project", "Billing API", ctx)).library;
  const s = ok(savePrompt(lib, { title: "Standup", body: "Write my standup for {{project}} about {{?topic}} on {{date}}" }, ctx, rnd));
  lib = s.library;
  lib = ok(savePrompt(lib, { title: "Review code", body: "Review {{selection}} carefully", favorite: true }, ctx, rnd)).library;
  lib = ok(savePrompt(lib, { title: "Not a favourite", body: "x" }, ctx, rnd)).library;
  lib = ok(saveButton(lib, { id: "btn_standup", label: "Standup", action: { type: "submit", promptId: s.record.id } }, ctx)).library;
  lib = ok(saveButton(lib, { id: "btn_hello", label: "Hello", action: { type: "fill", text: "Say hello to {{?name:the team}}", mode: "append" } }, ctx)).library;
  lib = ok(saveButton(lib, { id: "btn_go", label: "Go", action: { type: "continue" } }, ctx)).library;
  lib = ok(saveButton(lib, { id: "btn_notes", label: "Notes", action: { type: "open-pane", pane: "notes" } }, ctx)).library;
  return { lib, standup: s.record.id };
}

function frontmatter(content: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (!m) throw new Error("no frontmatter");
  const out: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const kv = /^(\w+): (.*)$/.exec(line);
    if (kv?.[1] && kv[2] !== undefined) out[kv[1]] = kv[2].startsWith('"') ? (JSON.parse(kv[2]) as string) : kv[2];
  }
  return out;
}

describe("Codex skills from buttons and favourite prompts", () => {
  it("makes one skill per submit/fill button and favourite, with variables filled in and asks as $1, $2", () => {
    const { lib } = library();
    const skills = codexSkills(lib);
    expect(skills.map((s) => s.name)).toEqual(["ccb-standup", "ccb-hello", "ccb-review-code"]);
    const standup = skills[0]?.content ?? "";
    expect(standup).toContain("Write my standup for Billing API about <value 1: topic> on (today's date)");
    expect(frontmatter(standup)["description"]).toMatch(/Asks for: value 1 = topic/);
    expect(standup).not.toMatch(/\$ARGUMENTS|\$1/); // Codex doesn't substitute these in skills
    expect(standup).toContain(CODEX_MARKER);
    const hello = skills[1]?.content ?? "";
    expect(frontmatter(hello)["description"]).toContain("value 1 = name (default: the team)");
    expect(skills[2]?.content).toContain("Review (the text the user selected or pasted) carefully");
    for (const s of skills) {
      const fm = frontmatter(s.content);
      expect(fm["name"]).toBe(s.name);
      expect(s.name.length).toBeLessThanOrEqual(64);
      expect((fm["description"] ?? "").length).toBeGreaterThan(0);
      expect(fm["description"]).not.toContain("\n");
    }
  });

  it("never takes a built-in skill's name, and keeps names unique", () => {
    let { lib } = library();
    lib = ok(savePrompt(lib, { title: "Notes", body: "a", favorite: true }, ctx, rnd)).library;
    lib = ok(savePrompt(lib, { title: "Standup", body: "b", favorite: true }, ctx, rnd)).library;
    const names = codexSkills(lib).map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("ccb-notes-");
    expect(names.some((x) => /^ccb-notes-[0-9a-z]{8}$/.test(x))).toBe(true);
    expect(names.filter((x) => x.startsWith("ccb-standup"))).toHaveLength(2);
  });

  it("writes the skills, removes its own stale ones, and leaves the user's own skills alone", async () => {
    const { lib } = library();
    await mkdir(join(dir, "skills", "ccb-mine"), { recursive: true });
    await writeFile(join(dir, "skills", "ccb-mine", "SKILL.md"), "---\nname: ccb-mine\ndescription: mine\n---\n");
    await mkdir(join(dir, "skills", "ccb-hello"), { recursive: true });
    await writeFile(join(dir, "skills", "ccb-hello", "SKILL.md"), "---\nname: ccb-hello\ndescription: my own hello\n---\n");
    const first = await writeCodexSkills(lib, { home: dir, owner: "/lib/a" });
    expect(first.written.sort()).toEqual(["ccb-review-code", "ccb-standup"]);
    expect(await readFile(join(dir, "skills", "ccb-hello", "SKILL.md"), "utf8")).toContain("my own hello");
    expect((await writeCodexSkills(lib, { home: dir, owner: "/lib/a" })).written).toEqual([]); // unchanged: nothing rewritten
    // Another library on this computer leaves these alone, and they leave its alone.
    const other = await writeCodexSkills({ ...lib, buttons: [], prompts: [] }, { home: dir, owner: "/lib/b" });
    expect(other.removed).toEqual([]);
    await writeFile(join(dir, "skills", "ccb-standup", "notes.txt"), "mine");

    const fewer = { ...lib, buttons: lib.buttons.map((b) => (b.id === "btn_standup" ? { ...b, deletedAt: ctx.now } : b)) };
    const second = await writeCodexSkills(fewer, { home: dir, owner: "/lib/a" });
    expect(second.removed).toEqual(["ccb-standup"]);
    expect(await readdir(join(dir, "skills", "ccb-standup"))).toEqual(["notes.txt"]); // the user's file stays
    expect((await readdir(join(dir, "skills"))).sort()).toEqual(["ccb-hello", "ccb-mine", "ccb-review-code", "ccb-standup"]);
  });

  it("writes automatically only when the Codex plugin is installed", async () => {
    const { lib } = library();
    expect((await writeCodexSkills(lib, { home: join(dir, "nope"), onlyIfInstalled: true })).skipped).toBe(true);
    expect((await writeCodexSkills(lib, { home: dir, onlyIfInstalled: true })).skipped).toBe(true); // Codex, but not our plugin
    await mkdir(join(dir, "plugins", "cache", "ccb-codex"), { recursive: true });
    expect((await writeCodexSkills(lib, { home: dir, onlyIfInstalled: true })).skipped).toBe(false);
    await rm(join(dir, "plugins"), { recursive: true });
    await writeFile(join(dir, "config.toml"), '[plugins."prompt-buttons-codex@ccb-codex"]\nenabled = true\n');
    expect((await writeCodexSkills(lib, { home: dir, onlyIfInstalled: true })).skipped).toBe(false);
    expect(codexHome({ CODEX_HOME: "/x/y" })).toBe("/x/y");
    expect(codexHome({})).toMatch(/\.codex$/);
  });

  it("never splits an emoji when shortening a title", () => {
    let lib = emptyLibrary();
    lib = ok(savePrompt(lib, { title: `${"x".repeat(79)}🚀 launch`, body: "b", favorite: true }, ctx, rnd)).library;
    const skill = codexSkills(lib)[0]?.content ?? "";
    const short = /short-description: (.*)/.exec(skill)?.[1] ?? "";
    expect(JSON.parse(short)).toBe(`${"x".repeat(79)}🚀`);
    expect(skill).not.toMatch(/\\ud83d"/);
  });
});
