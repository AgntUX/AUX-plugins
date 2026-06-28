/**
 * lint-namespaced-compose-read.ts — pass 22: a view that reads an on-disk
 * payload section must ALSO read its own namespaced cross-source header
 * `## Compose payload (<source-slug>)`.
 *
 * Why this exists
 * ---------------
 * The canonical Step 9 cross-source merge edits a *sibling* plugin's action
 * file (when another plugin already raised a `response-needed` action for the
 * same topic) and appends this plugin's payload under a NAMESPACED header —
 * `## Compose payload (<source-slug>)` — "so your view tool reads it without
 * colliding with a sibling plugin's payload". But a view handler that reads only
 * its canonical per-view header (`## Respond payload`, `## Comment payload`) or
 * the *bare* `## Compose payload` never reads that namespaced section, so a
 * cross-source-merged action renders an empty envelope — the 2026-06-18
 * agntux-google-calendar "Untitled event" bug (fixed in 0.7.1 by reading
 * `## Respond payload` ?? `## Compose payload (google-calendar)`).
 *
 * The guard: if the plugin's rendered ingest sync.md instructs writing a
 * namespaced `## Compose payload (<slug>)` section, at least one view-tool
 * handler must read that exact header. The fix is a literal-header fallback
 * read, e.g.
 *   parseSectionYaml(body, "Respond payload")
 *     ?? parseSectionYaml(body, "Compose payload (google-calendar)")
 * Keep BOTH reads as string literals so passes 19/20 (E34/E35) keep covering
 * them.
 *
 * Findings
 * --------
 *   E37 (warning) — sync.md writes `## Compose payload (<slug>)` (cross-source
 *     merge) but no view-tool handler reads that header. A cross-source-merged
 *     action renders blank. Warning (not error) so the cross-plugin sweep can
 *     land incrementally; promote to error once every view-shipping plugin
 *     reads its namespaced header.
 *
 * Scope
 * -----
 *   - Only plugins that ship BOTH a view-tool/src/ AND an ingest sync skill at
 *     skills/<slug>/reference/sync.md, AND whose view actually reads ≥1 on-disk
 *     section (an inline-only view that never touches disk is not exposed).
 *   - Read headers are taken from `extractFencedYaml` / `parseYamlSection` /
 *     `parseSectionYaml` second string args, comment-scrubbed — the same
 *     extraction as pass 19, but WITHOUT the `… payload$` filter so the
 *     `Compose payload (<slug>)` form is captured.
 *   - Views that hydrate through the runtime `parseComposePayload` helper
 *     (gmail's `parseActionFile().compose_payload`) read no literal header in
 *     their own source and are not detected here; their namespaced read lives in
 *     @agntux/plugin-runtime and is fixed there.
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

// `extractFencedYaml(body, "Respond payload")` / `parseSectionYaml(body,
// "Compose payload (google-calendar)")` — capture the section-name literal.
const SECTION_READ =
  /(?:extractFencedYaml|parseYamlSection|parseSectionYaml)\s*\(\s*[A-Za-z0-9_.]+\s*,\s*["'`]([^"'`]+)["'`]/g;

// The `## Compose payload (slug)` header the cross-source merge instructs
// writing. sync.md references it inline inside a prose bullet (e.g.
// "- Append a `## Compose payload (jira)` body section …"), not as a real
// heading line, so match the header text anywhere — not anchored to `^##…$`.
const NS_COMPOSE_WRITE = /(Compose payload \([a-z0-9-]+\))/g;

/** Strip comments, preserve string contents + newlines (shared with pass 19). */
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

export function pass22NamespacedComposeRead(
  pluginSlug: string,
  pluginDir: string,
  _repoRoot: string,
  findings: Finding[],
): void {
  const srcDir = path.join(pluginDir, VIEW_TOOL_SRC_REL);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) return;

  // Resolve the ingest sync.md (skill dir is not always the plugin slug). No
  // ingest sync.md → no cross-source merge to check (hub-only plugin); skip.
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

  // Namespaced compose headers the cross-source merge writes. None → skip.
  const nsHeaders = new Set<string>();
  NS_COMPOSE_WRITE.lastIndex = 0;
  let nm: RegExpExecArray | null;
  while ((nm = NS_COMPOSE_WRITE.exec(syncBody)) !== null) {
    nsHeaders.add(nm[1].trim());
  }
  if (nsHeaders.size === 0) return;

  // Collect every section-name literal the view-tool handlers read (no
  // `payload$` filter — we need the `Compose payload (slug)` form too). An
  // inline-only view reads nothing → not exposed to the cross-source merge.
  const files: string[] = [];
  collectSources(srcDir, srcDir, files);
  files.sort();

  const reads = new Set<string>();
  let firstReadLoc: { file: string; line: number } | null = null;
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
        reads.add(m[1].trim());
        if (!firstReadLoc) firstReadLoc = { file: relFile, line: li + 1 };
      }
    }
  }
  if (reads.size === 0) return;

  const readsLower = new Set(Array.from(reads, (r) => r.toLowerCase()));
  const where = firstReadLoc ?? { file: VIEW_TOOL_SRC_REL, line: 1 };
  const relSync = path.relative(pluginDir, syncPath);

  for (const ns of Array.from(nsHeaders).sort()) {
    if (readsLower.has(ns.toLowerCase())) continue;
    findings.push({
      code: "E37",
      severity: "warning",
      plugin: pluginSlug,
      file: where.file,
      line: where.line,
      message:
        `The cross-source merge in ${relSync} writes a namespaced ` +
        `"## ${ns}" section onto a sibling plugin's action file, but no ` +
        `view-tool handler reads that header — so a cross-source-merged ` +
        `action renders an empty envelope (blank fields / "Untitled" fallback ` +
        `text). Add a literal-header fallback read in view-tool/src, e.g. ` +
        `parseSectionYaml(body, "<your per-view header>") ?? ` +
        `parseSectionYaml(body, "${ns}"), keeping BOTH reads as string ` +
        `literals so passes 19/20 keep covering them (see ` +
        `agntux-google-calendar 0.7.1).`,
    });
  }
}
