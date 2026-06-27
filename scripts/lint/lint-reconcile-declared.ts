/**
 * lint-reconcile-declared.ts — pass 21: every action-producing ingest plugin
 * must declare its source-side reconciliation signals so Step 8.5 can auto-close
 * or refresh stale action items.
 *
 * Why this exists
 * ---------------
 * Canonical Step 8.5 ("Reconcile open action items against fresh data") closes
 * resolved items and refreshes changed ones, but the "what counts as resolved /
 * changed for THIS source" list is inherently per-source — a Jira status of
 * Done, a cancelled calendar event, a refunded charge. The canonical step splices
 * that list at the `<!-- append:step-reconcile -->` marker from each plugin's
 * `_overrides/step-reconcile-append.md`. Without it, the reconcile step has only
 * the generic skeleton and can't recognise the source's terminal/changed states,
 * so handled items stay open and noisy.
 *
 * The guard: a plugin that ships a view-tool (it raises actionable items) AND an
 * ingest sync skill must ship a non-empty
 * `skills/<slug>/_overrides/step-reconcile-append.md`. Missing or empty → E36.
 *
 * Findings
 * --------
 *   E36 (warning) — the plugin raises action items but ships no
 *     step-reconcile-append.md, so Step 8.5 can't recognise this source's
 *     resolved/changed signals. Author one declaring "Resolved when / Changed-
 *     but-valid when / Re-check via" per the reconcile reference shape.
 *
 * Severity rationale
 * ------------------
 * Warning, so the cross-plugin sweep can land incrementally within one PR.
 * Promote to error once every action-producing plugin ships the declaration.
 *
 * Scope
 * -----
 *   - Plugins with BOTH a view-tool/src/ AND an ingest sync skill at
 *     skills/<slug>/reference/sync.md. Fetch-only / hub-only plugins are skipped.
 */

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

/**
 * Locate the canonical-rendered ingest skill dir: skills/<slug> holding BOTH
 * reference/sync.md AND _overrides/frontmatter.yaml. The `_overrides/` directory
 * is the discriminator that excludes hand-authored skills like the agntux-core
 * hub (skills/agntux/), which ships a sync.md but is not a source-ingest plugin
 * and has no per-source reconcile signals to declare.
 */
function findSkillDir(pluginDir: string): string | null {
  const skillsRoot = path.join(pluginDir, "skills");
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) return null;
  for (const child of fs.readdirSync(skillsRoot).sort()) {
    const dir = path.join(skillsRoot, child);
    if (
      fs.existsSync(path.join(dir, "reference", "sync.md")) &&
      fs.existsSync(path.join(dir, "_overrides", "frontmatter.yaml"))
    ) {
      return dir;
    }
  }
  return null;
}

export function pass21ReconcileDeclared(
  pluginSlug: string,
  pluginDir: string,
  _repoRoot: string,
  findings: Finding[],
): void {
  const srcDir = path.join(pluginDir, "view-tool/src");
  const hasView = fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory();
  if (!hasView) return; // fetch-only plugins raise few/no actions — skip.

  const skillDir = findSkillDir(pluginDir);
  if (!skillDir) return; // no ingest skill — nothing to reconcile.

  const appendPath = path.join(skillDir, "_overrides", "step-reconcile-append.md");
  let ok = false;
  try {
    ok = fs.existsSync(appendPath) && fs.readFileSync(appendPath, "utf8").trim().length > 0;
  } catch {
    ok = false;
  }
  if (ok) return;

  findings.push({
    code: "E36",
    severity: "warning",
    plugin: pluginSlug,
    file: path.join("skills", path.basename(skillDir), "_overrides", "step-reconcile-append.md"),
    message:
      `Plugin raises action items but ships no non-empty ` +
      `step-reconcile-append.md, so Step 8.5 can't recognise this source's ` +
      `resolved/changed signals and handled items stay open. Author it ` +
      `(declaring "Resolved when / Changed-but-valid when / Re-check via" per ` +
      `the reconcile reference shape), then re-render.`,
  });
}
