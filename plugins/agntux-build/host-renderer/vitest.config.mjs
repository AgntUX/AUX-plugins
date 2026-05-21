import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.{mjs,ts}"],
    // The intercept SSE test needs more than vitest's default 5s
    // because we read multiple SSE frames sequentially.
    testTimeout: 15_000,
  },
});
