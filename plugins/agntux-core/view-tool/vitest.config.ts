import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest config for agntux-core view-tool. Two distinct test sets coexist:
//   - src/__tests__/**          — rich-UI component + lib tests (jsdom env)
//   - __tests__/payload-shape   — payload-shape regression guard (node env)
//
// Both run under one vitest invocation because the marketplace lint pass 11
// guard scans for `Buffer.byteLength`/`.toBeLessThan` patterns in the file at
// view-tool/__tests__/payload-shape.test.ts (NOT under src/__tests__/), and
// the rich-UI component tests need jsdom + the test-library setup. We use
// the jsdom environment globally; the payload-shape test only touches
// in-memory data so the extra DOM doesn't affect it.
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
