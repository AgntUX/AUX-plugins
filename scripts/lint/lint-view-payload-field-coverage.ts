/**
 * lint-view-payload-field-coverage.ts — pass 20: every FIELD a view-tool
 * handler reads off an on-disk payload object must be DOCUMENTED as written by
 * the plugin's ingest skill. Tightens pass 19 (E34) from heading-coverage to
 * field-coverage.
 *
 * Why this exists
 * ---------------
 * Pass 19 only checks the `## <View> payload` *heading* exists somewhere in the
 * rendered sync.md. That lets the apple-notes class slip through: the view read
 * `cp.draft_title` / `cp.draft_body` / `cp.target_folder`, but the plugin
 * inherited the generic reply-centric schema (`drafted_body` / `thread_context`)
 * and shipped no compose-payload override, so the ingest agent was never told to
 * write the note fields the view reads. The heading matched; the fields didn't.
 * The iframe rendered blank.
 *
 * The guard: find each handler's on-disk payload variable (the object returned
 * by a payload-parse call), collect the field keys it reads off that variable,
 * and require each key to appear (as a whole word) somewhere in the plugin's
 * rendered skill tree (sync.md + reference/*.md) — i.e. the ingest skill
 * documents writing it. A read field absent from the whole skill tree is an
 * error (E35): the field-name the view reads is one the ingest never writes.
 *
 * Findings
 * --------
 *   E35 (error) — a field `<key>` read off a parsed payload object in a
 *     view handler is not documented anywhere in the plugin's rendered ingest
 *     skill, so the action file will lack it and the view shows a blank field.
 *     Author the field into the plugin's `_overrides/reference/compose-payload.md`
 *     (or per-view `*-payload.md`) AND a `_overrides/step-10-append.md`
 *     instruction to write it, then re-render.
 *
 * Severity rationale
 * ------------------
 * Error (fail-closed). This started as a warning because static field linkage
 * is best-effort: view handlers parse on-disk payloads heterogeneously (fenced
 * `## Compose payload` YAML, per-view `## <View> payload` sections,
 * frontmatter-metadata extraction, `extractSection`), so it can miss a
 * documented synonym. Two facts flipped it to error: (1) every plugin under
 * `plugins/` is clean at promotion time (the marketplace lint passed with zero
 * E35 across all 21), so it breaks no shipping plugin; (2) the blank-view class
 * it guards (the apple-notes / docusign incident — view reads keys ingest never
 * writes) is a hard contributor-facing defect that must never ship, which is
 * exactly what a fail-closed gate prevents. The scope note below bounds the
 * false-positive surface: the pass only links object-member reads, so the
 * heterogeneous string-parse handlers it can't statically link are skipped
 * entirely rather than flagged — it errs toward silence, not a false error.
 *
 * Scope
 * -----
 *   - Plugins that ship BOTH a view-tool/src/ AND a rendered ingest sync skill
 *     (skills/<slug>/reference/sync.md + _overrides/frontmatter.yaml). Hub-only
 *     (no _overrides) / fetch-only (no view-tool) plugins are skipped.
 *   - Out of scope by construction: handlers that read a payload as a raw STRING
 *     section and line-parse it (`extractSection(body, …)` then `.split("\n")`,
 *     e.g. agntux-docusign) — there is no `payloadVar.field` member access to
 *     link, so the field set can't be recovered statically. Those handlers get
 *     no E35 coverage (acceptable: warning-only guard, and the contract is still
 *     covered at the heading level by pass 19 / E34).
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

const VIEW_TOOL_SRC_REL = "view-tool/src";

// Calls whose return value is an on-disk payload OBJECT the view reads fields
// off of. `extractFencedYaml` returns a raw string (it's fed to parseYaml), so
// it is NOT in this set — we track the object the string parses into. Plugins
// with a bespoke per-source parser (slack's parseSlackComposePayload /
// parseSlackCanvasPayload) are named explicitly; the generic `parse*Payload`
// shape is also matched so a new source's parser is covered without an edit.
const PAYLOAD_PARSE_CALL =
  /(?:parseYamlSection|parseSectionYaml|parseComposeSectionYaml|parseComposePayload|parseSlackComposePayload|parseSlackCanvasPayload|parse[A-Z]\w*Payload|extractFrontmatterMetadata|parseYaml)\s*\(/;

// `const cp = <payload-parse-call>(...)` / `let raw = parseYaml(...)` — tolerate
// an optional TS type annotation between the var name and `=` (notion/posthog
// write `const fm: Record<string, unknown> = extractFrontmatterMetadata(...)`;
// without this the annotation defeats the match and the pass is a silent no-op).
const PAYLOAD_VAR_ASSIGN = new RegExp(
  String.raw`\b(?:const|let|var)\s+(\w+)\s*(?::\s*[^=\n;]+)?=\s*(?:await\s+)?` +
    PAYLOAD_PARSE_CALL.source,
  "g",
);

// `const onDisk = parsed.compose_payload;` — the @agntux/plugin-runtime
// parseActionFile() shape (gmail/slack/calendar).
const COMPOSE_PROP_ASSIGN =
  /\b(?:const|let|var)\s+(\w+)\s*=\s*\w+\.compose_payload\b/g;

// Standard ActionFrontmatter keys — read off the frontmatter object, not the
// payload, and never authored in a payload section. Excluded defensively.
const FRONTMATTER_KEYS = new Set([
  "id", "type", "status", "priority", "reason_class", "reason_detail",
  "created_at", "updated_at", "source", "source_ref", "related_entities",
  "entity_refs", "due_by", "snoozed_until", "completed_at", "dismissed_at",
  "deferred_at", "superseded_at", "superseded_by", "dismissed_reason",
  "suggested_actions", "schema_version",
]);

/** Strip // and /* *​/ comments, preserving string contents + newlines. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const len = src.length;
  let inStr: string | null = null;
  while (i < len) {
    const c = src[i];
    const next = src[i + 1];
    if (inStr) {
      if (c === "\\") { out += c + (next ?? ""); i += 2; continue; }
      if (c === inStr) inStr = null;
      out += c; i++; continue;
    }
    if (c === "/" && next === "/") {
      while (i < len && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && next === "*") {
      out += "  "; i += 2;
      while (i < len && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " "; i++;
      }
      out += "  "; i += 2; continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

function isExcluded(relFromSrc: string): boolean {
  const parts = relFromSrc.split(path.sep);
  if (parts.includes("lib")) return true;
  if (parts.includes("__tests__")) return true;
  if (parts.some((p) => p === "test-utils")) return true;
  const base = parts[parts.length - 1];
  if (base.endsWith(".d.ts")) return true;
  if (base === "setup.ts") return true;
  return false;
}

function collectSources(dir: string, srcRoot: string, acc: string[]): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { collectSources(abs, srcRoot, acc); continue; }
    if (!e.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    const relFromSrc = path.relative(srcRoot, abs);
    if (isExcluded(relFromSrc)) continue;
    acc.push(abs);
  }
}

/**
 * Locate the canonical-rendered ingest skill dir: skills/<slug> holding BOTH
 * reference/sync.md AND _overrides/frontmatter.yaml. The `_overrides/` check
 * excludes the hand-authored agntux-core hub skill (skills/agntux/), which is
 * not a source-ingest plugin.
 */
