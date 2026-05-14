import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// Single-view plugin: one Vite entry. The build emits
// dist/ui-resources/compose.html.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist/ui-resources",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        compose: resolve(__dirname, "src/compose-ui.tsx"),
      },
      output: {
        entryFileNames: "[name].html",
      },
    },
  },
});
