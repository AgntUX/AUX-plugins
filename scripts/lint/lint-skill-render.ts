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

// ── PR #6 additions: ingest-skill semantic invariants ───────────────────────

// Check #8: every rendered ingest skill carries an "Out of scope" hard
// write-lane taxonomy. The autonomy-boundary rule is load-bearing — if a
// plugin author deletes the section in their override, off-lane writes
// stop being refused at the prompt layer (PR #4's validate-write-lane.mjs
// is the server-side teeth, but the prompt rule is the documentation
// surface).
function checkOutOfScopeSection(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const syncMd = path.join(pluginDir, "skills", pluginSlug, "reference", "sync.md");
  if (!fileExists(syncMd)) return;
  const body = fs.readFileSync(syncMd, "utf8");
  if (!/^##\s+Out of scope\b/m.test(body)) {
    emit(findings, {
      code: "E15",
      severity: "error",
      plugin: pluginSlug,
      file: rel(repoRoot, syncMd),
      message:
        `rendered reference/sync.md is missing the "## Out of scope" section. ` +
        `The autonomy-boundary write-lane taxonomy is canonical and load-bearing — ` +
        `if you stripped it via an override, restore it.`,
    });
    return;
  }
  // Verify the taxonomy actually carries the refuse-and-log signal,
  // not just an inert "Out of scope" header.
  const requiredMarkers = [
    "out-of-lane-write-attempted",
    "Permitted write lanes",
  ];
  for (const marker of requiredMarkers) {
    if (!body.includes(marker)) {
      emit(findings, {
        code: "E15",
        severity: "error",
        plugin: pluginSlug,
        file: rel(repoRoot, syncMd),
        message:
          `rendered reference/sync.md "Out of scope" section is missing the ` +
          `\`${marker}\` taxonomy element. The canonical autonomy-boundary rule ` +
          `expects both the refuse-and-log kind name and a "Permitted write lanes" ` +
          `enumeration. Re-run the renderer after restoring the canonical wording.`,
      });
    }
  }
}

// Check #9: when a plugin ships _overrides/reference/contract-lock.md, that
// file MUST NOT authorise writes to data/schema/ or schema.lock.json — the
// canonical out-of-scope rule forbids it and the runtime hook refuses it.
// Catches malformed overrides at lint time so they never reach runtime.
function checkContractLockExitClean(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const override = path.join(
    pluginDir,
    "skills",
    pluginSlug,
    "_overrides",
    "reference",
    "contract-lock.md",
  );
  if (!fileExists(override)) return;
  const body = fs.readFileSync(override, "utf8");
  // Refuse-and-log markers: presence of one of these phrases AND no
  // "Edit ..." / "Write ..." instruction targeting data/schema/.
  const writeAuthMarkers = [
    /Edit\s+.*data\/schema\//i,
    /Write\s+.*data\/schema\//i,
    /Edit\s+.*schema\.lock\.json/i,
    /Write\s+.*schema\.lock\.json/i,
    /[Aa]dd a sibling key.*plugin_contracts/,
    /[Bb]ump\s+`?schema\.lock\.json`?/i,
  ];
  for (const re of writeAuthMarkers) {
    if (re.test(body)) {
      emit(findings, {
        code: "E15",
        severity: "error",
        plugin: pluginSlug,
        file: rel(repoRoot, override),
        message:
          `_overrides/reference/contract-lock.md authorises a write to ` +
          `data/schema/ or schema.lock.json (matched pattern: ${re.toString()}). ` +
          `Per the canonical "Out of scope" rule, the ingest skill MUST exit-clean ` +
          `on contract drift — emit \`kind: contract-version-drift\` (or ` +
          `\`contract-not-registered\`) and let \`/agntux schema\` Mode B own the ` +
          `lock fix. Rewrite this file to refuse-and-log; PR #4's ` +
          `validate-write-lane.mjs hook will refuse the write at runtime regardless.`,
      });
      return; // one error per file is enough
    }
  }
}

