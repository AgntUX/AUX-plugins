#!/usr/bin/env node
/**
 * lint-marketplace-metadata.ts
 *
 * Five-pass linter for AgntUX marketplace plugin metadata. P15 §5.
 *
 * Usage:
 *   tsx scripts/lint-marketplace-metadata.ts [--plugin <slug>] [--json] [--fix]
 *
 * Exit codes:
 *   0 — no errors (warnings are allowed)
 *   1 — one or more errors
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { imageSize } from "image-size";
import { ListingSchema } from "../lib/marketplace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function emit(findings: Finding[], f: Finding): void {
  findings.push(f);
}

// ---------------------------------------------------------------------------
// Pass 1 — Required files (E01)
// ---------------------------------------------------------------------------

function pass1RequiredFiles(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  function rel(p: string): string {
    return path.relative(repoRoot, p);
  }

  const required = [
    path.join(pluginDir, "marketplace", "listing.yaml"),
    path.join(pluginDir, "marketplace", "icon.png"),
    path.join(pluginDir, "README.md"),
    path.join(pluginDir, "CHANGELOG.md"),
  ];

  for (const f of required) {
    if (!fileExists(f)) {
      emit(findings, {
        code: "E01",
        severity: "error",
        plugin: pluginSlug,
        file: rel(f),
        message: `missing required file: ${rel(f)}`,
      });
    }
  }

  // screenshots dir must exist and contain >= 1 file
  const screenshotsDir = path.join(pluginDir, "marketplace", "screenshots");
  if (!isDirectory(screenshotsDir)) {
    emit(findings, {
      code: "E01",
      severity: "error",
      plugin: pluginSlug,
      file: rel(screenshotsDir),
      message: `missing required directory: ${rel(screenshotsDir)} (must contain >= 1 screenshot)`,
    });
  } else {
    const files = fs.readdirSync(screenshotsDir).filter((n) => !n.startsWith("."));
    if (files.length === 0) {
      emit(findings, {
        code: "E01",
        severity: "error",
        plugin: pluginSlug,
        file: rel(screenshotsDir),
        message: `${rel(screenshotsDir)} must contain at least 1 screenshot`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 2 — YAML schema via Zod (E04/E05/E06/E11)
// ---------------------------------------------------------------------------

function pass2Schema(
  pluginSlug: string,
  pluginDir: string,
  pluginsDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  function rel(p: string): string {
    return path.relative(repoRoot, p);
  }

  const listingPath = path.join(pluginDir, "marketplace", "listing.yaml");
  if (!fileExists(listingPath)) return; // already reported by pass1

  let raw: string;
  try {
    raw = fs.readFileSync(listingPath, "utf-8");
  } catch (e) {
    emit(findings, {
      code: "E05",
      severity: "error",
      plugin: pluginSlug,
      file: rel(listingPath),
      message: `cannot read listing.yaml: ${String(e)}`,
    });
    return;
  }

  // Reject BOM
  if (raw.charCodeAt(0) === 0xfeff) {
    emit(findings, {
      code: "E05",
      severity: "error",
      plugin: pluginSlug,
      file: rel(listingPath),
      message: "listing.yaml must not have a BOM (byte-order mark)",
    });
    return;
  }

  // Reject CRLF
  if (raw.includes("\r\n")) {
    emit(findings, {
      code: "E05",
      severity: "error",
      plugin: pluginSlug,
      file: rel(listingPath),
      message: "listing.yaml must use LF line endings, not CRLF",
    });
    return;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    const yerr = e as yaml.YAMLException;
    emit(findings, {
      code: "E05",
      severity: "error",
      plugin: pluginSlug,
      file: rel(listingPath),
      line: yerr.mark?.line != null ? yerr.mark.line + 1 : undefined,
      col: yerr.mark?.column != null ? yerr.mark.column + 1 : undefined,
      message: `YAML parse error: ${yerr.reason ?? String(e)}`,
    });
    return;
  }

  const result = ListingSchema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const pathStr = issue.path.join(".");
      const msg = issue.message;

      // Map Zod issue codes to our error codes
      let code = "E05";
      if (msg.startsWith("E11:")) {
        code = "E11";
      } else if (msg.startsWith("E05:")) {
        code = "E05";
      } else if (issue.code === "invalid_enum_value") {
        code = "E04";
      } else if (
        issue.code === "custom" &&
        (msg.includes("prompt must start") ||
          msg.includes("must not be repeated") ||
          msg.includes("duplicate contributor"))
      ) {
        code = "E06";
      }

      emit(findings, {
        code,
        severity: "error",
        plugin: pluginSlug,
        file: rel(listingPath),
        message: pathStr ? `${pathStr}: ${msg}` : msg,
      });
    }
  }

  // Cross-checks that require successful parsing
  if (result.success) {
    const listing = result.data;

    // screenshot_order cross-check
    if (listing.screenshot_order) {
      const screenshotsDir = path.join(pluginDir, "marketplace", "screenshots");
      for (const fname of listing.screenshot_order) {
        const fpath = path.join(screenshotsDir, fname);
        if (!fileExists(fpath)) {
          emit(findings, {
            code: "E06",
            severity: "error",
            plugin: pluginSlug,
            file: rel(listingPath),
            message: `screenshot_order references missing file: ${fname}`,
          });
        }
      }
    }

    // requires_plugins cross-check
    if (listing.requires_plugins) {
      for (const slug of listing.requires_plugins) {
        const depDir = path.join(pluginsDir, slug);
        if (!isDirectory(depDir)) {
          emit(findings, {
            code: "E06",
            severity: "error",
            plugin: pluginSlug,
            file: rel(listingPath),
            message: `requires_plugins references unknown plugin: ${slug}`,
          });
        }
      }
    }

    // ui_components cross-check: agents/ui-handlers/{name}.md must exist
    if (listing.ui_components) {
      for (const comp of listing.ui_components) {
        const handlerPath = path.join(
          pluginDir,
          "agents",
          "ui-handlers",
          `${comp.name}.md`,
        );
        if (!fileExists(handlerPath)) {
          emit(findings, {
            code: "E06",
            severity: "error",
            plugin: pluginSlug,
            file: rel(listingPath),
            message: `ui_components[].name "${comp.name}" has no matching agents/ui-handlers/${comp.name}.md`,
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 3 — Image dims/aspect/size (E02, E07, E08, E09, E10)
// ---------------------------------------------------------------------------

const SCREENSHOT_RE = /^[0-9]{2}-[a-z0-9-]+\.(png|jpg)$/;

function pass3Images(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  function rel(p: string): string {
    return path.relative(repoRoot, p);
  }

  // Icon
  const iconPath = path.join(pluginDir, "marketplace", "icon.png");
  if (fileExists(iconPath)) {
    validateIcon(pluginSlug, iconPath, rel(iconPath), findings);
  }

  // Screenshots
  const screenshotsDir = path.join(pluginDir, "marketplace", "screenshots");
  if (!isDirectory(screenshotsDir)) return;

  const files = fs
    .readdirSync(screenshotsDir)
    .filter((n) => !n.startsWith("."));

  if (files.length > 8) {
    emit(findings, {
      code: "E02",
      severity: "error",
      plugin: pluginSlug,
      file: rel(screenshotsDir),
      message: `too many screenshots: ${files.length} (max 8)`,
    });
  }

  for (const fname of files) {
    const fpath = path.join(screenshotsDir, fname);
    validateScreenshot(pluginSlug, fpath, rel(fpath), fname, findings);
  }
}

function validateIcon(
  pluginSlug: string,
  iconPath: string,
  relFile: string,
  findings: Finding[],
): void {
  let dims: { width?: number; height?: number; type?: string };
  try {
    const buf = fs.readFileSync(iconPath);
    dims = imageSize(buf);
  } catch (e) {
    emit(findings, {
      code: "E07",
      severity: "error",
      plugin: pluginSlug,
      file: relFile,
      message: `cannot read image metadata: ${String(e)}`,
    });
    return;
  }

  if (dims.type !== "png") {
    emit(findings, {
      code: "E07",
      severity: "error",
      plugin: pluginSlug,
      file: relFile,
      message: `icon must be PNG, got: ${dims.type ?? "unknown"}`,
    });
  }

  if (dims.width !== 512 || dims.height !== 512) {
    emit(findings, {
      code: "E02",
      severity: "error",
      plugin: pluginSlug,
      file: relFile,
      message: `icon is ${dims.width}×${dims.height}, expected 512×512`,
    });
  }

  const stat = fs.statSync(iconPath);
  if (stat.size > 512 * 1024) {
    emit(findings, {
      code: "E08",
      severity: "error",
      plugin: pluginSlug,
      file: relFile,
      message: `icon is ${Math.round(stat.size / 1024)} KB, max is 512 KB`,
    });
  }
}

function validateScreenshot(
  pluginSlug: string,
  fpath: string,
  relFile: string,
  fname: string,
  findings: Finding[],
): void {
  // Filename check
  if (!SCREENSHOT_RE.test(fname)) {
    emit(findings, {
      code: "E10",
      severity: "error",
      plugin: pluginSlug,
      file: relFile,
      message: `screenshot filename "${fname}" does not match pattern NN-slug-name.{png,jpg}`,
    });
    return;
  }

  const ext = path.extname(fname).toLowerCase().slice(1); // "png" or "jpg"

  let dims: { width?: number; height?: number; type?: string };
  try {
    const buf = fs.readFileSync(fpath);
    dims = imageSize(buf);
  } catch (e) {
    emit(findings, {
      code: "E07",
      severity: "error",
      plugin: pluginSlug,
      file: relFile,
      message: `cannot read image metadata: ${String(e)}`,
    });
    return;
  }

  const actualType = dims.type;
  const expectedTypes = ext === "jpg" ? ["jpg", "jpeg"] : ["png"];
  if (!actualType || !expectedTypes.includes(actualType)) {
    emit(findings, {
      code: "E07",
      severity: "error",
      plugin: pluginSlug,
      file: relFile,
      message: `screenshot format mismatch: filename says ${ext}, image is ${actualType ?? "unknown"}`,
    });
  }

  const w = dims.width ?? 0;
  const h = dims.height ?? 0;

  if (w < 1280 || h < 720 || w > 2560 || h > 1440) {
    emit(findings, {
      code: "E02",
      severity: "error",
      plugin: pluginSlug,
      file: relFile,
      message: `screenshot dimensions ${w}×${h} out of range [1280×720, 2560×1440]`,
    });
  }

  if (h > 0) {
    const ratio = w / h;
    if (ratio < 1.33 || ratio > 2.34) {
      emit(findings, {
        code: "E09",
        severity: "error",
        plugin: pluginSlug,
        file: relFile,
        message: `screenshot aspect ratio ${ratio.toFixed(2)} out of range [1.33, 2.33]`,
      });
    }
  }

  const stat = fs.statSync(fpath);
  if (stat.size > 2 * 1024 * 1024) {
    emit(findings, {
      code: "E08",
      severity: "error",
      plugin: pluginSlug,
      file: relFile,
      message: `screenshot is ${Math.round(stat.size / 1024)} KB, max is 2048 KB`,
    });
  }
}

// ---------------------------------------------------------------------------
// Pass 4 — README / CHANGELOG smoke
// ---------------------------------------------------------------------------

const VERSION_SECTION_RE = /^## \[(\d+\.\d+\.\d+)\] — \d{4}-\d{2}-\d{2}$/m;

function pass4ReadmeChangelog(
  pluginSlug: string,
  pluginDir: string,
  repoRoot: string,
  findings: Finding[],
): void {
  function rel(p: string): string {
    return path.relative(repoRoot, p);
  }

  const readmePath = path.join(pluginDir, "README.md");
  const changelogPath = path.join(pluginDir, "CHANGELOG.md");
  const pluginJsonPath = path.join(pluginDir, ".claude-plugin", "plugin.json");

  // README checks
  if (fileExists(readmePath)) {
    const content = fs.readFileSync(readmePath, "utf-8");
    if (content.trim().length < 200) {
      emit(findings, {
        code: "E05",
        severity: "error",
        plugin: pluginSlug,
        file: rel(readmePath),
        message: `README.md is too short (${content.trim().length} chars, min 200)`,
      });
    }
    const lineCount = content.split("\n").length;
    if (lineCount > 500) {
      emit(findings, {
        code: "W01",
        severity: "warning",
        plugin: pluginSlug,
        file: rel(readmePath),
        message: `README.md is ${lineCount} lines (recommended max 500)`,
      });
    }
  }

  // CHANGELOG checks
  if (!fileExists(changelogPath)) return;

  const changelog = fs.readFileSync(changelogPath, "utf-8");

  if (!changelog.trimStart().startsWith("# Changelog")) {
    emit(findings, {
      code: "E03",
      severity: "error",
      plugin: pluginSlug,
      file: rel(changelogPath),
      line: 1,
      message: `CHANGELOG.md must start with "# Changelog"`,
    });
  }

  // Check for [Unreleased] section (warning if missing)
  if (!changelog.includes("## [Unreleased]")) {
    emit(findings, {
      code: "W02",
      severity: "warning",
      plugin: pluginSlug,
      file: rel(changelogPath),
      message: `CHANGELOG.md has no ## [Unreleased] section`,
    });
  }

  // Validate version section format
  const lines = changelog.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## [") && !line.startsWith("## [Unreleased]")) {
      if (!VERSION_SECTION_RE.test(line)) {
        emit(findings, {
          code: "E03",
          severity: "error",
          plugin: pluginSlug,
          file: rel(changelogPath),
          line: i + 1,
          message: `CHANGELOG.md version section "${line}" does not match format [X.Y.Z] — YYYY-MM-DD`,
        });
      }
    }
  }

  // Version match with plugin.json
  if (!fileExists(pluginJsonPath)) return;

  let pluginJson: { version?: string };
  try {
    pluginJson = JSON.parse(
      fs.readFileSync(pluginJsonPath, "utf-8"),
    ) as { version?: string };
  } catch {
    return; // plugin.json parse errors aren't our concern (P2 territory)
  }

  const pluginVersion = pluginJson.version;
  if (!pluginVersion) return;

  // Find most-recent version section (skip [Unreleased])
  const versionMatch = VERSION_SECTION_RE.exec(changelog);
  if (!versionMatch) {
    emit(findings, {
      code: "E03",
      severity: "error",
      plugin: pluginSlug,
      file: rel(changelogPath),
      message: `CHANGELOG.md has no versioned release section`,
    });
    return;
  }

  const changelogVersion = versionMatch[1];
  if (changelogVersion !== pluginVersion) {
    emit(findings, {
      code: "E03",
      severity: "error",
      plugin: pluginSlug,
      file: rel(changelogPath),
      message: `plugin.json version ${pluginVersion} does not match CHANGELOG.md most-recent version ${changelogVersion}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Pass 5 — Minimalism (E11 reserved fields)
// Note: E11 is caught by ListingSchema.superRefine in pass2.
// plugin.json minimalism is P2 territory per §5.4 Pass 5.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Core: lint a single plugin directory
// Exported for use in tests with custom repoRoot / pluginsDir.
// ---------------------------------------------------------------------------

export interface LintOptions {
  /** Absolute path to the root of the plugins repo. Used for relative-path display. */
  repoRoot: string;
  /** Absolute path to the directory containing all plugin subdirs (e.g. repoRoot/plugins). */
  pluginsDir: string;
}

