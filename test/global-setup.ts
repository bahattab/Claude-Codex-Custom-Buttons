// Builds every package once before the tests, so tests that start real processes
// (bin files, multi-process locking) run the compiled output.
import { execFileSync } from "node:child_process";

export default function setup(): void {
  execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-b"], { stdio: "inherit" });
}
