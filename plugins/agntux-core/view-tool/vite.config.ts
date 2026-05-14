import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// Single-view plugin: one Vite entry. The build emits
// dist/ui-resources/triage.html — a self-contained HTML.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist/ui-resources",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        triage: resolve(__dirname, "src/triage-ui.tsx"),
      },
      output: {
        entryFileNames: "[name].html",
      },
    },
  },
});
