import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
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
//
// tailwindcss() is required so the Tailwind utility classes in
// triage-ui.tsx (`p-4`, `text-lg`, `font-semibold`, …) actually
// resolve to CSS. The iframe loads ONLY the inlined HTML — external
// stylesheets are never fetched — so the CSS pipeline must run
// in-process and have its output inlined alongside the JS. Without
// it, the iframe renders the React tree as unstyled HTML that looks
// like a raw text dump. Marketplace lint pass 13 (E28) enforces this.
// See CHANGELOG.md → 9.5.7.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
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
