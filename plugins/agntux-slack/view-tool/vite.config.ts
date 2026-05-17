import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// Multi-view plugin: emits dist/ui-resources/{compose,canvas}.html as
// two self-contained HTML bundles.
//
// vite-plugin-singlefile sets output.inlineDynamicImports: true, which
// Rollup forbids when there are multiple rollup inputs. So we build
// once per entry. The entry is selected via the VITE_ENTRY env var;
// the npm `build` script runs vite twice, once per name, with
// --emptyOutDir=false on the second run so the first run's HTML
// survives.
//
// Each entry points at a real HTML file (not the .tsx) so the bundle
// is wrapped in <!doctype html><script type="module">…</script>
// markup. Pointing input at a .tsx directly causes Rollup to emit a
// JS module renamed to .html, which any compliant MCP App host
// rejects ("Unsupported UI resource content format").
const ENTRIES: Record<string, string> = {
  compose: resolve(__dirname, "compose.html"),
  canvas: resolve(__dirname, "canvas.html"),
};

const entryName = process.env.VITE_ENTRY;
if (!entryName || !(entryName in ENTRIES)) {
  throw new Error(
    `vite.config.ts: set VITE_ENTRY to one of: ${Object.keys(ENTRIES).join(", ")}. ` +
      `Got: ${JSON.stringify(entryName)}`,
  );
}

// tailwindcss() is required so the Tailwind utility classes in the
// `*-ui.tsx` sources actually resolve to CSS. The iframe loads ONLY the
// inlined HTML — external stylesheets are never fetched — so the CSS
// pipeline must run in-process and have its output inlined alongside
// the JS. Marketplace lint pass 13 (E28) enforces this. See
// CHANGELOG.md → 8.0.6.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: "dist/ui-resources",
    rollupOptions: {
      input: { [entryName]: ENTRIES[entryName] },
    },
  },
});
