import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist/ui-resources",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // One entry per resource. Single-view plugins ship one; multi-view
        // plugins (slack) add more entries below.
        "{{ui-name}}": resolve(__dirname, "src/ui-resource.tsx"),
      },
      output: {
        entryFileNames: "[name].html",
      },
    },
  },
});
