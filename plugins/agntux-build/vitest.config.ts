import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Include .mjs so the launcher + runtime-shim tests run under the
    // plugin-local config too (not only the repo-root config).
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.mjs"],
    testTimeout: 30_000,
  },
});
