// vitest.config.ts — scaffolded view-tool test config.
//
// Mirrors plugins/agntux-core/view-tool/vitest.config.ts (single-UI plugin
// shape). For multi-UI plugins (e.g. one that ships compose+canvas under
// view-tool/src/apps/{ui-name}/), copy plugins/agntux-slack/view-tool/
// vitest.config.ts instead — it points setupFiles at
// src/apps/compose/__tests__/setup.tsx and includes
// src/apps/**/__tests__/**.
//
// Two test sets coexist:
//   - src/__tests__/**          — rich-UI component + lib tests (jsdom env).
//   - __tests__/payload-shape   — handler-side payload-shape regression
//                                 guard (node env; the extra jsdom doesn't
//                                 affect it).
//
// Both run under one vitest invocation. The marketplace lint pass 11 guard
// scans for `Buffer.byteLength` + `.toBeLessThan(` patterns in the file at
// view-tool/__tests__/payload-shape.test.ts.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Force development builds of React so React.act() is available
    // (required by @testing-library/react).
    conditions: ["development", "browser"],
  },
  define: {
    "process.env.NODE_ENV": '"test"',
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.tsx"],
    include: [
      "src/__tests__/**/*.test.{ts,tsx}",
      "__tests__/**/*.test.{ts,tsx}",
    ],
  },
});
