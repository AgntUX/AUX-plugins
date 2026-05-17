import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// Single-view plugin: one Vite entry. Vite must be pointed at an HTML
// file — not the .tsx — so vite-plugin-singlefile can inline the JS
// inside <script type="module"> and emit a real self-contained HTML
// document at dist/ui-resources/triage.html.
//
// Pointing input at a .tsx directly causes Rollup to emit a JS
// module renamed to .html, which Claude Cowork (and any compliant
// host) rejects with "Unsupported UI resource content format".
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist/ui-resources",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        triage: resolve(__dirname, "triage.html"),
      },
    },
  },
});
