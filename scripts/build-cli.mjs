// Builds the `ccb` command as one file, dist/ccb.mjs, runnable with plain Node 22.12+
// (no npm install). Attached to each release. Run after `npm run build`.
import { build } from "esbuild";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await build({
  entryPoints: [join(root, "packages", "cli", "dist", "bin.js")],
  outfile: join(root, "dist", "ccb.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  keepNames: true,
  legalComments: "inline",
  banner: {
    js: "// ccb, the Claude Codex Custom Buttons command (https://github.com/bahattab/Claude-Codex-Custom-Buttons). Built by scripts/build-cli.mjs.\nimport { createRequire as __ccbCreateRequire } from 'node:module'; const require = __ccbCreateRequire(import.meta.url);",
  },
  logLevel: "warning",
});
console.log("Built dist/ccb.mjs.");
