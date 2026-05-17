import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// Vite must be pointed at an HTML file — NOT a .tsx — so
// vite-plugin-singlefile can inline the JS inside <script type="module">
// and emit a real self-contained HTML document at
// dist/ui-resources/{{ui-name}}.html.
//
// Pointing input at a .tsx directly causes Rollup to emit a JS module
// renamed to .html, which any compliant MCP App host rejects with
// "Unsupported UI resource content format". The pass-9 marketplace
// linter ("view-tool bundles are real HTML") enforces this at PR time.
//
// Multi-view plugins (e.g. agntux-slack) ship one HTML entry per
// resource and select between them at build time via VITE_ENTRY —
// vite-plugin-singlefile sets output.inlineDynamicImports: true, which
// Rollup forbids when there are multiple rollup inputs. See
// plugins/agntux-slack/view-tool/vite.config.ts for the pattern.
//
// The tailwindcss() plugin is required so the Tailwind utility classes
// the UI source uses (`p-4`, `text-lg`, `font-semibold`, …) actually
// resolve to CSS. The iframe loads ONLY the inlined HTML — external
// stylesheets are never fetched — so the CSS must be inlined by Vite
// alongside the JS. Marketplace lint pass 13 (E28) enforces that any
// view-tool whose source uses className= ships a non-empty <style>
// block. See plugins/agntux-core/CHANGELOG.md → 9.5.7.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: "dist/ui-resources",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "{{ui-name}}": resolve(__dirname, "{{ui-name}}.html"),
      },
    },
  },
});
