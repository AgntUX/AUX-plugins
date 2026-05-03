/**
 * lint-no-third-party-in-views.ts — Pass 7
 *
 * For every plugin's mcp-server/src/tools/*.ts AND every
 * canonical/ui-handlers/{name}/mcp-server/src/tools/*.ts, grep for "mcp__"
 * references. Reject any reference that is NOT from the plugin's own namespace.
 *
 * Allowed patterns:
 *   mcp__{{plugin-slug}}__*      own-plugin placeholder form (canonical templates)
 *   mcp__{{plugin-slug}}-ui__*  own-plugin UI server namespace (canonical templates)
 *   mcp__<plugin-slug>__*       actual plugin slug namespace (plugins/<slug>/)
 *   mcp__<plugin-slug>-ui__*    actual plugin slug UI namespace (plugins/<slug>/)
 *
 * Rejected: any other mcp__<source>__* reference.
 *
 * Emitted codes:
 *   E13  third-party MCP reference found in a view/tool file
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Finding } from "../lint-marketplace-metadata.js";

// ---------------------------------------------------------------------------
// Core grep logic (also exported for use in tests)
// ---------------------------------------------------------------------------

/** A single disallowed mcp__ reference found in a file. */
export interface ThirdPartyViolation {
  /** Relative path to the file (relative to repoRoot). */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The disallowed reference string (e.g., "mcp__slack__send_message"). */
  ref: string;
}

/** Regex that matches any mcp__<word>__<word> token. */
const MCP_REF_RE = /mcp__[a-zA-Z0-9_{}.-]+__[a-zA-Z0-9_-]+/g;

/**
 * Extract all mcp__*__* references from a string.
 */
export function extractMcpReferences(content: string): string[] {
  return [...content.matchAll(MCP_REF_RE)].map((m) => m[0]);
}

/**
 * Return true if `ref` is allowed for the given plugin slug.
 *
 * Allowed:
 *   - Canonical template placeholder form:  mcp__{{plugin-slug}}__*  or  mcp__{{plugin-slug}}-ui__*
 *   - Own-plugin resolved form:             mcp__<slug>__*           or  mcp__<slug>-ui__*
 */
export function isAllowedReference(ref: string, pluginSlug: string): boolean {
  // Template placeholder forms (used in canonical templates before P6 substitution)
  if (ref.startsWith("mcp__{{")) return true;

  // Own-plugin resolved forms
  const ownPrefix = `mcp__${pluginSlug}__`;
  const ownUiPrefix = `mcp__${pluginSlug}-ui__`;
  if (ref.startsWith(ownPrefix) || ref.startsWith(ownUiPrefix)) return true;

  return false;
}

/**
 * Scan all *.ts files in `toolsDir` for disallowed mcp__ references.
 * Returns violations as `{ relFile, line, ref }` objects.
 * `relFile` is relative to `repoRoot`.
 */
