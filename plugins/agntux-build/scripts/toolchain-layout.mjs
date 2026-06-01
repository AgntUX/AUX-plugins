#!/usr/bin/env node
/**
 * toolchain-layout.mjs — resolve where the build/validate toolchain's pieces
 * live, independent of whether the scripts run from the AUX-plugins maintainer
 * clone or from the agntux-build plugin bundle shipped to a contributor.
 *
 * Two supported layouts (auto-detected from the caller's directory):
 *
 *   "repo"   — the AUX-plugins maintainer clone. Entry scripts live in
 *              <repo>/scripts/; helpers in <repo>/scripts/ (+ lint/); packages
 *              in <repo>/packages/; agntux-build's runtime (test-harness/,
 *              host-renderer/) under <repo>/plugins/agntux-build/. The canonical
 *              ingest sync templates + the cross-plugin apps-client canonical
 *              both resolve relative to <repo>.
 *
 *   "bundle" — the agntux-build plugin as installed on a contributor machine
 *              ($CLAUDE_PLUGIN_ROOT). The plan (P "ship the toolchain in-bundle")
 *              places executables in <plugin>/bin/, helpers in <plugin>/scripts/
 *              (+ lint/), the built packages in <plugin>/canonical/packages/,
 *              the canonical ingest sync templates in
 *              <plugin>/canonical/prompts/ingest/skills/sync/, and a small
 *              "repo-mirror" of the apps-client canonical (which normally lives
 *              under plugins/agntux-core/ + plugins/agntux-build/) at
 *              <plugin>/canonical/repo-mirror/ so lint pass 12 can run.
 *
 * Detection is by file presence, NOT by env var, so it is robust whether or not
 * CLAUDE_PLUGIN_ROOT is exported: a layout is "repo" iff
 * <base>/plugins/agntux-build/.claude-plugin/ exists, where <base> is the
 * parent of the caller's directory (scripts/ or bin/ are both one level under
 * <base>). Otherwise it is "bundle".
 *
 * Every consuming script (validate-plugin.mjs, build-plugin.mjs,
 * render-skill.mjs, lint-marketplace-metadata.ts via a thin re-read) passes its
 * own __dirname; the resolver returns absolute paths for every artifact it
 * needs. This is the single place layout knowledge lives — never hardcode
 * <repo>/scripts or <plugin>/bin in a consumer.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

/**
 * @param {string} scriptDir  the calling script's directory (its __dirname).
 *                            Both <base>/scripts and <base>/bin resolve to the
 *                            same <base>.
 * @returns {{
 *   layout: "repo"|"bundle",
 *   base: string,
 *   buildScript: string,
 *   validateScript: string,
 *   renderSkillScript: string,
 *   lintEntry: string,
 *   packagesDir: string,
 *   canonicalRoot: string,
 *   canonicalSyncDir: string,
 *   viewToolTemplateDir: string,
 *   appsClientCanonicalRoot: string,
 *   testHarnessCli: string,
 *   hostRenderer: string,
 *   pluginsDir: string|null,
 *   tmpRoot: string,
 * }}
 */
export function resolveToolchain(scriptDir) {
  const base = resolve(scriptDir, "..");
  const isRepo = existsSync(
    join(base, "plugins", "agntux-build", ".claude-plugin"),
  );

  if (isRepo) {
    return {
      layout: "repo",
      base,
      buildScript: join(base, "scripts", "build-plugin.mjs"),
      validateScript: join(base, "scripts", "validate-plugin.mjs"),
      renderSkillScript: join(base, "scripts", "render-skill.mjs"),
      importCheckScript: join(base, "scripts", "check-view-tool-imports.mjs"),
      // Maintainer clone runs the TypeScript linter through tsx; the bundle
      // ships an esbuild-compiled self-contained .mjs (no TS runtime needed).
      lintEntry: join(base, "scripts", "lint-marketplace-metadata.ts"),
      lintRunner: "tsx",
      packagesDir: join(base, "packages"),
      // pass-8 canonical sync anchor: join(canonicalRoot, "canonical", …).
      canonicalRoot: base,
      canonicalSyncDir: join(
        base,
        "canonical",
        "prompts",
        "ingest",
        "skills",
        "sync",
      ),
      // The full view-tool skeleton the scaffold copies as the build-critical
      // floor (deps + apps-client + tsconfig + tailwind + emit-manifest). In the
      // maintainer clone it lives under the agntux-build plugin tree; the bundle
      // ships it at <plugin>/canonical/ui-handlers/_template/view-tool.
      viewToolTemplateDir: join(
        base,
        "plugins",
        "agntux-build",
        "canonical",
        "ui-handlers",
        "_template",
        "view-tool",
      ),
      // pass-12 anchor: join(appsClientCanonicalRoot, "plugins/agntux-core/…").
      appsClientCanonicalRoot: base,
      testHarnessCli: join(
        base,
        "plugins",
        "agntux-build",
        "test-harness",
        "bin",
        "cli.mjs",
      ),
      hostRenderer: join(base, "plugins", "agntux-build", "host-renderer"),
      pluginsDir: join(base, "plugins"),
      tmpRoot: base,
    };
  }

  // bundle layout — <base> === $CLAUDE_PLUGIN_ROOT (the installed plugin root).
  return {
    layout: "bundle",
    base,
    buildScript: join(base, "bin", "build-plugin.mjs"),
    validateScript: join(base, "bin", "validate-plugin.mjs"),
    renderSkillScript: join(base, "scripts", "render-skill.mjs"),
    importCheckScript: join(base, "scripts", "check-view-tool-imports.mjs"),
    // esbuild-compiled, self-contained (js-yaml / image-size / zod inlined) so
    // it runs under plain `node` with no tsx / TS toolchain in the sandbox.
    lintEntry: join(base, "scripts", "lint-marketplace-metadata.mjs"),
    lintRunner: "node",
    packagesDir: join(base, "canonical", "packages"),
    // Bundled at the layout-natural place so render-skill (which resolves from
    // its own __dirname) and pass-8 (via canonicalRoot) agree.
    canonicalRoot: base,
    canonicalSyncDir: join(
      base,
      "canonical",
      "prompts",
      "ingest",
      "skills",
      "sync",
    ),
    // In the bundle the whole agntux-build tree IS <base>, so the view-tool
    // skeleton sits at <base>/canonical/ui-handlers/_template/view-tool.
    viewToolTemplateDir: join(
      base,
      "canonical",
      "ui-handlers",
      "_template",
      "view-tool",
    ),
    // The apps-client canonical normally lives under plugins/agntux-core/ +
    // plugins/agntux-build/; in the bundle those trees don't exist, so the sync
    // script mirrors just the needed files under canonical/repo-mirror/ keeping
    // their original repo-relative paths.
    appsClientCanonicalRoot: join(base, "canonical", "repo-mirror"),
    testHarnessCli: join(base, "test-harness", "bin", "cli.mjs"),
    hostRenderer: join(base, "host-renderer"),
    pluginsDir: null,
    tmpRoot: tmpdir(),
  };
}
