/**
 * lint-apps-client-drift.ts — pass 12: every vendored copy of
 * `simple-mcp-app.ts` and `constants.ts` must be byte-identical to the
 * canonical source.
 *
 * Why this exists: 9.5.4 fixed the iframe protocol bug by vendoring
 * `SimpleMcpApp` (the JSON-RPC 2.0 over postMessage wrapper) into each
 * plugin's `view-tool/src/lib/apps-client/`. 9.6.0 re-anchored the
 * canonical to live AT `plugins/agntux-core/view-tool/src/lib/apps-client/`
 * — the same place every other plugin vendors from. Every other vendored
 * copy in the repo MUST hash-match this canonical.
 *
 * If a future bugfix lands in one copy and not the others, the
 * iframe-protocol regression we just fixed comes back silently — the
 * affected plugin's iframe stays on "Loading…" forever while the
 * others work fine.
 *
 * This pass walks every plugin and computes sha256 over
 * `view-tool/src/lib/apps-client/{simple-mcp-app,constants}.ts` plus the
 * canonical at `plugins/agntux-core/view-tool/src/lib/apps-client/
 * {simple-mcp-app,constants}.ts`, plus the canonical _template path.
 * Every hash must match.
 *
 * Findings:
 *
 *   E26 (error) — Vendored apps-client copy drift
 *     The file's sha256 differs from the canonical at
 *     `plugins/agntux-core/view-tool/src/lib/apps-client/`. Re-copy
 *     from there or update the canonical first.
 *
 *   E27 (warning) — Vendored apps-client copy missing
 *     The plugin ships `view-tool/` but is missing one of the required
 *     vendored files. Run `cp` from the canonical or fix the lib
 *     subtree layout.
 *
 * Scope:
 *   - Canonical source: `plugins/agntux-core/view-tool/src/lib/
 *     apps-client/`. agntux-core's own view-tool/ subtree IS that
 *     canonical; the plugin-local check is skipped for agntux-core to
 *     avoid self-reporting.
 *   - Plugins with `view-tool/` (other than agntux-core): must have
 *     both files at `view-tool/src/lib/apps-client/` and they must
 *     hash-match.
 *   - The canonical scaffold template path inside
 *     `plugins/agntux-build/canonical/ui-handlers/_template/view-tool/`
 *     must hash-match (it's shipped to scaffolded plugins).
 *   - Plugins without `view-tool/` are skipped.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type Severity = "error" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  plugin: string;
  file: string;
  line?: number;
  col?: number;
  message: string;
}

const REQUIRED_FILES = ["simple-mcp-app.ts", "constants.ts"] as const;

/**
 * The canonical apps-client lives in agntux-core's view-tool subtree as
 * of 9.6.0. (Pre-9.6.0 it lived at ui-handlers/triage/component/src/...
 * but the rich-UI restoration collapsed the two trees into one.) Every
 * other vendored copy in the repo MUST hash-match this one.
 */
const CANONICAL_REL =
  "plugins/agntux-core/view-tool/src/lib/apps-client";

/**
 * Plugin slug that OWNS the canonical (skipped for the plugin-local
 * check to avoid self-reporting a hash mismatch against itself).
 */
const CANONICAL_OWNER = "agntux-core";

/**
 * Additional vendored-copy locations the lint pass checks beyond each
 * plugin's view-tool/. These belong to a specific plugin slug
 * (agntux-build for the canonical scaffold) but live at non-standard
 * paths.
 */
const EXTRA_COPIES: ReadonlyArray<{
  plugin: string;
  relPath: string;
}> = [
  {
    plugin: "agntux-build",
    relPath:
      "plugins/agntux-build/canonical/ui-handlers/_template/view-tool/src/lib/apps-client",
  },
];

function sha256(filePath: string): string | null {
  try {
    return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

export function pass12AppsClientDrift(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const canonicalDir = path.join(repoRoot, CANONICAL_REL);
  const canonicalHashes = new Map<string, string>();
  for (const name of REQUIRED_FILES) {
    const h = sha256(path.join(canonicalDir, name));
    if (h) canonicalHashes.set(name, h);
  }
  if (canonicalHashes.size !== REQUIRED_FILES.length) {
    // Canonical itself is broken. Report once against any plugin we lint
    // — but pluginSlug-scoped findings would surface it for every plugin
    // touched. Better to skip silently here; a higher-level check could
    // own "canonical integrity" if needed.
    return;
  }

  const viewToolDir = path.join(pluginDir, "view-tool");
  const hasViewTool =
    fs.existsSync(viewToolDir) && fs.statSync(viewToolDir).isDirectory();

  // Plugin-local check: view-tool/src/lib/apps-client/{file}.
  // Skip the canonical owner — it IS the source; comparing it to itself
  // is meaningless and would just add noise to lint output.
  if (hasViewTool && pluginSlug !== CANONICAL_OWNER) {
    const vendoredDir = path.join(viewToolDir, "src", "lib", "apps-client");
    for (const name of REQUIRED_FILES) {
      const filePath = path.join(vendoredDir, name);
      const relForReport = path.relative(pluginDir, filePath);
      if (!fs.existsSync(filePath)) {
        findings.push({
          code: "E27",
          severity: "warning",
          plugin: pluginSlug,
          file: relForReport,
          message:
            `Plugin ships view-tool/ but is missing the vendored ` +
            `apps-client file ${name}. Copy from ` +
            `${CANONICAL_REL}/${name} so the iframe entry can speak the ` +
            `MCP Apps JSON-RPC protocol.`,
        });
        continue;
      }
      const actual = sha256(filePath);
      const expected = canonicalHashes.get(name)!;
      if (actual !== expected) {
        findings.push({
          code: "E26",
          severity: "error",
          plugin: pluginSlug,
          file: relForReport,
          message:
            `Vendored apps-client copy drift. ${name} differs from the ` +
            `canonical at ${CANONICAL_REL}/${name} ` +
            `(expected sha256=${expected.slice(0, 12)}…, ` +
            `actual=${actual?.slice(0, 12) ?? "<unreadable>"}…). ` +
            `Re-copy from the canonical or update the canonical first.`,
        });
      }
    }
  }

  // Extra-copy checks: each EXTRA_COPIES entry is plugin-scoped, so we
  // only run it when its `plugin` matches the slug we're linting.
  for (const extra of EXTRA_COPIES) {
    if (extra.plugin !== pluginSlug) continue;
    const extraDir = path.join(repoRoot, extra.relPath);
    if (!fs.existsSync(extraDir)) continue;
    for (const name of REQUIRED_FILES) {
      const filePath = path.join(extraDir, name);
      const relForReport = path.relative(pluginDir, filePath);
      if (!fs.existsSync(filePath)) {
        findings.push({
          code: "E27",
          severity: "warning",
          plugin: pluginSlug,
          file: relForReport,
          message: `${extra.relPath}/${name} is missing. ` +
            `Copy from ${CANONICAL_REL}/${name}.`,
        });
        continue;
      }
      const actual = sha256(filePath);
      const expected = canonicalHashes.get(name)!;
      if (actual !== expected) {
        findings.push({
          code: "E26",
          severity: "error",
          plugin: pluginSlug,
          file: relForReport,
          message:
            `Vendored apps-client copy drift in ${extra.relPath}/${name} ` +
            `(expected sha256=${expected.slice(0, 12)}…, ` +
            `actual=${actual?.slice(0, 12) ?? "<unreadable>"}…). ` +
            `Re-copy from ${CANONICAL_REL}.`,
        });
      }
    }
  }
}