export function scanToolsDir(
  toolsDir: string,
  pluginSlug: string,
  repoRoot: string,
): ThirdPartyViolation[] {
  const violations: ThirdPartyViolation[] = [];

  if (!fs.existsSync(toolsDir)) return violations;

  let entries: string[];
  try {
    entries = fs.readdirSync(toolsDir);
  } catch {
    return violations;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".ts") && !entry.endsWith(".js")) continue;
    const filePath = path.join(toolsDir, entry);
    const relFile = path.relative(repoRoot, filePath);

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Skip comment lines — mcp__ references in comments are documentation
      // of what the HOST calls, not violations of the no-third-party rule.
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

      // Skip mcp__ references that appear *inside* a `description:` quoted
      // string value — these are tool descriptor documentation strings that
      // name the source MCP tool the host calls, not actual calls from the
      // view tool. We must scope the skip to the quoted region itself, not
      // the whole line, otherwise a bad-faith author could chain a benign
      // `description:` field before a real runtime call and bypass E13.
      // Pattern: `description: "...mcp__source__tool..."` — the ref must
      // be inside the matched quoted string, immediately following the
      // `description:` key.
      const line = lines[i];
      const refs = extractMcpReferences(line);
      if (refs.length === 0) continue;

      // Find every `description: "..."` (or '...' or `...`) quoted region.
      const descriptionRegions: Array<[number, number]> = [];
      const descRe = /description:\s*(["'`])((?:\\.|(?!\1).)*)\1/g;
      let descMatch: RegExpExecArray | null;
      while ((descMatch = descRe.exec(line)) !== null) {
        const quoteChar = descMatch[1];
        const contentStart = descMatch.index + descMatch[0].indexOf(quoteChar) + 1;
        const contentEnd = contentStart + descMatch[2].length;
        descriptionRegions.push([contentStart, contentEnd]);
      }

      // For each ref, walk every occurrence on the line. A ref is skipped
      // ONLY if every occurrence sits inside a description-quoted region.
      // Any occurrence outside such a region is a real violation.
      for (const ref of refs) {
        let searchFrom = 0;
        let allInDescription = true;
        let foundAny = false;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const idx = line.indexOf(ref, searchFrom);
          if (idx === -1) break;
          foundAny = true;
          const inDesc = descriptionRegions.some(
            ([s, e]) => idx >= s && idx < e,
          );
          if (!inDesc) {
            allInDescription = false;
            break;
          }
          searchFrom = idx + ref.length;
        }
        if (foundAny && allInDescription) continue;

        if (!isAllowedReference(ref, pluginSlug)) {
          violations.push({ file: relFile, line: i + 1, ref });
        }
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Pass 7 — entry point for a plugin directory
// ---------------------------------------------------------------------------

export function pass7NoThirdPartyInViews(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const toolsDir = path.join(pluginDir, "mcp-server", "src", "tools");

  // No mcp-server/src/tools directory — no-op (e.g., agntux-slack case)
  if (!fs.existsSync(toolsDir)) return;

  const violations = scanToolsDir(toolsDir, pluginSlug, repoRoot);

  for (const v of violations) {
    findings.push({
      code: "E13",
      severity: "error",
      plugin: pluginSlug,
      file: v.file,
      line: v.line,
      message: `${v.file}:${v.line}: disallowed third-party MCP reference "${v.ref}" — view tools must not call source MCPs directly (P9 §2.7). Route mutations via sendFollowUpMessage → host → source MCP.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Pass 7 — also scans canonical/ui-handlers/*/mcp-server/src/tools/
// ---------------------------------------------------------------------------

export function pass7CanonicalHandlers(
  repoRoot: string,
  findings: Finding[],
): void {
  const canonicalHandlersDir = path.join(repoRoot, "canonical", "ui-handlers");

  if (!fs.existsSync(canonicalHandlersDir)) return;

  let handlerDirs: string[];
  try {
    handlerDirs = fs.readdirSync(canonicalHandlersDir);
  } catch {
    return;
  }

  for (const dirName of handlerDirs) {
    if (dirName.startsWith(".")) continue;

    // Canonical handlers use the placeholder slug "{{plugin-slug}}" for allow-list
    // checks, because the tool files contain mcp__{{plugin-slug}}__* references
    // that P6 substitutes at generation time.
    const toolsDir = path.join(
      canonicalHandlersDir,
      dirName,
      "mcp-server",
      "src",
      "tools",
    );

    if (!fs.existsSync(toolsDir)) continue;

    // For canonical templates, use a sentinel that matches the {{plugin-slug}} placeholder.
    // isAllowedReference already handles mcp__{{...}}* — we pass an empty slug
    // so that the only allowed forms are the template placeholder forms.
    const violations = scanToolsDir(toolsDir, "__canonical_placeholder__", repoRoot);

    for (const v of violations) {
      findings.push({
        code: "E13",
        severity: "error",
        plugin: `canonical/${dirName}`,
        file: v.file,
        line: v.line,
        message: `${v.file}:${v.line}: disallowed third-party MCP reference "${v.ref}" in canonical handler — view tools must not call source MCPs directly (P9 §2.7).`,
      });
    }
  }
}
