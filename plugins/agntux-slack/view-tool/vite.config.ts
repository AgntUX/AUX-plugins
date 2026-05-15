import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// Multi-view plugin: emits dist/ui-resources/{compose,canvas}.html as two
// self-contained HTML bundles.
//
// vite-plugin-singlefile sets output.inlineDynamicImports: true, which
// Rollup forbids when there are multiple rollup inputs. So we build once
// per entry. The entry is selected via the VITE_ENTRY env var; the npm
// `build` script runs vite twice, once per name, with --emptyOutDir false
// on the second run so the first run's HTML survives.
const ENTRIES: Record<string, string> = {
  compose: resolve(__dirname, "src/compose-ui.tsx"),
  canvas: resolve(__dirname, "src/canvas-ui.tsx"),
};

const entryName = process.env.VITE_ENTRY;
if (!entryName || !(entryName in ENTRIES)) {
  throw new Error(
    `vite.config.ts: set VITE_ENTRY to one of: ${Object.keys(ENTRIES).join(", ")}. ` +
      `Got: ${JSON.stringify(entryName)}`,
  );
}

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist/ui-resources",
    rollupOptions: {
      input: { [entryName]: ENTRIES[entryName] },
      output: { entryFileNames: "[name].html" },
    },
  },
});