export function lintPlugin(
  pluginSlug: string,
  pluginDir: string,
  opts: LintOptions,
): Finding[] {
  const findings: Finding[] = [];
  pass1RequiredFiles(pluginSlug, pluginDir, opts.repoRoot, findings);
  pass2Schema(pluginSlug, pluginDir, opts.pluginsDir, opts.repoRoot, findings);
  pass3Images(pluginSlug, pluginDir, opts.repoRoot, findings);
  pass4ReadmeChangelog(pluginSlug, pluginDir, opts.repoRoot, findings);
  return findings;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// Only run CLI when this file is the entry point (not when imported by tests).
const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === __filename ||
  process.argv[1]?.endsWith("lint-marketplace-metadata.ts") ||
  process.argv[1]?.endsWith("lint-marketplace-metadata.js");

if (isMain) {
  const cliArgs = process.argv.slice(2);

  function getFlag(name: string): string | undefined {
    const idx = cliArgs.indexOf(name);
    if (idx === -1) return undefined;
    return cliArgs[idx + 1];
  }

  const pluginFilter = getFlag("--plugin");
  const jsonMode = cliArgs.includes("--json");

  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..");
  const pluginsDir = path.join(repoRoot, "plugins");

  function relPath(absPath: string): string {
    return path.relative(repoRoot, absPath);
  }

  function formatHuman(f: Finding): string {
    const loc =
      f.line != null ? `:${f.line}${f.col != null ? `:${f.col}` : ""}` : "";
    const sev = f.severity.toUpperCase();
    return `${f.file}${loc} ${sev} ${f.code} ${f.message}`;
  }

  function formatJson(f: Finding): string {
    return JSON.stringify({
      code: f.code,
      severity: f.severity,
      plugin: f.plugin,
      file: f.file,
      line: f.line,
      message: f.message,
    });
  }

  let slugs: string[];
  if (pluginFilter) {
    const pluginDir = path.join(pluginsDir, pluginFilter);
    if (!isDirectory(pluginDir)) {
      process.stderr.write(
        `Error: plugin "${pluginFilter}" not found in ${relPath(pluginsDir)}\n`,
      );
      process.exit(1);
    }
    slugs = [pluginFilter];
  } else {
    if (!isDirectory(pluginsDir)) {
      process.stderr.write(
        `Error: plugins directory not found: ${relPath(pluginsDir)}\n`,
      );
      process.exit(1);
    }
    slugs = fs
      .readdirSync(pluginsDir)
      .filter((n) => !n.startsWith("."))
      .filter((n) => isDirectory(path.join(pluginsDir, n)))
      .sort();
  }

  const allFindings: Finding[] = [];
  const failedPlugins = new Set<string>();

  for (const slug of slugs) {
    const pluginDir = path.join(pluginsDir, slug);
    const findings = lintPlugin(slug, pluginDir, { repoRoot, pluginsDir });
    for (const f of findings) {
      allFindings.push(f);
      if (jsonMode) {
        process.stdout.write(formatJson(f) + "\n");
      } else {
        process.stderr.write(formatHuman(f) + "\n");
      }
      if (f.severity === "error") {
        failedPlugins.add(slug);
      }
    }
  }

  const errorCount = allFindings.filter((f) => f.severity === "error").length;
  const passedCount = slugs.length - failedPlugins.size;

  if (!jsonMode) {
    process.stderr.write("\n");
    if (errorCount === 0) {
      process.stderr.write(`All ${slugs.length} plugin(s) passed.\n`);
    } else {
      const failedList = [...failedPlugins].join(", ");
      process.stderr.write(
        `${errorCount} error(s) in ${failedPlugins.size} plugin(s) (${failedList}). ` +
          `${passedCount} plugin(s) passed.\n`,
      );
    }
  }

  process.exit(errorCount > 0 ? 1 : 0);
}
