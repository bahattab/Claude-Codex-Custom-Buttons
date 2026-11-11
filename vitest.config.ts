import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string): string => fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ccb/core": src("core"),
      "@ccb/store": src("store"),
      "@ccb/sync": src("sync"),
      "@ccb/mcp-server": src("mcp-server"),
      "@ccb/cli": src("cli"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/bin.ts"],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
