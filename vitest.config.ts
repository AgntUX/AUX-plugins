import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "scripts/**/*.test.ts",
      "plugins/**/__tests__/**/*.test.{mjs,ts}",
    ],
    exclude: ["canonical/**", "node_modules/**"],
  },
});
