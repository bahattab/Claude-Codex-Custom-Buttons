// The button row's data (custom buttons, variables, settings) from ccb-mcp. This file
// owns the "client" atom; other modules read and refresh it through these functions.
import { atom, read, update } from "claude-code";
import type { EngineInterface } from "claude-code";

import type { ClientState } from "../types";
import { callTool } from "./mcp.js";

type $ = EngineInterface;

const client = atom({ plugin: "prompt-buttons", key: "client" } as const, null);

/** The last loaded state, or null. Reading it while drawing redraws on change. */
export async function readClient($: $): Promise<ClientState | null> {
  return read($, client);
}

/** Fetches buttons, variables and settings; keeps the last good copy if the server is unavailable. */
export async function refreshClient($: $): Promise<ClientState | null> {
  try {
    const state = await callTool<ClientState>($, "client_state");
    await update($, client, () => state);
    return state;
  } catch {
    return read($, client);
  }
}

/** notes.autosaveMs, or 2 seconds. */
export async function autosaveMs($: $): Promise<number> {
  return (await read($, client))?.settings.notes?.autosaveMs ?? 2000;
}
