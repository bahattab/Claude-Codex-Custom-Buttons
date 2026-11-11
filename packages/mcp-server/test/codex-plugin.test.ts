// The Codex plugin (plugins/codex): its manifest, MCP config, skills and marketplace entry,
// checked against the rules Codex 0.167 applies (docs/platform-facts.md X1–X12), and its
// bundled server started the way Codex starts it: in the folder `cwd` names, resolved
// against the plugin root (without `cwd`, Codex would use the project's folder).
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const plugin = join(root, "plugins", "codex");
const json = async (path: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

describe("Codex plugin files", () => {
  it("the marketplace lists the plugin by a local path that holds its manifest", async () => {
    const market = await json(join(root, ".agents", "plugins", "marketplace.json"));
    expect(market["name"]).toBe("ccb-codex");
    const entry = (market["plugins"] as Array<{ name: string; source: { source: string; path: string } }>)[0];
    expect(entry).toEqual({ name: "prompt-buttons-codex", source: { source: "local", path: "./plugins/codex" } });
    const manifest = await json(join(root, entry?.source.path ?? "", ".codex-plugin", "plugin.json"));
    expect(manifest["name"]).toBe("prompt-buttons-codex");
    expect(manifest["name"]).not.toMatch(/^claude-/);
  });

  it("the manifest points at ./ paths inside the plugin, and the interface has a display name and prompt", async () => {
    const manifest = await json(join(plugin, ".codex-plugin", "plugin.json"));
    expect(manifest["skills"]).toBe("./skills/");
    expect(manifest["mcpServers"]).toBe("./.mcp.json");
    const ui = manifest["interface"] as Record<string, string>;
    expect(ui["displayName"]).toBeTruthy();
    expect(ui["defaultPrompt"]).toBeTruthy();
    expect(ui["brandColor"]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    const version = (await json(join(root, "plugins", "claude", ".claude-plugin", "plugin.json")))["version"];
    expect(manifest["version"]).toBe(version);
  });

  it(".mcp.json starts the bundled server from the plugin folder (cwd \".\") and passes CODEX_HOME and CCB_HOME", async () => {
    const mcp = (await json(join(plugin, ".mcp.json")))["mcpServers"] as Record<string, { command: string; args: string[]; cwd?: string }>;
    expect(mcp["ccb"]).toEqual({ command: "node", args: ["./server/ccb-mcp.mjs"], cwd: ".", env_vars: ["CODEX_HOME", "CCB_HOME"] });
    // The same bundle as the Claude plugin (npm run check:plugin keeps both up to date).
    const a = await readFile(join(plugin, "server", "ccb-mcp.mjs"), "utf8");
    const b = await readFile(join(root, "plugins", "claude", "server", "ccb-mcp.mjs"), "utf8");
    expect(a).toBe(b);
  });

  it("every skill has front matter Codex accepts: name = folder (at most 64), a one-line description, tool names that exist", async () => {
    const names = (await readdir(join(plugin, "skills"))).sort();
    expect(names).toEqual(["continue", "drive-sync", "notes", "prompt-bank", "regenerate-prompt", "translate"]);
    for (const name of names) {
      const text = await readFile(join(plugin, "skills", name, "SKILL.md"), "utf8");
      // Codex doesn't substitute these in skills (X5), and agents must not run the unrelated npm "ccb".
      expect(text, name).not.toMatch(/\$ARGUMENTS|\$\d|npx ccb/);
    }
    const tools = new Set(
      (await readFile(join(root, "packages", "mcp-server", "src", "server.ts"), "utf8")).match(/registerTool\(\s*"([a-z_]+)"/g)?.map((m) => m.replace(/registerTool\(\s*"/, "").replace(/"$/, "")),
    );
    for (const name of names) {
      const text = await readFile(join(plugin, "skills", name, "SKILL.md"), "utf8");
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
      expect(fm).toContain(`name: ${name}`);
      const description = /^description: (.*)$/m.exec(fm)?.[1] ?? "";
      expect(description.startsWith('"')).toBe(true);
      const value = JSON.parse(description) as string;
      expect(value.length).toBeGreaterThan(20);
      expect(value.length).toBeLessThanOrEqual(1024);
      expect(name.length).toBeLessThanOrEqual(64);
      for (const used of text.match(/`([a-z]+_[a-z_]+)`/g) ?? []) {
        const tool = used.replace(/`/g, "");
        if (/^(bank|notes|variables|buttons|sync|conflict|client|refine|library|categories|settings)_/.test(tool)) expect(tools.has(tool), `${name} uses ${tool}`).toBe(true);
      }
    }
  });
});

describe("bundled ccb-mcp in the Codex plugin", () => {
  it("starts from a copy of the plugin folder, as Codex runs it, and answers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ccb-codex-plugin-"));
    const home = await mkdtemp(join(tmpdir(), "ccb-codex-home-"));
    try {
      await cp(plugin, dir, { recursive: true });
      const config = ((await json(join(dir, ".mcp.json")))["mcpServers"] as Record<string, { args: string[]; cwd: string }>)["ccb"];
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: config?.args ?? [],
        cwd: join(dir, config?.cwd ?? "missing"), // as Codex resolves a relative cwd
        env: { PATH: process.env["PATH"] ?? "", HOME: home, CCB_HOME: home, CODEX_HOME: join(home, "codex") },
      });
      const client = new Client({ name: "codex-plugin-test", version: "0" });
      await client.connect(transport);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["bank_search", "notes_append", "refine_instructions", "sync_status", "conflict_resolve"]));
        const refine = (await client.callTool({ name: "refine_instructions", arguments: { text: "fix bug" } })) as { content: Array<{ text: string }> };
        expect(Object.keys(JSON.parse(refine.content[0]?.text ?? "{}")).sort()).toEqual(["system", "user"]);
      } finally {
        await client.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});
