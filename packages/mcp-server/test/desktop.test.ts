// The Claude Desktop extension (desktop-extension/): its manifest agrees with the server,
// the plugins and the MCPB v0.4 schema. `npm run build:desktop` packs it with the official
// MCPB tool (also run in CI).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { resolveHome } from "@ccb/store";
import { SERVER_VERSION } from "@ccb/mcp-server";

const root = join(import.meta.dirname, "..", "..", "..");
const read = async (...p: string[]): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(root, ...p), "utf8")) as Record<string, unknown>;

describe("Claude Desktop extension manifest", () => {
  it("passes the MCPB v0.4 schema", async () => {
    const schema = await read("node_modules", "@anthropic-ai", "mcpb", "dist", "mcpb-manifest-v0.4.schema.json");
    const manifest = await read("desktop-extension", "manifest.json");
    const ajv = new Ajv({ strict: false, validateFormats: false });
    const ok = ajv.validate(schema, manifest);
    expect(ajv.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it("lists exactly the server's tools, runs the bundled server, and generates prompts at run time", async () => {
    const manifest = await read("desktop-extension", "manifest.json");
    const source = await readFile(join(root, "packages", "mcp-server", "src", "server.ts"), "utf8");
    const tools = [...source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect((manifest["tools"] as Array<{ name: string }>).map((t) => t.name).sort()).toEqual(tools);
    expect(manifest["prompts_generated"]).toBe(true);
    const server = manifest["server"] as { entry_point: string; mcp_config: { command: string; args: string[]; env: Record<string, string> } };
    expect(server.entry_point).toBe("server/ccb-mcp.mjs");
    expect(server.mcp_config.args).toEqual(["${__dirname}/server/ccb-mcp.mjs"]);
    expect(server.mcp_config.env["CCB_HOME"]).toBe("${user_config.data_folder}");
    expect((manifest["privacy_policies"] as string[])[0]).toMatch(/docs\/privacy-policy\.md$/);
  });

  it("has the same version as the server and both plugins", async () => {
    const manifest = await read("desktop-extension", "manifest.json");
    expect(manifest["version"]).toBe(SERVER_VERSION);
    expect((await read("plugins", "claude", ".claude-plugin", "plugin.json"))["version"]).toBe(SERVER_VERSION);
    expect((await read("plugins", "codex", ".codex-plugin", "plugin.json"))["version"]).toBe(SERVER_VERSION);
  });

  it("an empty optional data folder falls back to the usual one", () => {
    expect(resolveHome({ CCB_HOME: "" })).toMatch(/\.claude-codex-buttons$/);
    expect(resolveHome({ CCB_HOME: "${user_config.data_folder}" })).toMatch(/\.claude-codex-buttons$/);
    expect(resolveHome({ CCB_HOME: "/data/ccb" })).toBe("/data/ccb");
  });
});
