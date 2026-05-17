// vitest.config.ts — standalone test config for agntux-slack view-tool.
//
// Cannot reuse vite.config.ts here because that config throws at import time
// when VITE_ENTRY is unset (it's a multi-entry build config that requires the
// env var to select compose vs canvas). Vitest picks up this file in preference
// to vite.config.ts when both are present.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
