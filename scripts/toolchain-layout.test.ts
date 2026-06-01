import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — .mjs has no .d.ts
import { resolveToolchain } from "./toolchain-layout.mjs";

// resolveToolchain detects "repo" vs "bundle" purely by file presence
// (plugins/agntux-build/.claude-plugin under <base>), so a fake dir tree is
// enough — no real clone or plugin install needed.
describe("resolveToolchain", () => {
  let root: string;
  let repoBase: string;
  let bundleBase: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "tc-layout-"));
    // Fake maintainer clone: <repoBase>/plugins/agntux-build/.claude-plugin
    repoBase = join(root, "repo");
    mkdirSync(join(repoBase, "plugins", "agntux-build", ".claude-plugin"), { recursive: true });
    mkdirSync(join(repoBase, "scripts"), { recursive: true });
    // Fake bundle: <bundleBase>/bin + scripts, NO plugins/agntux-build
    bundleBase = join(root, "bundle");
    mkdirSync(join(bundleBase, "bin"), { recursive: true });
    mkdirSync(join(bundleBase, "scripts"), { recursive: true });
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("detects the repo layout from scripts/ and resolves repo-relative paths", () => {
    const tc = resolveToolchain(join(repoBase, "scripts"));
    expect(tc.layout).toBe("repo");
    expect(tc.base).toBe(repoBase);
    expect(tc.buildScript).toBe(join(repoBase, "scripts", "build-plugin.mjs"));
    expect(tc.lintEntry).toBe(join(repoBase, "scripts", "lint-marketplace-metadata.ts"));
    expect(tc.lintRunner).toBe("tsx");
    expect(tc.packagesDir).toBe(join(repoBase, "packages"));
    expect(tc.canonicalSyncDir).toBe(
      join(repoBase, "canonical", "prompts", "ingest", "skills", "sync"),
    );
    expect(tc.appsClientCanonicalRoot).toBe(repoBase);
    // The view-tool skeleton the scaffold copies lives under the agntux-build
    // plugin tree in the maintainer clone.
    expect(tc.viewToolTemplateDir).toBe(
      join(repoBase, "plugins", "agntux-build", "canonical", "ui-handlers", "_template", "view-tool"),
    );
    expect(tc.pluginsDir).toBe(join(repoBase, "plugins"));
    expect(tc.testHarnessCli).toContain(join("plugins", "agntux-build", "test-harness"));
    expect(tc.tmpRoot).toBe(repoBase);
  });

  it("detects the bundle layout from bin/ and resolves bundle-relative paths", () => {
    const tc = resolveToolchain(join(bundleBase, "bin"));
    expect(tc.layout).toBe("bundle");
    expect(tc.base).toBe(bundleBase);
    // bin/ entrypoints, scripts/ helpers
    expect(tc.buildScript).toBe(join(bundleBase, "bin", "build-plugin.mjs"));
    expect(tc.validateScript).toBe(join(bundleBase, "bin", "validate-plugin.mjs"));
    expect(tc.renderSkillScript).toBe(join(bundleBase, "scripts", "render-skill.mjs"));
    // self-contained compiled linter, run via node
    expect(tc.lintEntry).toBe(join(bundleBase, "scripts", "lint-marketplace-metadata.mjs"));
    expect(tc.lintRunner).toBe("node");
    // packages + canonical bundled under the plugin
    expect(tc.packagesDir).toBe(join(bundleBase, "canonical", "packages"));
    expect(tc.canonicalSyncDir).toBe(
      join(bundleBase, "canonical", "prompts", "ingest", "skills", "sync"),
    );
    expect(tc.appsClientCanonicalRoot).toBe(join(bundleBase, "canonical", "repo-mirror"));
    // In the bundle the whole agntux-build tree IS <base>.
    expect(tc.viewToolTemplateDir).toBe(
      join(bundleBase, "canonical", "ui-handlers", "_template", "view-tool"),
    );
    expect(tc.testHarnessCli).toBe(join(bundleBase, "test-harness", "bin", "cli.mjs"));
    // no clone in the bundle, and scratch must be writable (OS tmp)
    expect(tc.pluginsDir).toBeNull();
    expect(tc.tmpRoot).not.toBe(bundleBase);
  });

  it("resolves the same base from bin/ and scripts/ in the bundle", () => {
    const fromBin = resolveToolchain(join(bundleBase, "bin"));
    const fromScripts = resolveToolchain(join(bundleBase, "scripts"));
    expect(fromBin.base).toBe(fromScripts.base);
    expect(fromBin.layout).toBe("bundle");
    expect(fromScripts.layout).toBe("bundle");
  });
});