function findSyncDir(pluginDir: string): string | null {
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

/** Concatenate the plugin's rendered skill tree (sync.md + every reference/*.md). */
function readSkillTreeText(skillDir: string): string {
  let text = "";
  const refDir = path.join(skillDir, "reference");
  let names: string[] = [];
  try { names = fs.readdirSync(refDir).filter((n) => n.endsWith(".md")); } catch { /* */ }
  for (const n of names) {
    try { text += "\n" + fs.readFileSync(path.join(refDir, n), "utf8"); } catch { /* */ }
  }
  try { text += "\n" + fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"); } catch { /* */ }
  return text;
}

export function pass20ViewPayloadFieldCoverage(
  pluginSlug: string,
  pluginDir: string,
  _repoRoot: string,
  findings: Finding[],
): void {
  const srcDir = path.join(pluginDir, VIEW_TOOL_SRC_REL);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) return;

  const skillDir = findSyncDir(pluginDir);
  if (!skillDir) return;
  const skillText = readSkillTreeText(skillDir);

  const files: string[] = [];
  collectSources(srcDir, srcDir, files);
  files.sort();

  // key -> first {file, line} read site
  const reads = new Map<string, { file: string; line: number }>();

  for (const abs of files) {
    let raw: string;
    try { raw = fs.readFileSync(abs, "utf8"); } catch { continue; }
    const src = stripComments(raw);
    const relFile = path.join(VIEW_TOOL_SRC_REL, path.relative(srcDir, abs));

    // 1. Find the payload variable names in this file.
    const payloadVars = new Set<string>();
    for (const re of [PAYLOAD_VAR_ASSIGN, COMPOSE_PROP_ASSIGN]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) payloadVars.add(m[1]);
    }
    if (payloadVars.size === 0) continue;

    // 2. Collect keys read off those vars: member access `var.key` and
    //    destructuring `const { a, b } = var`.
    const lines = src.split("\n");
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      for (const v of payloadVars) {
        // member access
        const memberRe = new RegExp(String.raw`\b${v}\.(\w+)\b`, "g");
        let mm: RegExpExecArray | null;
        while ((mm = memberRe.exec(line)) !== null) {
          recordKey(mm[1], relFile, li + 1, reads);
        }
        // destructuring
        const destrRe = new RegExp(
          String.raw`\{([^}]*)\}\s*=\s*${v}\b`, "g",
        );
        let dm: RegExpExecArray | null;
        while ((dm = destrRe.exec(line)) !== null) {
          for (const part of dm[1].split(",")) {
            const key = part.split(":")[0].trim().replace(/\.\.\./, "");
            if (/^\w+$/.test(key)) recordKey(key, relFile, li + 1, reads);
          }
        }
      }
    }
  }

  for (const [key, where] of Array.from(reads.entries())) {
    const wordRe = new RegExp("\\b" + key + "\\b");
    if (!wordRe.test(skillText)) {
      findings.push({
        code: "E35",
        severity: "error",
        plugin: pluginSlug,
        file: where.file,
        line: where.line,
        message:
          `View handler reads payload field \`${key}\`, but no rendered ingest ` +
          `skill file (skills/${path.basename(skillDir)}/reference/*.md or SKILL.md) ` +
          `documents writing it — so the action file lacks it and the view shows ` +
          `a blank field (the apple-notes class). Add \`${key}\` to the plugin's ` +
          `_overrides/reference/compose-payload.md (or per-view *-payload.md) and a ` +
          `_overrides/step-10-append.md instruction to pre-compose it, then re-render.`,
      });
    }
  }
}

function recordKey(
  key: string,
  file: string,
  line: number,
  reads: Map<string, { file: string; line: number }>,
): void {
  if (FRONTMATTER_KEYS.has(key)) return;
  // skip obvious non-field accessors
  if (key.length < 2) return;
  if (!reads.has(key)) reads.set(key, { file, line });
}
