// The plugin ships ccb-mcp as one bundled file. It must run with plain Node from a folder
// that has no node_modules, exactly as an installed plugin does.
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

describe("bundled ccb-mcp in the Claude plugin", () => {
  it("runs from an isolated folder and answers tools and calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ccb-bundle-"));
    const home = await mkdtemp(join(tmpdir(), "ccb-bundle-home-"));
    try {
      const bundle = join(dir, "ccb-mcp.mjs");
      await copyFile(join(import.meta.dirname, "..", "..", "..", "plugins", "claude", "server", "ccb-mcp.mjs"), bundle);
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [bundle],
        cwd: dir,
        env: { PATH: process.env["PATH"] ?? "", CCB_HOME: home },
      });
      const client = new Client({ name: "bundle-test", version: "0" });
      await client.connect(transport);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toContain("client_state");
        const state = (await client.callTool({ name: "client_state", arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> };
        expect(state.isError).toBeFalsy();
        expect(JSON.parse(state.content[0]!.text).continueMessage).toMatch(/Continue/);
      } finally {
        await client.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});
