// Self-update for a plugin folder a cloud session loads (CLAUDE_CODE_PLUGIN_DIRS).
//
// A cloud environment's setup script clones the repository to a folder such as /opt/ccb and
// creates the file ".ccb-auto-update" at the top of that clone. The machine can be prepared
// before a session starts, so the clone may be older than the repository. At each session
// start the mod pulls the clone; the session watches the folder and reloads the plugin when
// its files change, so the new version takes over once the turn ends. Without the marker
// file (a developer's working copy, a marketplace install) nothing is pulled.
import type { EngineInterface } from "claude-code";

type $ = EngineInterface;

/** The file, at the top of the clone, that turns self-update on. */
export const AUTO_UPDATE_MARKER = ".ccb-auto-update";

/** Where the clone's top is: the plugin folder is <clone>/plugins/claude. */
export function cloneRoot(pluginRoot: string): string {
  return pluginRoot.replace(/[\\/]+$/, "").replace(/[\\/]plugins[\\/]claude$/, "");
}

/**
 * Pulls the clone when it is marked for self-update. Resolves "updated", "current",
 * "off" (no marker) or "failed" (offline, not a fast-forward, git missing); never throws.
 */
export async function selfUpdate($: $): Promise<"updated" | "current" | "off" | "failed"> {
  const root = cloneRoot($.plugin.root);
  try {
    await $.fs.read(`${root}/${AUTO_UPDATE_MARKER}`);
  } catch {
    return "off";
  }
  try {
    const before = await $.process.run(["git", "-C", root, "rev-parse", "HEAD"], { timeoutMs: 10_000 });
    const pull = await $.process.run(["git", "-C", root, "pull", "--ff-only", "-q"], { timeoutMs: 60_000 });
    if (pull.exitCode !== 0) return "failed";
    const after = await $.process.run(["git", "-C", root, "rev-parse", "HEAD"], { timeoutMs: 10_000 });
    return before.stdout.trim() !== after.stdout.trim() ? "updated" : "current";
  } catch {
    return "failed";
  }
}
