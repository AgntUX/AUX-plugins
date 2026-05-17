// vitest.config.ts — standalone test config for agntux-slack view-tool.
//
// Cannot reuse vite.config.ts here because that config throws at import time
// when VITE_ENTRY is unset (it's a multi-entry build config that requires the
// env var to select compose vs canvas). Vitest picks up this file in
// preference to vite.config.ts when both are present.
//
// Two distinct test sets coexist:
//   - src/apps/{compose,canvas}/__tests__/**  — rich-UI component + lib tests
//                                                (jsdom env, requires
//                                                @testing-library + setup).
//   - __tests__/payload-shape.test.ts          — handler-side payload-shape
//                                                regression guard (node env,
//                                                no DOM).
//
// Both run under one vitest invocation. The setup files live under each
// app's __tests__/setup.tsx (byte-identical between compose and canvas);
// registering compose's is sufficient because it just registers
// @testing-library/jest-dom + an afterEach(cleanup) — registering canvas's
// would be a no-op duplicate. The marketplace lint pass 11 guard still
// scans for `Buffer.byteLength` + `.toBeLessThan(` patterns in the file
// at view-tool/__tests__/payload-shape.test.ts, which stays in place.
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
    setupFiles: ["./src/apps/compose/__tests__/setup.tsx"],
    include: [
      "src/apps/**/__tests__/**/*.test.{ts,tsx}",
      "__tests__/**/*.test.{ts,tsx}",
    ],
  },
});
