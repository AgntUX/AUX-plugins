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
import { resolveToolchain } from "./toolchain-layout.mjs";

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
// Layout-aware: canonical assets live under <repo>/canonical in the maintainer
// clone and <plugin>/canonical in the contributor bundle; PLUGIN_DIR is an
// explicit --plugin-dir (the build sandbox) or plugins/<slug> in the clone.
const tc = resolveToolchain(__dirname);

/** Parse --slug <value> (required) and --plugin-dir <abs> (optional). */
function parseCliArgs() {
  const idx = process.argv.indexOf("--slug");
  if (idx === -1 || !process.argv[idx + 1]) {
    console.error(
      "Usage: node scripts/scaffold-marketplace-assets.mjs --slug <plugin-slug> [--plugin-dir <abs>]",
    );
    process.exit(1);
  }
  const slug = process.argv[idx + 1];
  let pluginDir;
  const di = process.argv.indexOf("--plugin-dir");
  if (di !== -1 && process.argv[di + 1]) pluginDir = resolve(process.argv[di + 1]);
  else {
    const eq = process.argv.find((a) => a.startsWith("--plugin-dir="));
    if (eq) pluginDir = resolve(eq.slice("--plugin-dir=".length));
  }
  return { slug, pluginDir };
}

const { slug, pluginDir: pluginDirFlag } = parseCliArgs();

const CANONICAL_ICON = join(tc.base, "canonical", "marketplace-assets", "icon.placeholder.png");
const CANONICAL_FRONTMATTER = join(
  tc.base,
  "canonical",
  "skills",
  "_overrides",
  "frontmatter.template.yaml",
);
const PLUGIN_DIR = pluginDirFlag ?? join(tc.pluginsDir ?? join(tc.base, "plugins"), slug);
const MARKETPLACE_DIR = join(PLUGIN_DIR, "marketplace");
const ICON_DEST = join(MARKETPLACE_DIR, "icon.png");
const MARKETPLACE_README = join(MARKETPLACE_DIR, "README.md");
const OVERRIDES_DIR = join(PLUGIN_DIR, "skills", slug, "_overrides");
const FRONTMATTER_DEST = join(OVERRIDES_DIR, "frontmatter.yaml");
const PACKAGE_JSON_DEST = join(PLUGIN_DIR, "package.json");
const VITEST_CONFIG_DEST = join(PLUGIN_DIR, "vitest.config.ts");
const CHANGELOG_DEST = join(PLUGIN_DIR, "CHANGELOG.md");
const LISTING_DEST = join(MARKETPLACE_DIR, "listing.yaml");

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

