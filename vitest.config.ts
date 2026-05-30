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
      // Same for the host-renderer sub-package: it has its own package.json +
      // lockfile + deps (express, cors, playwright) that the root `npm ci`
      // doesn't install, so its tests must run via its own config
      // (`cd plugins/agntux-build/host-renderer && npm test`). Collecting them
      // at the root made `npm test` fail on a clean checkout with
      // "Cannot find package 'express'".
      "**/host-renderer/**",
      // Same for view-tool tests (post-P7 source plugins): their UI tests live
      // under view-tool/{src/__tests__,__tests__}/ and need jsdom + the
      // view-tool's own setupFiles (vitest.setup.ts) + @vitejs/plugin-react.
      // The root vitest has none of that and would fail to import their JSX /
      // mock window — exactly like the component exclusion above. Each runs via
      // its own config: `cd plugins/{slug}/view-tool && npm test` (and the
      // submit-time validator runs them too). Also covers the scaffold
      // _template's view-tool tests, which are validated when instantiated.
      "**/view-tool/**",
      // Don't pick up compiled output of workspace packages.
      "packages/*/dist/**",
    ],
  },
});
