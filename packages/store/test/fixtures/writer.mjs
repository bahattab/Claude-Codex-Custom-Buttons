// A separate process that makes many small changes to the library at once.
// Usage: node writer.mjs <home> <workerId> <count>
import { setVariable } from "@ccb/core";
import { LibraryStore } from "../../dist/index.js";

const [home, workerId, count] = process.argv.slice(2);
const store = new LibraryStore({ home, lock: { timeoutMs: 60_000 } });
for (let i = 0; i < Number(count); i++) {
  await store.update((library, ctx) => {
    const result = setVariable(library, `w${workerId}_${i}`, `value ${i}`, ctx);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result.value.library;
  });
}
