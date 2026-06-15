/**
 * lint-view-payload-coverage.ts — pass 19: every `## <View> payload` body
 * section a view-tool handler READS must be WRITTEN by the plugin's ingest
 * skill. Closes the writer/reader contract gap.
 *
 * Why this exists
 * ---------------
 * A view handler hydrates its iframe from a named YAML section it reads off the
 * action file on disk — `extractFencedYaml(body, "Respond payload")`,
 * `parseYamlSection(body, "Comment payload")`, etc. If the ingest skill's Step
 * 10 never writes that section, the handler returns an empty envelope and the
 * view renders fallback text — the 2026-06-15 google-calendar "Untitled event"
 * bug, and every Jira view rendering "… data is unavailable". The canonical
 * Step 10 documented only `## Compose payload`, so any plugin shipping a
 * second view inherited the gap.
 *
 * The guard: collect the section names the view-tool source reads, and require
 * each to be named in the plugin's rendered ingest `sync.md` (Step 10 /
 * per-view step-10 appends). A read section absent from sync.md is an error.
 *
 * Findings
 * --------
 *   E34 (error) — a `## <Name> payload` section is read by a view handler but
 *     not referenced by the plugin's skills/<slug>/reference/sync.md. Add a
 *     Step 10 instruction (per-view `_overrides/step-10-append.md`) telling the
 *     ingest skill to write the section, citing its reference shape.
 *
 * Scope
 * -----
 *   - Only plugins that ship BOTH a view-tool/src/ AND an ingest sync skill at
 *     skills/<slug>/reference/sync.md. A plugin with no ingest skill (e.g. the
 *     agntux-core hub) has no Step 10 to check against and is skipped.
 *   - Section names are read from `extractFencedYaml` / `parseYamlSection` /
 *     `parseSectionYaml` second string args, comment-scrubbed.
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

// `extractFencedYaml(body, "Respond payload")` / `parseYamlSection(body,
// "Comment payload")` / `parseSectionYaml(body, "Schedule payload")` — capture
// the section-name literal (2nd arg).
const SECTION_READ =
  /(?:extractFencedYaml|parseYamlSection|parseSectionYaml)\s*\(\s*[A-Za-z0-9_.]+\s*,\s*["'`]([^"'`]+)["'`]/g;

/** Strip comments, preserve string contents + newlines (see pass 17). */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const len = src.length;
  let inStr: string | null = null;
  while (i < len) {
    const c = src[i];
    const next = src[i + 1];
    if (inStr) {
      if (c === "\\") {
        out += c + (next ?? "");
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < len && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < len && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
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
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      collectSources(abs, srcRoot, acc);
      continue;
    }
    if (!e.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    const relFromSrc = path.relative(srcRoot, abs);
    if (isExcluded(relFromSrc)) continue;
    acc.push(abs);
  }
}

/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pass19ViewPayloadCoverage(
  pluginSlug: string,
  pluginDir: string,
  _repoRoot: string,
  findings: Finding[],
): void {
  const srcDir = path.join(pluginDir, VIEW_TOOL_SRC_REL);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) return;

  // The ingest skill we check the read sections against. The skill dir is not
  // always the plugin slug (e.g. agntux-core's skill is skills/agntux/), so
  // resolve it by finding the single skills/*/reference/sync.md rather than
  // assuming skills/<slug>/. No ingest sync.md → no Step 10 to verify against
  // (hub-only plugin); skip.
  const skillsRoot = path.join(pluginDir, "skills");
  let syncPath: string | null = null;
  if (fs.existsSync(skillsRoot) && fs.statSync(skillsRoot).isDirectory()) {
    for (const child of fs.readdirSync(skillsRoot).sort()) {
      const candidate = path.join(skillsRoot, child, "reference", "sync.md");
      if (fs.existsSync(candidate)) {
        syncPath = candidate;
        break;
      }
    }
  }
  if (!syncPath) return;
  let syncBody: string;
  try {
    syncBody = fs.readFileSync(syncPath, "utf8");
  } catch {
    return;
  }

  const files: string[] = [];
  collectSources(srcDir, srcDir, files);
  files.sort();

  // section name -> {file, line} of first read site (for the finding location)
  const reads = new Map<string, { file: string; line: number }>();
  for (const abs of files) {
    let body: string;
    try {
      body = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const scrubbed = stripComments(body);
    const lines = scrubbed.split("\n");
    const relFile = path.join(VIEW_TOOL_SRC_REL, path.relative(srcDir, abs));
    for (let li = 0; li < lines.length; li++) {
      SECTION_READ.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SECTION_READ.exec(lines[li])) !== null) {
        const name = m[1].trim();
        // Only YAML payload sections are written by Step 10; the helper is also
        // used to read non-payload sections in some plugins, so scope to the
        // "… payload" naming convention the ingest contract uses.
        if (!/payload$/i.test(name)) continue;
        if (!reads.has(name)) reads.set(name, { file: relFile, line: li + 1 });
      }
    }
  }

  const relSync = path.relative(pluginDir, syncPath);
  for (const [name, where] of Array.from(reads.entries())) {
    // Match the `## <Name> payload` heading form (case-insensitive), not a raw
    // substring — avoids a containment false-match ("work payload" inside
    // "homework payload") and a case-mismatch false positive.
    const headerRe = new RegExp("##\\s+" + escapeRegExp(name) + "\\b", "i");
    if (!headerRe.test(syncBody)) {
      findings.push({
        code: "E34",
        severity: "error",
        plugin: pluginSlug,
        file: where.file,
        line: where.line,
        message:
          `View handler reads the "## ${name}" section, but the ingest skill ` +
          `(${relSync}) never instructs writing it — so the action file lacks ` +
          `the section and the view renders an empty envelope (blank fields / ` +
          `fallback text). Add a Step 10 instruction in ` +
          `skills/${pluginSlug}/_overrides/step-10-append.md telling the skill ` +
          `to write "## ${name}" whenever the triggering suggested action ` +
          `ships, citing the ${name.replace(/ payload$/i, "").toLowerCase()}` +
          `-payload reference shape, then re-render.`,
      });
    }
  }
}
