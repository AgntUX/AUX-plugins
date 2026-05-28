#!/usr/bin/env node
/**
 * scaffold-marketplace-assets.mjs
 *
 * Stage-7 scaffold helper (WS-A.3). Ensures a freshly-built plugin carries the
 * minimum assets that would otherwise trip marketplace lint at submission:
 *
 *   1. marketplace/icon.png — copies the 512×512 canonical placeholder if absent.
 *   2. skills/{slug}/_overrides/frontmatter.yaml — emits the E15 floor from the
 *      canonical template (canonical/skills/_overrides/frontmatter.template.yaml),
 *      substituting the ten render placeholders from build state. This guarantees
 *      the render pipeline can reproduce the skill tree (lint pass 8) even if the
 *      ingest-prompt-author specialist is skipped. The specialist OVERWRITES this
 *      with stage-1–5 values on a normal build; the floor only survives when the
 *      specialist never ran.
 *
 * Screenshots are NO LONGER scaffolded (WS-C.2 / v2): the marketplace ships
 * icon-only listings until a real-screenshot pipeline lands. This script does
 * not create marketplace/screenshots/ and does not emit a placeholder capture.
 *
 * Usage:
 *   node scripts/scaffold-marketplace-assets.mjs --slug <plugin-slug>
 *
 * Idempotent: re-running when all assets are already present is a no-op
 * (exits 0). Existing files are never overwritten.
 *
 * Exit codes:
 *   0 — success (files written or already present)
 *   1 — fatal error (bad args, missing canonical source, write failure)
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

/** Parse --slug <value> from CLI args */
function parseSlug() {
  const idx = process.argv.indexOf("--slug");
  if (idx === -1 || !process.argv[idx + 1]) {
    console.error("Usage: node scripts/scaffold-marketplace-assets.mjs --slug <plugin-slug>");
    process.exit(1);
  }
  return process.argv[idx + 1];
}

const slug = parseSlug();

const CANONICAL_ICON = join(REPO_ROOT, "canonical", "marketplace-assets", "icon.placeholder.png");
const CANONICAL_FRONTMATTER = join(
  REPO_ROOT,
  "canonical",
  "skills",
  "_overrides",
  "frontmatter.template.yaml",
);
const PLUGIN_DIR = join(REPO_ROOT, "plugins", slug);
const MARKETPLACE_DIR = join(PLUGIN_DIR, "marketplace");
const ICON_DEST = join(MARKETPLACE_DIR, "icon.png");
const MARKETPLACE_README = join(MARKETPLACE_DIR, "README.md");
const OVERRIDES_DIR = join(PLUGIN_DIR, "skills", slug, "_overrides");
const FRONTMATTER_DEST = join(OVERRIDES_DIR, "frontmatter.yaml");

// ---------------------------------------------------------------------------
// Validate inputs
// ---------------------------------------------------------------------------

if (!existsSync(PLUGIN_DIR)) {
  console.error(`ERROR: Plugin directory not found: ${PLUGIN_DIR}`);
  process.exit(1);
}

if (!existsSync(CANONICAL_ICON)) {
  console.error(`ERROR: Canonical placeholder icon not found: ${CANONICAL_ICON}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build-state derivation for the frontmatter substitution map
// ---------------------------------------------------------------------------

/** "google-calendar" → "Google Calendar"; "slack" → "Slack". */
function titleCase(s) {
  return s
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Read a field from the plugin's plugin.json, tolerating a missing file. */
function readPluginJson() {
  const p = join(PLUGIN_DIR, ".claude-plugin", "plugin.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Resolve the ten canonical render placeholders from build state. The slug is
 * authoritative; plugin.json supplies version + cadence; the remainder use
 * generic-but-renderable defaults that ingest-prompt-author replaces with real
 * stage-1–5 values on a normal build.
 */
function buildSubstitutionMap() {
  const sourceSlug = slug.startsWith("agntux-") ? slug.slice("agntux-".length) : slug;
  const pj = readPluginJson();
  return {
    "plugin-slug": slug,
    "plugin-version": typeof pj.version === "string" ? pj.version : "0.1.0",
    "source-display-name": titleCase(sourceSlug),
    "source-slug": sourceSlug,
    "recommended-cadence":
      typeof pj.recommended_ingest_cadence === "string"
        ? pj.recommended_ingest_cadence
        : "Daily 04:00",
    "source-cursor-semantics":
      "Single low-water-mark timestamp cursor; advances to the newest item seen this run.",
    "source-mcp-tools": `${sourceSlug}_read`,
    "thread-unit-name": "thread",
    "bootstrap-window-default-days": "30",
    "example-channel": sourceSlug,
  };
}

/** Apply {{key}} substitution; unresolved keys are left intact for visibility. */
function applySubstitutions(body, subs) {
  return body.replace(/\{\{([\w-]+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(subs, key) ? subs[key] : m,
  );
}

// ---------------------------------------------------------------------------
let anyWrite = false;

// 1. Copy placeholder icon if absent.
mkdirSync(MARKETPLACE_DIR, { recursive: true });
if (!existsSync(ICON_DEST)) {
  copyFileSync(CANONICAL_ICON, ICON_DEST);
  console.log(`  icon.png       ← copied placeholder (replace before launch)`);
  anyWrite = true;
} else {
  console.log(`  icon.png       ✓ already present`);
}

// 2. Emit the _overrides/frontmatter.yaml floor (E15) if absent.
//    Never overwrite — ingest-prompt-author's real map wins when it ran.
if (!existsSync(CANONICAL_FRONTMATTER)) {
  console.error(`ERROR: Canonical frontmatter template not found: ${CANONICAL_FRONTMATTER}`);
  process.exit(1);
}
if (!existsSync(FRONTMATTER_DEST)) {
  mkdirSync(OVERRIDES_DIR, { recursive: true });
  const template = readFileSync(CANONICAL_FRONTMATTER, "utf8");
  const rendered = applySubstitutions(template, buildSubstitutionMap());
  writeFileSync(FRONTMATTER_DEST, rendered, "utf8");
  console.log(`  skills/${slug}/_overrides/frontmatter.yaml  ← emitted floor (specialist overwrites with real values)`);
  anyWrite = true;
} else {
  console.log(`  skills/${slug}/_overrides/frontmatter.yaml  ✓ already present`);
}

// 3. Emit marketplace/README.md noting the placeholder icon (icon-only listing).
if (!existsSync(MARKETPLACE_README)) {
  const readmeLines = [
    "# marketplace/",
    "",
    "Assets for the " + slug + " plugin's marketplace listing.",
    "",
    "## icon.png",
    "",
    "Placeholder pending real art. Replace with a 512x512 PNG <= 512 KB",
    "before the plugin goes to launch review.",
    "",
    "## screenshots/",
    "",
    "Screenshots are optional — the marketplace ships icon-only listings.",
    "If you add real screenshots, name each `NN-description.{png,jpg}` (the",
    "linter validates filenames, dimensions, and size). Never put a README.md",
    "inside screenshots/.",
    "",
  ];
  writeFileSync(MARKETPLACE_README, readmeLines.join("\n"), "utf8");
  console.log(`  README.md      ← written (placeholder note)`);
  anyWrite = true;
} else {
  console.log(`  README.md      ✓ already present`);
}

// ---------------------------------------------------------------------------
if (!anyWrite) {
  console.log(`scaffold-marketplace-assets: ${slug} already complete — no changes.`);
} else {
  console.log(`scaffold-marketplace-assets: ${slug} done.`);
}
