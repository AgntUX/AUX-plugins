import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// Handler-agnostic multi-view build. vite-plugin-singlefile sets
// inlineDynamicImports:true, which Rollup forbids with multiple inputs, so
// the npm `build` script builds once per *.html entry and selects it via
// VITE_ENTRY. Each entry MUST point at a real .html (not a .tsx) so the
// bundle is wrapped in real HTML markup (pass-10 E23). tailwindcss() inlines
// the CSS the iframe needs (pass-13 E28).
const entryName = process.env.VITE_ENTRY;
if (!entryName) {
  throw new Error("vite.config.ts: set VITE_ENTRY to the view name (a *.html basename).");
}

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: "dist/ui-resources",
    emptyOutDir: false,
    rollupOptions: {
      input: { [entryName]: resolve(__dirname, `${entryName}.html`) },
    },
  },
});
