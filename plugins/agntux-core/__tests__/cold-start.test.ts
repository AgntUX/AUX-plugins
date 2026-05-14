// =============================================================================
// cold-start.test.ts — P5 view-only shape assertions for agntux-core.
//
// agntux-core is EXEMPT from the source-plugin shape rule: it still ships a
// local stdio mcp-server (for the 5 surviving mutator tools: snooze, dismiss,
// set-status, save_triage_prefs, set_triage_pref). The triage_view tool moved
// to `view-tool/dist/agntux-core-view.js` under the view-only shape; the
// local mcp-server must NOT register it any more.
//
// The view-tool/dist/* artefacts may not exist locally before the first
// build. We treat those assertions as soft (skip when the dist directory is
// absent) so this test still passes in a fresh clone before `npm run build`
// runs. CI's build-plugins.yml regenerates the dist tree on push to main.
// =============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..");

describe("agntux-core view-only shape (P5 — core is exempt; keeps mcp-server)", () => {
  it("still ships the local stdio mcp-server (core is exempt — it owns the mutator tools)", () => {
    expect(existsSync(join(PLUGIN_ROOT, "mcp-server"))).toBe(true);
  });

  it("ships the view-tool/ subtree with the canonical layout", () => {
    expect(existsSync(join(PLUGIN_ROOT, "view-tool"))).toBe(true);
    expect(
      existsSync(join(PLUGIN_ROOT, "view-tool", "src", "agntux-core-view.ts")),
    ).toBe(true);
    expect(
      existsSync(join(PLUGIN_ROOT, "view-tool", "src", "triage-ui.tsx")),
    ).toBe(true);
    expect(
      existsSync(join(PLUGIN_ROOT, "view-tool", "package.json")),
    ).toBe(true);
  });

  it("view-tool/package.json carries the build script chain (vite → tsc → esbuild → emit-manifest)", () => {
    const pkg = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, "view-tool", "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const buildScript = pkg.scripts?.build ?? "";
    expect(buildScript).toContain("vite build");
    expect(buildScript).toContain("tsc");
    expect(buildScript).toContain("esbuild");
    expect(buildScript).toContain("emit-manifest");
    expect(buildScript).toContain("agntux-core-view.js");
  });

  it("root package.json lists view-tool in workspaces", () => {
    const pkg = JSON.parse(
      readFileSync(join(PLUGIN_ROOT, "package.json"), "utf8"),
    ) as { workspaces?: string[] };
    expect(pkg.workspaces).toContain("view-tool");
  });

  it("ships view-tool/dist/view-tools.manifest.json after build", () => {
    const dist = join(PLUGIN_ROOT, "view-tool", "dist");
    if (!existsSync(dist)) {
      // No build yet — soft-skip. CI's build-plugins.yml regenerates this.
      return;
    }
    const manifestPath = join(dist, "view-tools.manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.plugin_slug).toBe("agntux_core");
    expect(manifest.view_tools.length).toBeGreaterThanOrEqual(1);
    expect(manifest.ui_bundles.length).toBeGreaterThanOrEqual(1);
  });

  it("every view_tools[].name is plugin-slug-prefixed (agntux_core_)", () => {
    const manifestPath = join(
      PLUGIN_ROOT,
      "view-tool",
      "dist",
      "view-tools.manifest.json",
    );
    if (!existsSync(manifestPath)) return;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const vt of manifest.view_tools) {
      expect(vt.name.startsWith("agntux_core_")).toBe(true);
    }
  });

  it("manifest validates against the Zod schema from @agntux/plugin-runtime", async () => {
    const manifestPath = join(
      PLUGIN_ROOT,
      "view-tool",
      "dist",
      "view-tools.manifest.json",
    );
    if (!existsSync(manifestPath)) return;
    // Dynamic import so the test doesn't blow up when the workspace
    // hasn't been installed yet (the package is a sibling workspace).
    let ViewToolsManifestSchema: { safeParse: (m: unknown) => { success: boolean; error?: { flatten: () => unknown } } };
    try {
      ({ ViewToolsManifestSchema } = await import("@agntux/plugin-runtime"));
    } catch {
      return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const parsed = ViewToolsManifestSchema.safeParse(manifest);
    expect(
      parsed.success,
      JSON.stringify(parsed.error?.flatten() ?? {}),
    ).toBe(true);
  });

  it("local mcp-server does NOT register agntux_core_triage_view (it moved to view-tool)", () => {
    const indexPath = join(PLUGIN_ROOT, "mcp-server", "src", "index.ts");
    const text = readFileSync(indexPath, "utf-8");
    // Registration shape is gone (the TOOLS object key is absent).
    expect(text).not.toMatch(/agntux_core_triage_view:\s*\{/);
    // Imports are gone.
    expect(text).not.toMatch(/import\s*\{[^}]*triageViewTool/);
    expect(text).not.toMatch(/import\s*\{[^}]*handleTriageView/);
  });
});
