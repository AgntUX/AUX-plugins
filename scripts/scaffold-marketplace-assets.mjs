#!/usr/bin/env node
/**
 * scaffold-marketplace-assets.mjs
 *
 * Stage-7 scaffold helper: ensures a plugin's marketplace/ directory has the
 * minimum required assets (icon, at least one screenshot) and removes the
 * README.md-as-screenshot anti-pattern that triggers lint error E10.
 *
 * Usage:
 *   node scripts/scaffold-marketplace-assets.mjs --slug <plugin-slug>
 *
 * Idempotent: re-running when all assets are already present is a no-op
 * (exits 0, emits a single "Already complete" line).
 *
 * Exit codes:
 *   0 — success (files written or already present)
 *   1 — fatal error (bad args, missing canonical source, write failure)
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
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
const PLUGIN_DIR = join(REPO_ROOT, "plugins", slug);
const MARKETPLACE_DIR = join(PLUGIN_DIR, "marketplace");
const SCREENSHOTS_DIR = join(MARKETPLACE_DIR, "screenshots");
const ICON_DEST = join(MARKETPLACE_DIR, "icon.png");
const SCREENSHOT_DEST = join(SCREENSHOTS_DIR, "00-overview.png");
const SCREENSHOT_README = join(SCREENSHOTS_DIR, "README.md");
const MARKETPLACE_README = join(MARKETPLACE_DIR, "README.md");

// ---------------------------------------------------------------------------
// Validate inputs
// ---------------------------------------------------------------------------

if (!existsSync(PLUGIN_DIR)) {
  console.error(`ERROR: Plugin directory not found: ${PLUGIN_DIR}`);
  process.exit(1);
}

if (!existsSync(CANONICAL_ICON)) {
  console.error(`ERROR: Canonical placeholder icon not found: ${CANONICAL_ICON}`);
  console.error("Run this script from the AUX-plugins repo root after WS-1 lands.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Ensure directory structure
// ---------------------------------------------------------------------------

mkdirSync(MARKETPLACE_DIR, { recursive: true });
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

let anyWrite = false;

// ---------------------------------------------------------------------------
// 1. Copy placeholder icon if absent
// ---------------------------------------------------------------------------

if (!existsSync(ICON_DEST)) {
  copyFileSync(CANONICAL_ICON, ICON_DEST);
  console.log(`  icon.png       ← copied placeholder (replace before launch)`);
  anyWrite = true;
} else {
  console.log(`  icon.png       ✓ already present`);
}

// ---------------------------------------------------------------------------
// 2. Ensure at least one screenshot exists (00-overview.png)
// ---------------------------------------------------------------------------

if (!existsSync(SCREENSHOT_DEST)) {
  // 00-overview.png absent — copy icon as stand-in placeholder.
  copyFileSync(CANONICAL_ICON, SCREENSHOT_DEST);
  console.log(`  screenshots/00-overview.png  ← placeholder (replace with 1280×720 capture)`);
  anyWrite = true;
} else {
  console.log(`  screenshots/00-overview.png  ✓ already present`);
}

// ---------------------------------------------------------------------------
// 3. Remove screenshots/README.md — the source of lint error E10
// ---------------------------------------------------------------------------

if (existsSync(SCREENSHOT_README)) {
  unlinkSync(SCREENSHOT_README);
  console.log(`  screenshots/README.md  ← removed (was triggering E10)`);
  anyWrite = true;
}

// ---------------------------------------------------------------------------
// 4. Emit marketplace/README.md noting the placeholder icon
// ---------------------------------------------------------------------------

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
    "Replace `00-overview.png` with a 1280x720 capture of the real UI.",
    "Add up to 7 additional screenshots named `NN-description.png`.",
    "Never put a README.md inside screenshots/ -- the linter treats every file",
    "there as a screenshot candidate (E10).",
    "",
  ];
  writeFileSync(MARKETPLACE_README, readmeLines.join("\n"), "utf8");
  console.log(`  README.md      ← written (placeholder note)`);
  anyWrite = true;
} else {
  console.log(`  README.md      ✓ already present`);
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

if (!anyWrite) {
  console.log(`scaffold-marketplace-assets: ${slug} already complete — no changes.`);
} else {
  console.log(`scaffold-marketplace-assets: ${slug} done.`);
}
