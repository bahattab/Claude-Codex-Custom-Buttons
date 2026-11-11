// Builds the Claude Desktop extension: dist/claude-codex-buttons.mcpb.
// Stages desktop-extension/ (manifest, icon) with the bundled ccb-mcp from the Claude
// plugin (npm run build:plugin), validates the manifest, then packs it with the official
// MCPB tool. Usage: node scripts/build-desktop.mjs [--check]  (--check validates only)
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// Run the MCPB CLI's script with this Node (a .cmd shim can't be run without a shell on Windows).
const mcpb = join(root, "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");
const run = (...args) => execFileSync(process.execPath, [mcpb, ...args], { stdio: "inherit", cwd: root });

run("validate", join(root, "desktop-extension", "manifest.json"));
if (!process.argv.includes("--check")) {
  const stage = join(root, "dist", "desktop");
  await rm(stage, { recursive: true, force: true });
  await mkdir(join(stage, "server"), { recursive: true });
  for (const f of ["manifest.json", "icon.png", ".mcpbignore"]) await copyFile(join(root, "desktop-extension", f), join(stage, f));
  await copyFile(join(root, "plugins", "claude", "server", "ccb-mcp.mjs"), join(stage, "server", "ccb-mcp.mjs"));
  run("pack", stage, join(root, "dist", "claude-codex-buttons.mcpb"));
}
