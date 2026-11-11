#!/usr/bin/env node
// Starts ccb-mcp over stdio, and automatic sync while it runs. Diagnostics go to stderr;
// prompt and note text is never logged.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LibraryStore } from "@ccb/store";
import { createSyncEngine } from "@ccb/sync";
import { createServer } from "./server.js";

const store = new LibraryStore();
let lastState = "";
const sync = createSyncEngine(store, {
  onStatus: (status) => {
    // One line per change of state, without data.
    if (status.state !== lastState) process.stderr.write(`ccb-mcp sync: ${status.state}${status.message ? ` (${status.message})` : ""}\n`);
    lastState = status.state;
  },
});
const server = createServer(store, { sync });
server
  .connect(new StdioServerTransport())
  .then(() => sync.start())
  .catch((error: unknown) => {
    process.stderr.write(`ccb-mcp failed to start: ${(error as Error).message}\n`);
    process.exit(1);
  });
