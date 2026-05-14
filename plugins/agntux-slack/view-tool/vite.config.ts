import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// Multi-view plugin: one Vite entry per resource. The build emits
// dist/ui-resources/{compose,canvas}.html — two self-contained HTML files.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist/ui-resources",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        compose: resolve(__dirname, "src/compose-ui.tsx"),
        canvas: resolve(__dirname, "src/canvas-ui.tsx"),
      },
      output: {
        entryFileNames: "[name].html",
      },
    },
  },
});
