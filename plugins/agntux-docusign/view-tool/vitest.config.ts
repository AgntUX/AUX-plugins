import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Handler-agnostic test config. jsdom + globals so rich-UI component
// tests run; `vitest run` must NOT fall through to vite.config.ts (which
// throws without VITE_ENTRY). setupFiles registers @testing-library/jest-dom
// (+ React cleanup); include covers component tests under src/ AND the
// handler-side payload-shape guard under __tests__/.
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ["development", "browser"] },
  define: { "process.env.NODE_ENV": '"test"' },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "__tests__/**/*.test.{ts,tsx}",
    ],
  },
});
