/**
 * lint-skill-render.ts — pass 8: drift lint for the canonical sync-skill
 * render pipeline AND cross-plugin skill-quality invariants.
 *
 * Sync-skill drift checks (mandatory for any plugin shipping
 * skills/{plugin-slug}/SKILL.md rendered from canonical — every such
 * plugin MUST ship a matching _overrides/frontmatter.yaml so the
 * rendered output is reproducible):
 *
 *   1. No surviving {{...}} placeholders in any rendered *.md under skills/.
 *   2. Render reproducibility — running the renderer with the plugin's
 *      _overrides/ produces output byte-identical to what's currently
 *      committed under skills/{plugin-slug}/. Catches "edited the rendered
 *      file by hand instead of editing the override".
 *   3. Line budget — skills/{plugin-slug}/SKILL.md ≤ 500 lines (router
 *      shape — typically ≤ 100); every sibling *.md under
 *      skills/{plugin-slug}/reference/ ≤ 500 lines (the procedural
 *      `sync.md` body sits around 490; detail-shape siblings are
 *      smaller).
 *   4. One-level-deep references — every link from
 *      skills/{plugin-slug}/SKILL.md resolves to a file in the same
 *      directory or its reference/ child; reference files do NOT link to
 *      other reference files.
 *
 * Cross-plugin skill-quality checks (always-on for any plugin shipping
 * skills/, added in Phase 5 of the de-fork plan):
 *
 *   5. Per-skill line budget — every skills/{name}/SKILL.md ≤ 500 lines.
 *   6. Shared-sibling line budget — every shared skills/_*.md ≤ 200
 *      lines (tighter than per-skill reference/*.md because shared files
 *      are loaded by multiple skills).
 *   7. Reference-chain-depth — for every link from a skills/{name}/SKILL.md
 *      that targets a sibling skills/_*.md, that target file must NOT
 *      itself contain a markdown link to another sibling skills/_*.md
 *      file. Catches the regression where SKILL → _preconditions →
 *      _resolve-root chains start growing again.
 */

import * as fs from "node:fs";
import * as path from "node:path";
// @ts-expect-error — .mjs has no .d.ts
import { renderSkill, RenderSkillError } from "../render-skill.mjs";

export type Severity = "error" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  plugin: string;
  file: string;
  line?: number;
  message: string;
}

const SKILL_MAX_LINES = 500;
// reference/sync.md carries the procedural body that used to live in the old
// monolithic SKILL.md (which had a 500-line cap). Detail-shape siblings
// (fetch.md, cursor.md, runbook.md, deep-links.md, compose-payload.md,
// honesty.md, ask.md) all comfortably fit under the original 300, but
// sync.md is naturally ~500 — same allowance the procedural body used to get.
const RESOURCE_MAX_LINES = 500;
const SHARED_SIBLING_MAX_LINES = 200;

function rel(repoRoot: string, p: string): string {
  return path.relative(repoRoot, p);
}

function emit(findings: Finding[], f: Finding): void {
  findings.push(f);
}

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recursively list relative *.md paths under dir, sorted.
 */
function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  function rec(d: string, prefix: string) {
    if (!isDirectory(d)) return;
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const childRel = prefix ? `${prefix}/${name}` : name;
      if (isDirectory(full)) rec(full, childRel);
      else if (name.endsWith(".md")) out.push(childRel);
    }
  }
  rec(dir, "");
  return out;
}

/**
 * Compute canonical sync dir given a repo root.
 */
function canonicalSyncDir(repoRoot: string): string {
  return path.join(repoRoot, "canonical", "prompts", "ingest", "skills", "sync");
}

/**
 * Make a unique tmp dir under repoRoot that won't collide with another
 * plugin's render. We don't use os.tmpdir() because we want the path inside
 * the repo for diff-style debug if a developer wants to inspect.
 */
function tmpRenderDir(repoRoot: string, slug: string): string {
  return path.join(repoRoot, ".lint-skill-render-tmp", slug);
}

function rmDirSync(dir: string) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Read text file or "" on missing.
 */
