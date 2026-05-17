import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// Single-view plugin: one Vite entry. Vite must be pointed at an HTML
// file — not the .tsx — so vite-plugin-singlefile can inline the JS
// inside <script type="module"> and emit a real self-contained HTML
// document at dist/ui-resources/compose.html.
//
// tailwindcss() is required so Tailwind utility classes in
// compose-ui.tsx resolve to CSS. The iframe loads ONLY the inlined
// HTML — external stylesheets are never fetched — so the CSS must be
// inlined alongside the JS. Marketplace lint pass 13 (E28) enforces
// this. See CHANGELOG.md → 4.0.6.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: "dist/ui-resources",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        compose: resolve(__dirname, "compose.html"),
      },
    },
  },
});
