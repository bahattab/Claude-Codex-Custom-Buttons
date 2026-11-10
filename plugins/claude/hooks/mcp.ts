// Talking to the plugin's bundled ccb-mcp server. No $.state here: atoms must live in
// the file that uses them, so this module only holds plain functions.
import type { EngineInterface } from "claude-code";

/** The plugin's MCP server, by its key in plugin.json. */
export const SERVER_KEY = "ccb";

type $ = EngineInterface;

let serverName: string | null = null;

/** The name $.mcp.call takes for the plugin's own server, connecting it if needed. */
export async function server($: $): Promise<string> {
  if (serverName) return serverName;
  const connected = (await $.mcp.connect(SERVER_KEY)) as { isConnected?: boolean; server?: string; message?: string };
  if (!connected.isConnected || !connected.server) throw new Error(connected.message ?? "ccb-mcp is not connected");
  serverName = connected.server;
  return serverName;
}

/** Calls a ccb-mcp tool and parses its JSON answer. Throws with the server's message on error. */
export async function callTool<T>($: $, tool: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await $.mcp.call(await server($), tool, args);
  const text = result.content
    .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
    .join("");
  if (result.isError) throw new Error(text || `${tool} failed`);
  return JSON.parse(text) as T;
}

/** The user's last message in this conversation that has text. */
export async function lastUserMessage($: $): Promise<string> {
  const messages = await $.session.messages();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user" && m.text.trim() !== "") return m.text;
  }
  return "";
}

/** Values for built-in {{variables}} this surface knows right now. */
export async function builtIns($: $, dateValues: Record<string, string>): Promise<Record<string, string>> {
  const values: Record<string, string> = { ...dateValues };
  const selection = await $.ui.selection();
  if (selection?.text) values["selection"] = selection.text;
  const draft = (await $.prompt.read()).text;
  if (draft) values["draft"] = draft;
  const last = await lastUserMessage($);
  if (last) values["last_prompt"] = last;
  return values;
}

/** An error message fit for a toast. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