// 4. Emit the plugin-root package.json if absent. Without it, the stage-7
//    `npm run build --if-present` / `npm test --if-present` legacy commands
//    silently no-op (the script doesn't exist), so a broken view-tool build or
//    a failing vitest suite escapes the gate. Modeled on
//    plugins/agntux-gmail/package.json: `build` shells out to build-plugin.mjs,
//    `test` is `vitest run`, and `view-tool` is declared as a workspace so the
//    build's single plugin-root `npm install` hoists deps to it (npm 10.9+
//    crashes on per-member installs). The deterministic gate
//    (scripts/validate-plugin.mjs) is what actually enforces build+lint+test;
//    this file just makes the per-plugin `npm` surface real.
if (!existsSync(PACKAGE_JSON_DEST)) {
  const pkg = {
    name: `@agntux/${slug}-plugin`,
    version: "0.0.0",
    description: `Build + test harness for the ${slug} plugin`,
    private: true,
    type: "module",
    engines: { node: ">=20" },
    scripts: {
      build: `node ../../scripts/build-plugin.mjs ${slug}`,
      test: "vitest run",
      "test:watch": "vitest",
    },
    devDependencies: {
      "@types/node": "^20.0.0",
      typescript: "^5.4.0",
      vitest: "^1.6.0",
    },
    workspaces: ["view-tool"],
  };
  writeFileSync(PACKAGE_JSON_DEST, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  console.log(`  package.json   ← written (build→build-plugin.mjs, test→vitest run)`);
  anyWrite = true;
} else {
  console.log(`  package.json   ✓ already present`);
}

// 5. Emit the plugin-root vitest.config.ts if absent. The plugin-root suite
//    globs only __tests__/** (the view-tool suite is run separately by the
//    validator), modeled on plugins/agntux-gmail/vitest.config.ts.
if (!existsSync(VITEST_CONFIG_DEST)) {
  const vitestConfig =
    `import { defineConfig } from "vitest/config";\n\n` +
    `export default defineConfig({\n` +
    `  test: {\n` +
    `    include: ["__tests__/**/*.test.{ts,mjs}"],\n` +
    `  },\n` +
    `});\n`;
  writeFileSync(VITEST_CONFIG_DEST, vitestConfig, "utf8");
  console.log(`  vitest.config.ts ← written (globs __tests__/**)`);
  anyWrite = true;
} else {
  console.log(`  vitest.config.ts ✓ already present`);
}

// 6. Emit a lint-clean CHANGELOG.md floor if absent. Root cause of the
//    Test-#4 E03 round-trips: manifest-author authored CHANGELOG.md from
//    memory and wrote a plain hyphen / overran the format. The floor gives the
//    specialist a green skeleton to edit: it starts with "# Changelog" (E03),
//    carries a "## [Unreleased]" section (W02), and a version section whose
//    `[X.Y.Z]` matches plugin.json's version (the version-match check) with a
//    canonical em-dash date separator. Never overwrite — the specialist's real
//    changelog wins when it ran.
const floorPj = readPluginJson();
const floorVersion =
  typeof floorPj.version === "string" ? floorPj.version : "0.1.0";
const sourceSlugForFloors = slug.startsWith("agntux-")
  ? slug.slice("agntux-".length)
  : slug;
const floorDisplay = titleCase(sourceSlugForFloors);
const floorToday = new Date().toISOString().slice(0, 10);

if (!existsSync(CHANGELOG_DEST)) {
  const changelog =
    `# Changelog\n\n` +
    `All notable changes to the ${slug} plugin are documented in this file.\n\n` +
    `The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),\n` +
    `and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n` +
    `## [Unreleased]\n\n` +
    `## [${floorVersion}] — ${floorToday}\n\n` +
    `### Added\n\n` +
    `- Initial scaffold of the ${slug} plugin.\n`;
  writeFileSync(CHANGELOG_DEST, changelog, "utf8");
  console.log(`  CHANGELOG.md   ← emitted floor (version ${floorVersion}; specialist overwrites)`);
  anyWrite = true;
} else {
  console.log(`  CHANGELOG.md   ✓ already present`);
}

// 7. Emit a lint-clean listing.yaml floor if absent. Root cause of the
//    Test-#4 E05/E06 round-trips: manifest-author authored listing.yaml from
//    memory — overran the proposed_schema caps (cursor_semantics ≤200,
//    source_id_format ≤120) and declared a screenshot_order pointing at files
//    that don't exist. The floor carries every REQUIRED field (tagline,
//    description, categories, keywords, available_on, support, developer) with
//    caps-respecting placeholder values, a valid proposed_schema skeleton
//    (E14), and NO screenshot_order (the marketplace ships icon-only). Never
//    overwrite — the specialist's real listing (with ui_components etc.) wins.
const KEYWORD_RE = /^[a-z0-9-]{2,32}$/;
const floorKeywords = [sourceSlugForFloors, "ingest", "agntux"].filter(
  (k, i, a) => KEYWORD_RE.test(k) && a.indexOf(k) === i,
);
if (floorKeywords.length === 0) floorKeywords.push("agntux");

if (!existsSync(LISTING_DEST)) {
  const keywordLines = floorKeywords.map((k) => `  - ${k}`).join("\n");
  const listing =
    `tagline: "${floorDisplay}, surfaced as AgntUX entities."\n` +
    `description: |\n` +
    `  Ingests ${floorDisplay} into the AgntUX knowledge store. Replace this\n` +
    `  placeholder with a real one-paragraph summary (markdown allowed, 500\n` +
    `  chars max) before the plugin goes to launch review.\n` +
    `categories:\n` +
    `  - productivity\n` +
    `keywords:\n` +
    `${keywordLines}\n` +
    `available_on:\n` +
    `  - trial\n` +
    `  - pro\n` +
    `  - team\n` +
    `  - enterprise\n` +
    `supported_prompts:\n` +
    `  - prompt: "ux:${slug}"\n` +
    `    purpose: "Scheduled task — fires the ${floorDisplay} ingest agent on the configured cadence."\n` +
    `support:\n` +
    `  url: "https://github.com/AgntUX/AUX-plugins/issues"\n` +
    `  email: "support@agntux.ai"\n` +
    `developer:\n` +
    `  name: "AgntUX"\n` +
    `  url: "https://agntux.ai"\n` +
    `  github_handle: "agntux"\n` +
    `proposed_schema:\n` +
    `  entity_subtypes:\n` +
    `    - subtype: person\n` +
    `      description: "Individuals named or mentioned in ${floorDisplay} items."\n` +
    `      required_frontmatter:\n` +
    `        - id\n` +
    `        - type\n` +
    `        - schema_version\n` +
    `        - subtype\n` +
    `  action_classes:\n` +
    `    - class: knowledge-update\n` +
    `      description: "An informational signal extracted from a ${floorDisplay} item."\n` +
    `  cursor_semantics: "Single timestamp cursor; advances to the newest item seen this run."\n` +
    `  source_id_format: "Stable per-item identifier provided by the source."\n`;
  writeFileSync(LISTING_DEST, listing, "utf8");
  console.log(`  listing.yaml   ← emitted floor (caps-respecting; specialist overwrites)`);
  anyWrite = true;
} else {
  console.log(`  listing.yaml   ✓ already present`);
}

// ---------------------------------------------------------------------------
if (!anyWrite) {
  console.log(`scaffold-marketplace-assets: ${slug} already complete — no changes.`);
} else {
  console.log(`scaffold-marketplace-assets: ${slug} done.`);
}
