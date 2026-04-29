import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.mjs", "e2e/**/*.test.ts", "e2e/**/*.test.mjs"],
  },
});
