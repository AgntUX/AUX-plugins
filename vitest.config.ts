import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "scripts/**/*.test.ts",
      "plugins/**/__tests__/**/*.test.{mjs,ts}",
      "packages/*/__tests__/**/*.test.ts",
    ],
    exclude: [
      "canonical/**",
      // Exclude all nested node_modules — pattern must match at any depth
      // (the prior bare "node_modules/**" only matched the repo root, so
      // tests vendored inside transitive packages like @testing-library/
      // jest-dom were being collected and failing).
      "**/node_modules/**",
      // Component-level tests live under ui-handlers/{name}/component/ and
      // run via the component's own vitest config (with jsdom setup, react
      // testing helpers, etc). The root vitest does not have that setup
      // and would fail to import their JSX. Each component package runs
      // its tests via `cd ui-handlers/{name}/component && npm test`.
      "**/ui-handlers/*/component/**",
      // Same for plugin MCP server packages — run via their own vitest config.
      "**/mcp-server/**",
      // Don't pick up compiled output of workspace packages.
      "packages/*/dist/**",
    ],
  },
});