function readOrEmpty(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

// ── invariant checks ─────────────────────────────────────────────────────────

function checkNoSurvivingPlaceholders(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const syncDir = path.join(pluginDir, "skills", pluginSlug);
  if (!isDirectory(syncDir)) return;
  for (const relPath of listMarkdown(syncDir)) {
    if (relPath.startsWith("_overrides/")) continue; // overrides may carry placeholders
    const full = path.join(syncDir, relPath);
    const body = fs.readFileSync(full, "utf8");
    const matches = [...body.matchAll(/\{\{([\w-]+)\}\}/g)];
    if (matches.length === 0) continue;
    const uniq = [...new Set(matches.map((m) => m[1]))];
    emit(findings, {
      code: "E15",
      severity: "error",
      plugin: pluginSlug,
      file: rel(repoRoot, full),
      message:
        `surviving {{...}} placeholders: ${uniq.join(", ")}. ` +
        `Add the missing keys to _overrides/frontmatter.yaml and re-run ` +
        `\`node scripts/render-skill.mjs ${pluginSlug}\`.`,
    });
  }
}

function checkRenderReproducibility(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const syncDir = path.join(pluginDir, "skills", pluginSlug);
  const overridesDir = path.join(syncDir, "_overrides");
  const tmpOut = tmpRenderDir(repoRoot, pluginSlug);
  rmDirSync(tmpOut);
  try {
    renderSkill({
      canonicalDir: canonicalSyncDir(repoRoot),
      overridesDir,
      outputDir: tmpOut,
    });
  } catch (e) {
    const msg =
      e instanceof RenderSkillError
        ? (e as Error).message
        : e instanceof Error
          ? e.message
          : String(e);
    emit(findings, {
      code: "E15",
      severity: "error",
      plugin: pluginSlug,
      file: rel(repoRoot, syncDir),
      message: `renderer threw: ${msg}`,
    });
    rmDirSync(tmpOut);
    return;
  }

  // Diff committed skills/{slug}/ against tmpOut. Note: we compare SKILL.md
  // and reference/*.md only — _overrides/ is the input, not the output.
  const committedFiles = listMarkdown(syncDir).filter(
    (r) => !r.startsWith("_overrides/"),
  );
  const renderedFiles = listMarkdown(tmpOut);

  const expected = new Set(renderedFiles);
  const actual = new Set(committedFiles);

  for (const r of expected) {
    if (!actual.has(r)) {
      emit(findings, {
        code: "E15",
        severity: "error",
        plugin: pluginSlug,
        file: rel(repoRoot, path.join(syncDir, r)),
        message:
          `renderer would produce ${r} but it is missing from the repo. ` +
          `Run \`node scripts/render-skill.mjs ${pluginSlug}\` and commit.`,
      });
    }
  }
  for (const r of actual) {
    if (!expected.has(r)) {
      emit(findings, {
        code: "E15",
        severity: "error",
        plugin: pluginSlug,
        file: rel(repoRoot, path.join(syncDir, r)),
        message:
          `${r} is in the repo but the renderer would not produce it. ` +
          `Either add a canonical or override source, or delete this file.`,
      });
    }
  }
  for (const r of expected) {
    if (!actual.has(r)) continue;
    const expectedBody = readOrEmpty(path.join(tmpOut, r));
    const actualBody = readOrEmpty(path.join(syncDir, r));
    if (expectedBody !== actualBody) {
      emit(findings, {
        code: "E15",
        severity: "error",
        plugin: pluginSlug,
        file: rel(repoRoot, path.join(syncDir, r)),
        message:
          `${r} differs from what the renderer would produce. ` +
          `Run \`node scripts/render-skill.mjs ${pluginSlug}\` and commit. ` +
          `Edit overrides under _overrides/, not the rendered output.`,
      });
    }
  }
  rmDirSync(tmpOut);
}

function checkLineBudget(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const syncDir = path.join(pluginDir, "skills", pluginSlug);
  const skillPath = path.join(syncDir, "SKILL.md");
  if (fileExists(skillPath)) {
    const lines = fs.readFileSync(skillPath, "utf8").split("\n").length;
    if (lines > SKILL_MAX_LINES) {
      emit(findings, {
        code: "E15",
        severity: "error",
        plugin: pluginSlug,
        file: rel(repoRoot, skillPath),
        message: `SKILL.md is ${lines} lines (max ${SKILL_MAX_LINES}). Move detail into reference/*.md.`,
      });
    }
  }
  const referenceDir = path.join(syncDir, "reference");
  if (isDirectory(referenceDir)) {
    for (const name of fs.readdirSync(referenceDir)) {
      if (!name.endsWith(".md")) continue;
      const full = path.join(referenceDir, name);
      const lines = fs.readFileSync(full, "utf8").split("\n").length;
      if (lines > RESOURCE_MAX_LINES) {
        emit(findings, {
          code: "E15",
          severity: "error",
          plugin: pluginSlug,
          file: rel(repoRoot, full),
          message: `reference/${name} is ${lines} lines (max ${RESOURCE_MAX_LINES}). Split it.`,
        });
      }
    }
  }
}

function checkOneLevelDeepReferences(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  // Markdown link grammar: [text](path). We extract path-with-no-protocol
  // and check it against allowed shapes:
  //   from SKILL.md   →  ./reference/{name}.md  OR  ./{sibling}.md  (allowed)
  //                   →  ./reference/{name}.md#anchor                  (allowed)
  //                   →  ./reference/{a}/{b}.md  (REJECTED — too deep)
  //   from reference/{name}.md →  ./{sibling-non-reference}.md        (allowed back-ref to SKILL)
  //                            →  ./other-reference.md  (REJECTED — sibling reference)
  // External links (http/https) and intra-file anchors (#section) are ignored.
  const syncDir = path.join(pluginDir, "skills", pluginSlug);
  const skillPath = path.join(syncDir, "SKILL.md");
  if (fileExists(skillPath)) {
    checkLinksInFile(pluginSlug, skillPath, "skill", repoRoot, findings);
  }
  const referenceDir = path.join(syncDir, "reference");
  if (isDirectory(referenceDir)) {
    for (const name of fs.readdirSync(referenceDir)) {
      if (!name.endsWith(".md")) continue;
      checkLinksInFile(
        pluginSlug,
        path.join(referenceDir, name),
        "reference",
        repoRoot,
        findings,
      );
    }
  }
}

function checkLinksInFile(
  pluginSlug: string,
  filePath: string,
  fileKind: "skill" | "reference",
  repoRoot: string,
  findings: Finding[],
): void {
  const body = fs.readFileSync(filePath, "utf8");
  const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const m of body.matchAll(linkRe)) {
    const target = m[1];
    if (/^https?:\/\//i.test(target)) continue;
    if (target.startsWith("#")) continue;
    if (target.startsWith("mailto:")) continue;
    // Strip anchor and any trailing query — we only care about the path part
    // for depth analysis.
    const pathPart = target.replace(/[#?].*$/, "");
    if (!pathPart || pathPart.endsWith("/")) continue;
    if (!pathPart.endsWith(".md")) continue;
    // Normalise leading ./
    const normalised = pathPart.replace(/^\.\//, "");
    const segments = normalised.split("/");

    if (fileKind === "skill") {
      // Allowed: <name>.md  OR  reference/<name>.md
      const ok =
        (segments.length === 1) ||
        (segments.length === 2 && segments[0] === "reference");
      if (!ok) {
        emit(findings, {
          code: "E15",
          severity: "error",
          plugin: pluginSlug,
          file: rel(repoRoot, filePath),
          message:
            `link target "${target}" is more than one level deep. ` +
            `Reference files must live directly under skills/${pluginSlug}/reference/.`,
        });
      }
    } else {
      // Reference file: must NOT link to another reference (one-level-deep rule).
      // Allowed: ../<sibling>.md (back-ref to SKILL.md or shared sibling)
      //          OR same-dir <name>.md ONLY when that's a non-reference file
      //          (we don't have any today; reject by default within the
      //          reference/ directory).
      const goesUp = normalised.startsWith("../");
      if (!goesUp) {
        emit(findings, {
          code: "E15",
          severity: "error",
          plugin: pluginSlug,
          file: rel(repoRoot, filePath),
          message:
            `reference file links to "${target}" — references must not link to other references. ` +
            `Move shared content into the parent SKILL.md, or duplicate.`,
        });
      } else if (segments.length > 2) {
        emit(findings, {
          code: "E15",
          severity: "error",
          plugin: pluginSlug,
          file: rel(repoRoot, filePath),
          message:
            `reference file link "${target}" goes deeper than one level above. ` +
            `Reference back-references must point to the parent skills/${pluginSlug}/ only.`,
        });
      }
    }
  }
}

// ── cross-plugin skill-quality checks (Phase 5) ──────────────────────────────

/**
 * List immediate child directories of `dir` (non-recursive).
 */
function listSubdirs(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => isDirectory(path.join(dir, name)))
    .sort();
}

/**
 * List shared `_*.md` files at `skills/` (non-recursive). The leading
 * underscore convention keeps these out of the slash-command surface
 * but they're loaded by multiple SKILL.md siblings.
 */
function listSharedSiblings(skillsDir: string): string[] {
  if (!isDirectory(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir)
    .filter((name) => name.startsWith("_") && name.endsWith(".md"))
    .filter((name) => !isDirectory(path.join(skillsDir, name)))
    .sort();
}

/**
 * Walk every link target in `body` that resolves to a sibling file
 * relative to `fileDir`, return the absolute paths of resolved targets.
 * External links (http/https), anchors, and mailto: are skipped.
 */
function extractSiblingLinks(body: string, fileDir: string): string[] {
  const out: string[] = [];
  const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const m of body.matchAll(linkRe)) {
    const target = m[1];
    if (/^https?:\/\//i.test(target)) continue;
    if (target.startsWith("#")) continue;
    if (target.startsWith("mailto:")) continue;
    const pathPart = target.replace(/[#?].*$/, "");
    if (!pathPart || !pathPart.endsWith(".md")) continue;
    out.push(path.resolve(fileDir, pathPart));
  }
  return out;
}

/**
 * Check 5 — per-skill line budget. Every skills/{name}/SKILL.md ≤ 500.
 * (The sync-skill drift check #3 already enforces this for skills/sync/SKILL.md
 * when the plugin opts in via _overrides/. This check is the always-on
 * superset, scoped to every named skill in the plugin.)
 */
function checkAllSkillsLineBudget(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const skillsDir = path.join(pluginDir, "skills");
  if (!isDirectory(skillsDir)) return;
  for (const name of listSubdirs(skillsDir)) {
    const skillFile = path.join(skillsDir, name, "SKILL.md");
    if (!fileExists(skillFile)) continue;
    const lines = fs.readFileSync(skillFile, "utf8").split("\n").length;
    if (lines > SKILL_MAX_LINES) {
      emit(findings, {
        code: "E15",
        severity: "error",
        plugin: pluginSlug,
        file: rel(repoRoot, skillFile),
        message:
          `SKILL.md is ${lines} lines (max ${SKILL_MAX_LINES}). ` +
          `Move detail into a sibling resources/*.md file or split the skill.`,
      });
    }
  }
}

/**
 * Check 6 — shared-sibling line budget. Every skills/_*.md ≤ 200 lines.
 */
function checkSharedSiblingsBudget(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const skillsDir = path.join(pluginDir, "skills");
  if (!isDirectory(skillsDir)) return;
  for (const name of listSharedSiblings(skillsDir)) {
    const full = path.join(skillsDir, name);
    const lines = fs.readFileSync(full, "utf8").split("\n").length;
    if (lines > SHARED_SIBLING_MAX_LINES) {
      emit(findings, {
        code: "E15",
        severity: "error",
        plugin: pluginSlug,
        file: rel(repoRoot, full),
        message:
          `${name} is ${lines} lines (max ${SHARED_SIBLING_MAX_LINES}). ` +
          `Shared siblings are loaded by multiple SKILL.md files; keep them tight.`,
      });
    }
  }
}

/**
 * Check 7 — reference-chain-depth. For every link from a SKILL.md to a
 * sibling shared `_*.md` file, that target file must NOT contain a
 * markdown link to another sibling shared `_*.md` file. Catches the
 * SKILL → _preconditions → _resolve-root regression.
 */
function checkChainDepth(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const skillsDir = path.join(pluginDir, "skills");
  if (!isDirectory(skillsDir)) return;
  for (const name of listSubdirs(skillsDir)) {
    const skillFile = path.join(skillsDir, name, "SKILL.md");
    if (!fileExists(skillFile)) continue;
    const skillBody = fs.readFileSync(skillFile, "utf8");
    const skillDir = path.dirname(skillFile);
    const targets = extractSiblingLinks(skillBody, skillDir);
    for (const target of targets) {
      // Only chain-check shared siblings (skills/_*.md).
      const targetParent = path.dirname(target);
      const targetName = path.basename(target);
      if (targetParent !== skillsDir) continue;
      if (!targetName.startsWith("_") || !targetName.endsWith(".md")) continue;
      if (!fileExists(target)) continue;
      const targetBody = fs.readFileSync(target, "utf8");
      const grandTargets = extractSiblingLinks(targetBody, targetParent);
      for (const grand of grandTargets) {
        const grandParent = path.dirname(grand);
        const grandName = path.basename(grand);
        if (grandParent !== skillsDir) continue;
        if (!grandName.startsWith("_") || !grandName.endsWith(".md")) continue;
        emit(findings, {
          code: "E15",
          severity: "error",
          plugin: pluginSlug,
          file: rel(repoRoot, target),
          message:
            `${targetName} links to sibling ${grandName} — that creates a ` +
            `2-level chain (${path.basename(skillFile)} → ${targetName} → ${grandName}). ` +
            `Inline the cross-reference or have ${path.basename(skillFile)} link to ` +
            `${grandName} directly.`,
        });
      }
    }
  }
}

// ── orchestrator ─────────────────────────────────────────────────────────────

/**
 * Pass 8 — sync-skill render drift AND cross-plugin skill-quality invariants.
 *
 * The sync-drift checks (#1–#4) fire for any plugin that ships a
 * skills/{plugin-slug}/SKILL.md and require a matching
 * _overrides/frontmatter.yaml. The cross-plugin checks (#5–#7) fire for
 * any plugin that ships a skills/ directory.
 */
export function pass8SkillRender(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const skillsDir = path.join(pluginDir, "skills");
  const syncDir = path.join(skillsDir, pluginSlug);
  const skillFile = path.join(syncDir, "SKILL.md");
  const overridesDir = path.join(syncDir, "_overrides");

  // Sync-skill render drift (#1–#4) — mandatory for any plugin shipping
  // skills/{plugin-slug}/SKILL.md. The _overrides/frontmatter.yaml is
  // required so the renderer can reproduce the committed tree byte-for-byte.
  if (fileExists(skillFile) && isDirectory(canonicalSyncDir(repoRoot))) {
    if (!isDirectory(overridesDir)) {
      emit(findings, {
        code: "E15",
        severity: "error",
        plugin: pluginSlug,
        file: rel(repoRoot, syncDir),
        message:
          `plugin ships skills/${pluginSlug}/SKILL.md but is missing ` +
          `skills/${pluginSlug}/_overrides/. Every sync skill must be rendered ` +
          `from canonical/prompts/ingest/skills/sync/ + an ` +
          `_overrides/frontmatter.yaml. See CLAUDE.md "Authoring sync skills".`,
      });
    } else {
      checkNoSurvivingPlaceholders(pluginSlug, pluginDir, repoRoot, findings);
      checkRenderReproducibility(pluginSlug, pluginDir, repoRoot, findings);
      checkLineBudget(pluginSlug, pluginDir, repoRoot, findings);
      checkOneLevelDeepReferences(pluginSlug, pluginDir, repoRoot, findings);
    }
  }

  // Cross-plugin skill-quality (#5–#7) — always-on for any plugin with skills/.
  if (isDirectory(skillsDir)) {
    checkAllSkillsLineBudget(pluginSlug, pluginDir, repoRoot, findings);
    checkSharedSiblingsBudget(pluginSlug, pluginDir, repoRoot, findings);
    checkChainDepth(pluginSlug, pluginDir, repoRoot, findings);
  }
}
