#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { run } from "./cli.js";

const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
const code = await run(process.argv.slice(2), {
  env: process.env,
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  ...(interactive
    ? {
        ask: async (question: string) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            return await rl.question(question);
          } finally {
            rl.close();
          }
        },
      }
    : {}),
});
process.exitCode = code;
