// cross-plugin: walks plugins/*/ and asserts the view-only shape on
// every source plugin. agntux-core, agntux-build, and plugin-toolkit
// are exempt (they keep local mcp-server/ for their mutation tools or
// CLI surface).

import { describe, it, expect } from "vitest";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname === plugins/agntux-build/__tests__
// PLUGINS_ROOT  === plugins/
const PLUGINS_ROOT = join(__dirname, "..", "..");
const EXEMPT = new Set(["agntux-core", "agntux-build", "plugin-toolkit"]);

function listPlugins(): string[] {
  return readdirSync(PLUGINS_ROOT)
    .filter((n) => {
      const p = join(PLUGINS_ROOT, n);
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    })
    .filter((n) =>
      existsSync(join(PLUGINS_ROOT, n, ".claude-plugin", "plugin.json")),
    );
}

describe("cross-plugin: view-only shape", () => {
  const plugins = listPlugins().filter((s) => !EXEMPT.has(s));

  for (const slug of plugins) {
    describe(slug, () => {
      const root = join(PLUGINS_ROOT, slug);

      it("does not ship a .mcp.json", () => {
        expect(existsSync(join(root, ".mcp.json"))).toBe(false);
      });

      it("does not ship a mcp-server/ directory", () => {
        expect(existsSync(join(root, "mcp-server"))).toBe(false);
      });

      it("ships view-tool/dist/view-tools.manifest.json", () => {
        const manifest = join(
          root,
          "view-tool",
          "dist",
          "view-tools.manifest.json",
        );
        // Manifest may not exist before the local build runs; treat as
        // a soft expectation guarded on the dist directory existing.
        const dist = join(root, "view-tool", "dist");
        if (!existsSync(dist)) {
          // build hasn't run yet locally — the CI build-plugins.yml
          // workflow regenerates these on push to main.
          return;
        }
        expect(existsSync(manifest), `missing ${manifest}`).toBe(true);
      });

      it("every view_tools[].name is plugin-slug-prefixed", () => {
        const manifestPath = join(
          root,
          "view-tool",
          "dist",
          "view-tools.manifest.json",
        );
        if (!existsSync(manifestPath)) return;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        const slugSnake = slug.replace(/-/g, "_");
        for (const vt of manifest.view_tools) {
          expect(vt.name.startsWith(`${slugSnake}_`)).toBe(true);
        }
      });
    });
  }
});

// =============================================================================
// Cross-plugin: compiled view-tool ESM modules conform to the FROZEN
// ViewToolContext contract.
//
// Treat ViewToolContext as a contract, not as a structure to iterate. We
// dynamic-import each plugin's compiled `view-tool/dist/<slug>-view.js`
// (including agntux-core, which is exempt from the no-mcp-server rule but
// still ships a view-tool subtree under P5) and assert:
//
//   1. The default export is a `ViewToolModule` shape — `{ viewTools }` with
//      a non-empty array.
//   2. Every entry exposes `descriptor` (object) + `handle` (function).
//   3. Every descriptor name is plugin-slug-prefixed.
//
// Soft-skipped when the dist tree is missing (fresh clone before build).
// =============================================================================

describe("cross-plugin: compiled module ↔ ViewToolContext contract", () => {
  const SLUGS = ["agntux-core", "agntux-slack", "agntux-gmail"];

  for (const slug of SLUGS) {
    it(`${slug}: default export is { viewTools: ViewTool[] } with valid descriptors`, async () => {
      const root = join(PLUGINS_ROOT, slug);
      const compiled = join(root, "view-tool", "dist", `${slug}-view.js`);
      if (!existsSync(compiled)) {
        // Build hasn't run locally — CI's build-plugins.yml regenerates it.
        return;
      }
      const mod = await import(compiled);
      const exported = mod.default;
      expect(exported, `${slug} default export missing`).toBeTruthy();
      expect(Array.isArray(exported.viewTools)).toBe(true);
      expect(exported.viewTools.length).toBeGreaterThan(0);

      const slugSnake = slug.replace(/-/g, "_");
      for (const vt of exported.viewTools) {
        expect(typeof vt.handle).toBe("function");
        expect(vt.descriptor).toBeTruthy();
        expect(typeof vt.descriptor.name).toBe("string");
        expect(vt.descriptor.name.startsWith(`${slugSnake}_`)).toBe(true);
        expect(typeof vt.descriptor.description).toBe("string");
        expect(vt.descriptor.inputSchema).toBeTruthy();
        expect(vt.descriptor.outputSchema).toBeTruthy();
        expect(typeof vt.descriptor.ui_resource_uri).toBe("string");
        expect(vt.descriptor.ui_resource_uri).toMatch(
          /^ui:\/\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/,
        );
      }
    });
  }
});
