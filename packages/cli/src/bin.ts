#!/usr/bin/env node
import { run } from "./cli.js";

const code = await run(process.argv.slice(2), {
  env: process.env,
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
});
process.exitCode = code;