// Check #10: an _overrides/reference/{name}.md MUST NOT be byte-identical
// to its canonical sibling (after substitution). A verbatim duplicate adds
// no value and silently drifts when canonical changes.
function checkOverrideNotIdenticalToCanonical(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const overrideRefDir = path.join(
    pluginDir,
    "skills",
    pluginSlug,
    "_overrides",
    "reference",
  );
  const canonicalRefDir = path.join(canonicalSyncDir(repoRoot), "reference");
  if (!isDirectory(overrideRefDir) || !isDirectory(canonicalRefDir)) return;
  const overrideFiles = listMarkdown(overrideRefDir);
  for (const relPath of overrideFiles) {
    const overridePath = path.join(overrideRefDir, relPath);
    const name = path.basename(overridePath);
    const canonicalPath = path.join(canonicalRefDir, name);
    if (!fileExists(canonicalPath)) continue; // additive override, no canonical sibling
    const overrideBody = fs.readFileSync(overridePath, "utf8");
    const canonicalBody = fs.readFileSync(canonicalPath, "utf8");
    if (overrideBody === canonicalBody) {
      emit(findings, {
        code: "E15",
        severity: "error",
        plugin: pluginSlug,
        file: rel(repoRoot, overridePath),
        message:
          `_overrides/reference/${name} is byte-identical to canonical/${name}. ` +
          `A verbatim duplicate adds no value and silently drifts when canonical ` +
          `changes. Either delete the override (canonical takes effect) or make ` +
          `it source-specific (the file should be a wholesale replacement, not a copy).`,
      });
    }
  }
}

// Check #11: every plugin's _overrides/frontmatter.yaml that uses canonical
// must declare a permitted-error-kinds: list. The canonical sync.md and
// runbook.md reference this taxonomy; missing means errors: entries cannot
// be validated against a known set.
function checkPermittedErrorKindsDeclared(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const fm = path.join(
    pluginDir,
    "skills",
    pluginSlug,
    "_overrides",
    "frontmatter.yaml",
  );
  if (!fileExists(fm)) return; // no canonical-rendered skill; nothing to validate
  const body = fs.readFileSync(fm, "utf8");
  if (!/^permitted-error-kinds:/m.test(body)) {
    emit(findings, {
      code: "E15",
      severity: "warning",
      plugin: pluginSlug,
      file: rel(repoRoot, fm),
      message:
        `_overrides/frontmatter.yaml is missing the permitted-error-kinds: ` +
        `declaration. Canonical reference/runbook.md treats this as the ` +
        `single source of truth for the kind: taxonomy used by ` +
        `validate-write-lane.mjs and \`errors:\` entry validation. Declare ` +
        `the canonical generic kinds plus your plugin-specific extensions ` +
        `(see plugins/agntux-slack/_overrides/frontmatter.yaml for the shape).`,
    });
  }
}

// ── orchestrator ─────────────────────────────────────────────────────────────

/**
 * Pass 8 — sync-skill render drift AND cross-plugin skill-quality invariants.
 *
 * The sync-drift checks (#1–#4) fire for any plugin that ships a
 * skills/{plugin-slug}/SKILL.md and require a matching
 * _overrides/frontmatter.yaml. The cross-plugin checks (#5–#7) fire for
 * any plugin that ships a skills/ directory. The semantic checks (#8–#11,
 * added by PR #6) enforce the autonomy-boundary taxonomy, contract-lock
 * exit-clean rule, and override-not-duplicate invariant.
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
      // Semantic invariants (PR #6).
      checkOutOfScopeSection(pluginSlug, pluginDir, repoRoot, findings);
      checkContractLockExitClean(pluginSlug, pluginDir, repoRoot, findings);
      checkOverrideNotIdenticalToCanonical(pluginSlug, pluginDir, repoRoot, findings);
      checkPermittedErrorKindsDeclared(pluginSlug, pluginDir, repoRoot, findings);
    }
  }

  // Cross-plugin skill-quality (#5–#7) — always-on for any plugin with skills/.
  if (isDirectory(skillsDir)) {
    checkAllSkillsLineBudget(pluginSlug, pluginDir, repoRoot, findings);
    checkSharedSiblingsBudget(pluginSlug, pluginDir, repoRoot, findings);
    checkChainDepth(pluginSlug, pluginDir, repoRoot, findings);
  }
}
