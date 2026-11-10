#!/usr/bin/env node
// Starts ccb-mcp over stdio. Diagnostics go to stderr; prompt and note text is never logged.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LibraryStore } from "@ccb/store";
import { createServer } from "./server.js";

const server = createServer(new LibraryStore());
server.connect(new StdioServerTransport()).catch((error: unknown) => {
  process.stderr.write(`ccb-mcp failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
