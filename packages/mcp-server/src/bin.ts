#!/usr/bin/env node
// Starts ccb-mcp over stdio, and automatic sync while it runs. Diagnostics go to stderr;
// prompt and note text is never logged.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LibraryStore, writeCodexSkills } from "@ccb/store";
import { createSyncEngine } from "@ccb/sync";
import { createServer } from "./server.js";

const store = new LibraryStore();
let lastState = "";
// eslint-disable-next-line prefer-const -- assigned below; onStatus needs it later
let server: ReturnType<typeof createServer> | undefined;
const sync = createSyncEngine(store, {
  onStatus: (status, { merged }) => {
    // One line per change of state, without data.
    if (status.state !== lastState) process.stderr.write(`ccb-mcp sync: ${status.state}${status.message ? ` (${status.message})` : ""}\n`);
    lastState = status.state;
    // Prompts may have arrived from another computer: let clients refresh their prompt list.
    if (merged && server?.isConnected()) server.sendPromptListChanged();
    // ...and keep Codex's $ccb-* skills in step (codex.autoSync).
    if (merged) {
      void store
        .read()
        .then(({ library }) => (library?.settings.codex.autoSync ? writeCodexSkills(library, { onlyIfInstalled: true }) : undefined))
        .catch(() => undefined);
    }
  },
});
server = createServer(store, { sync });
server
  .connect(new StdioServerTransport())
  .then(() => sync.start())
  .catch((error: unknown) => {
    process.stderr.write(`ccb-mcp failed to start: ${(error as Error).message}\n`);
    process.exit(1);
  });
