/**
 * lint-handler-frontmatter.ts — Pass 6
 *
 * Validates UI-handler subagent frontmatter against P9 §5.
 *
 * Rules:
 *   - If agents/ui-handlers/{name}.md exists but has NO `operational:` key:
 *     emit W03 (warning — stub handler, not yet production-ready).
 *   - If `operational:` key exists, validate against OperationalManifestSchema.
 *     Each failing field emits an E12-* error.
 *
 * Emitted codes:
 *   W03  handler exists but has no operational frontmatter (stub)
 *   E12-verb-phrases-missing        verb_phrases array absent or empty
 *   E12-view-tool-missing           view_tool absent or blank
 *   E12-view-tool-malformed         view_tool doesn't match ^[a-z][a-z0-9_]*_view$
 *   E12-resource-uri-missing        resource_uri absent or blank
 *   E12-resource-uri-malformed      resource_uri doesn't start with "ui://"
 *   E12-structured-content-missing  structured_content_schema absent or empty
 *   E12-follow-up-intents-missing   follow_up_intents absent (required as array)
 *   E12-degraded-states-missing     degraded_states absent or empty
 *   E12-degraded-states-invalid     degraded_states.source_not_found absent or malformed
 *   E12-field-invalid               generic Zod validation failure on a known field
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { z } from "zod";
import type { Finding, Severity } from "../lint-marketplace-metadata.js";

// ---------------------------------------------------------------------------
// Operational manifest Zod schema (P9 §5.1)
// ---------------------------------------------------------------------------

const DegradedStateSchema = z.object({
  ui: z.enum(["no-render", "partial-render"]),
  action: z.string().min(1).max(280),
});

const SemverRe = /^\d+\.\d+(\.\d+)?$/;

export const OperationalManifestSchema = z.object({
  catalogue_version: z.string().regex(SemverRe).optional(),
  verb_phrases: z.array(z.string().min(1)).min(1),
  view_tool: z.string().regex(/^[a-z][a-z0-9_]*_view$/),
  resource_uri: z.string().startsWith("ui://"),
  structured_content_schema: z.array(z.string().min(1)).min(1),
  follow_up_intents: z.array(z.string().min(1)).default([]),
  degraded_states: z.object({
    source_not_found: DegradedStateSchema,
    source_auth_failed: DegradedStateSchema.optional(),
    draft_text_invalid: DegradedStateSchema.optional(),
  }),
});

export type OperationalManifest = z.infer<typeof OperationalManifestSchema>;

// ---------------------------------------------------------------------------
// YAML frontmatter extraction
// ---------------------------------------------------------------------------

/**
 * Extract YAML frontmatter from a markdown file.
 * Returns the parsed object, or null if no frontmatter is found.
 * Throws on YAML parse error.
 */
export function extractFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const parsed = yaml.load(match[1]);
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Map Zod issues to E12 sub-codes
// ---------------------------------------------------------------------------

function zodIssueToCode(issue: z.ZodIssue): string {
  const p = issue.path.join(".");

  if (p === "verb_phrases" || p.startsWith("verb_phrases.")) {
    return "E12-verb-phrases-missing";
  }
  if (p === "view_tool") {
    if (issue.code === "invalid_string" && issue.validation === "regex") {
      return "E12-view-tool-malformed";
    }
    return "E12-view-tool-missing";
  }
  if (p === "resource_uri") {
    if (issue.code === "invalid_string") {
      return "E12-resource-uri-malformed";
    }
    return "E12-resource-uri-missing";
  }
  if (
    p === "structured_content_schema" ||
    p.startsWith("structured_content_schema.")
  ) {
    return "E12-structured-content-missing";
  }
  if (
    p === "follow_up_intents" ||
    p.startsWith("follow_up_intents.")
  ) {
    return "E12-follow-up-intents-missing";
  }
  if (
    p === "degraded_states" ||
    p === "degraded_states.source_not_found" ||
    p.startsWith("degraded_states.source_not_found.")
  ) {
    if (p === "degraded_states") {
      return "E12-degraded-states-missing";
    }
    return "E12-degraded-states-invalid";
  }
  if (p.startsWith("degraded_states.")) {
    return "E12-degraded-states-invalid";
  }

  return "E12-field-invalid";
}

// ---------------------------------------------------------------------------
// Pass 6 — validate a single handler file
// ---------------------------------------------------------------------------

export function validateHandlerFile(
  handlerPath: string,
  pluginSlug: string,
  _handlerName: string,
  repoRoot: string,
  findings: Finding[],
): void {
  function relPath(p: string): string {
    return path.relative(repoRoot, p);
  }

  function emit(code: string, severity: Severity, message: string): void {
    findings.push({
      code,
      severity,
      plugin: pluginSlug,
      file: relPath(handlerPath),
      message,
    });
  }

  let content: string;
  try {
    content = fs.readFileSync(handlerPath, "utf-8");
  } catch (e) {
    emit("E12-field-invalid", "error", `cannot read handler file: ${String(e)}`);
    return;
  }

  let frontmatter: Record<string, unknown> | null;
  try {
    frontmatter = extractFrontmatter(content);
  } catch (e) {
    emit("E12-field-invalid", "error", `YAML frontmatter parse error: ${String(e)}`);
    return;
  }

  // No frontmatter at all — warn (W03)
  if (frontmatter === null) {
    emit(
      "W03",
      "warning",
      `${relPath(handlerPath)}: handler has no YAML frontmatter (stub handler — add operational: block for production use)`,
    );
    return;
  }

  // Frontmatter exists but no operational key — warn (W03, stub handler)
  if (!Object.prototype.hasOwnProperty.call(frontmatter, "operational")) {
    emit(
      "W03",
      "warning",
      `${relPath(handlerPath)}: handler has frontmatter but no operational: block (stub handler — add operational: block for production use)`,
    );
    return;
  }

  // operational key exists — validate against schema
  const operational = frontmatter["operational"];
  const result = OperationalManifestSchema.safeParse(operational);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const code = zodIssueToCode(issue);
      const pathStr = issue.path.length > 0 ? `operational.${issue.path.join(".")}: ` : "";
      emit(
        code,
        "error",
        `${relPath(handlerPath)}: ${pathStr}${issue.message}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 6 — entry point for a plugin directory
// ---------------------------------------------------------------------------

export function pass6HandlerFrontmatter(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  const uiHandlersDir = path.join(pluginDir, "agents", "ui-handlers");

  // No ui-handlers directory — no-op (e.g., agntux-slack case)
  if (!fs.existsSync(uiHandlersDir)) return;

  let entries: string[];
  try {
    entries = fs.readdirSync(uiHandlersDir);
  } catch {
    return;
  }

  const mdFiles = entries.filter((n) => n.endsWith(".md") && !n.startsWith("."));

  for (const fname of mdFiles) {
    const handlerName = fname.replace(/\.md$/, "");
    const handlerPath = path.join(uiHandlersDir, fname);
    validateHandlerFile(handlerPath, pluginSlug, handlerName, repoRoot, findings);
  }
}

// ---------------------------------------------------------------------------
// Pass 6 — also scans canonical/ui-handlers/{name}/handler/{name}.md
// ---------------------------------------------------------------------------

export function pass6CanonicalHandlers(
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
    const handlerDir = path.join(canonicalHandlersDir, dirName, "handler");
    const handlerFile = path.join(handlerDir, `${dirName}.md`);

    if (!fs.existsSync(handlerFile)) continue;

    validateHandlerFile(
      handlerFile,
      `canonical/${dirName}`,
      dirName,
      repoRoot,
      findings,
    );
  }
}
