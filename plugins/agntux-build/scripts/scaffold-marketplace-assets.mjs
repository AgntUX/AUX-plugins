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
  cpSync,
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
  // --view-tool: also pre-place the build-critical view-tool floor (deps +
  // apps-client + tsconfig/tailwind/vite/emit-manifest). Off by default so
  // no-UI ingest plugins never get a stray view-tool/ tree; the orchestrator
  // passes it only when stage 5 decided the plugin ships ≥1 UI handler.
  const withViewTool = process.argv.includes("--view-tool");
  return { slug, pluginDir, withViewTool };
}

const { slug, pluginDir: pluginDirFlag, withViewTool } = parseCliArgs();

const CANONICAL_ICON = join(tc.base, "canonical", "marketplace-assets", "icon.placeholder.png");
const CANONICAL_FRONTMATTER = join(
  tc.base,
  "canonical",
  "skills",
  "_overrides",
  "frontmatter.template.yaml",
);
// The Apache-2.0 LICENSE every plugin must ship. tc.base is the repo root in the
// maintainer clone (<repo>/LICENSE) and the agntux-build plugin root in the
// bundle (<plugin>/LICENSE) — both carry a verbatim copy, so this resolves in
// either layout.
const CANONICAL_LICENSE = join(tc.base, "LICENSE");
const PLUGIN_DIR = pluginDirFlag ?? join(tc.pluginsDir ?? join(tc.base, "plugins"), slug);
const MARKETPLACE_DIR = join(PLUGIN_DIR, "marketplace");
const ICON_DEST = join(MARKETPLACE_DIR, "icon.png");
const MARKETPLACE_README = join(MARKETPLACE_DIR, "README.md");
const OVERRIDES_DIR = join(PLUGIN_DIR, "skills", slug, "_overrides");
const FRONTMATTER_DEST = join(OVERRIDES_DIR, "frontmatter.yaml");
const PACKAGE_JSON_DEST = join(PLUGIN_DIR, "package.json");
const VITEST_CONFIG_DEST = join(PLUGIN_DIR, "vitest.config.ts");
const CHANGELOG_DEST = join(PLUGIN_DIR, "CHANGELOG.md");
const LICENSE_DEST = join(PLUGIN_DIR, "LICENSE");
const NOTICE_DEST = join(PLUGIN_DIR, "NOTICE");
const LISTING_DEST = join(MARKETPLACE_DIR, "listing.yaml");
const VIEW_TOOL_TEMPLATE = tc.viewToolTemplateDir;
const VIEW_TOOL_DEST = join(PLUGIN_DIR, "view-tool");

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

// 1b. Emit LICENSE (verbatim Apache-2.0) + NOTICE. Every plugin MUST ship a
//     LICENSE (CLAUDE.md authoring rules / P15 §2) mirroring the repo-root
//     LICENSE; without a scaffold
//     copy an agent has to hand-author the full Apache text — the 2026-06-01
//     calendar build did exactly that, and the large legal-text emit tripped a
//     content-filter block twice, interrupting the build. Copy the LICENSE
//     verbatim and write a small plugin-scoped NOTICE so no agent ever authors
//     legal text. Never overwrite a real one the author already placed.
if (!existsSync(LICENSE_DEST)) {
  if (!existsSync(CANONICAL_LICENSE)) {
    console.error(`ERROR: canonical LICENSE not found: ${CANONICAL_LICENSE}`);
    process.exit(1);
  }
  copyFileSync(CANONICAL_LICENSE, LICENSE_DEST);
  console.log(`  LICENSE        ← copied (Apache-2.0, verbatim)`);
  anyWrite = true;
} else {
  console.log(`  LICENSE        ✓ already present`);
}
if (!existsSync(NOTICE_DEST)) {
  const notice =
    `${slug}\n` +
    `Copyright (c) 2026 AgntUX, Inc.\n\n` +
    `This product is licensed under the Apache License, Version 2.0.\n` +
    `See the LICENSE file in this directory for the full text, or visit:\n` +
    `https://www.apache.org/licenses/LICENSE-2.0\n`;
  writeFileSync(NOTICE_DEST, notice, "utf8");
  console.log(`  NOTICE         ← written (Apache-2.0 reference)`);
  anyWrite = true;
} else {
  console.log(`  NOTICE         ✓ already present`);
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
    `# Marketplace lint hard-fails any string field over its cap (E05) and any\n` +
    `# category outside the closed enum (E04). Caps: tagline ≤80, description\n` +
    `# ≤500, ui_components[].title ≤60, ui_components[].purpose ≤200,\n` +
    `# proposed_schema.{entity_subtypes,action_classes}[].description ≤200,\n` +
    `# cursor_semantics ≤200, source_id_format ≤120. Categories (pick 1–3):\n` +
    `# productivity, communication, crm, project-management, developer-tools,\n` +
    `# analytics, notes-knowledge, scheduling, calendar (meta is agntux-core only).\n` +
    `tagline: "${floorDisplay}, surfaced as AgntUX entities."  # ≤80 chars\n` +
    `description: |  # ≤500 chars\n` +
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
    `      description: "An informational signal extracted from a ${floorDisplay} item."  # ≤200 chars\n` +
    `  cursor_semantics: "Single timestamp cursor; advances to the newest item seen this run."  # ≤200 chars\n` +
    `  source_id_format: "Stable per-item identifier provided by the source."  # ≤120 chars\n`;
  writeFileSync(LISTING_DEST, listing, "utf8");
  console.log(`  listing.yaml   ← emitted floor (caps-respecting; specialist overwrites)`);
  anyWrite = true;
} else {
  console.log(`  listing.yaml   ✓ already present`);
}

// 8. (--view-tool only) Pre-place the build-critical view-tool FLOOR. Root
//    cause of the Test-#5 view-tool round-trips: the view-tool-builder
//    hand-authored deterministic build config — it shipped a view-tool/
//    package.json WITHOUT the `@agntux/ui-primitives` workspace dep (Rollup
//    "failed to resolve import" → build fail) and hand-wrote the vendored
//    apps-client (sha256 drift → lint E26). None of that is creative work: the
//    canonical _template already has the correct deps + a byte-frozen
//    apps-client. We copy that floor natively here so the specialist only
//    authors the per-handler UI (`{name}.html`, `*-ui.tsx`, `App*.tsx`,
//    `{slug}-view.ts`). package.json + vite.config are GENERATED handler-
//    agnostically (the build loops over `*.html`; vite reads VITE_ENTRY), so
//    one floor serves 1..N handlers. Never overwrite — a real specialist file
//    always wins.
if (withViewTool) {
  placeViewToolFloor();
}

/**
 * Copy a single template file → view-tool/<rel> if absent. Verbatim (no
 * substitution): every file routed here is placeholder-free (apps-client SDK,
 * tsconfig, tailwind/emit-manifest, globals.css, vite-env).
 */
function placeViewToolFile(rel) {
  const src = join(VIEW_TOOL_TEMPLATE, rel);
  const dest = join(VIEW_TOOL_DEST, rel);
  if (existsSync(dest)) {
    console.log(`  view-tool/${rel}  ✓ already present`);
    return;
  }
  if (!existsSync(src)) {
    console.error(`ERROR: view-tool template file missing: ${src}`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`  view-tool/${rel}  ← copied (floor)`);
  anyWrite = true;
}

/** Recursively copy a template dir → view-tool/<rel> if the dest dir is absent. */
function placeViewToolDir(rel) {
  const src = join(VIEW_TOOL_TEMPLATE, rel);
  const dest = join(VIEW_TOOL_DEST, rel);
  if (existsSync(dest)) {
    console.log(`  view-tool/${rel}/  ✓ already present`);
    return;
  }
  if (!existsSync(src)) {
    console.error(`ERROR: view-tool template dir missing: ${src}`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`  view-tool/${rel}/  ← copied verbatim (floor)`);
  anyWrite = true;
}

function placeViewToolFloor() {
  if (!existsSync(VIEW_TOOL_TEMPLATE)) {
    console.error(`ERROR: view-tool template not found: ${VIEW_TOOL_TEMPLATE}`);
    process.exit(1);
  }
  mkdirSync(VIEW_TOOL_DEST, { recursive: true });

  // 8a. package.json — inherit the template's exact dep set (correct
  //     `file:../../packages/...` paths for the build-session layout, where
  //     build-plugin.mjs vendors packages to <session>/packages and the plugin
  //     lives at <session>/<slug>). Only override name/description and the
  //     build script, which we make handler-agnostic: loop over every *.html
  //     entry (vite reads VITE_ENTRY), then one esbuild of src/{slug}-view.ts.
  const viewPkgDest = join(VIEW_TOOL_DEST, "package.json");
  if (!existsSync(viewPkgDest)) {
    const tmplPkg = JSON.parse(
      readFileSync(join(VIEW_TOOL_TEMPLATE, "package.json"), "utf8"),
    );
    tmplPkg.name = `@agntux-build/${slug}-view-tool`;
    tmplPkg.description = `View-tool library module for ${slug}. Loaded server-side by the remote MCP registry; not invoked locally.`;
    tmplPkg.scripts = {
      ...tmplPkg.scripts,
      build:
        // `[ -e "$f" ]` turns the no-match case into an actionable error: under
        // POSIX sh an unmatched `*.html` glob expands to the literal string, so
        // without this guard the loop runs once with f=`*.html` and vite fails
        // with an opaque "Could not resolve entry module" — confusing for a
        // non-technical contributor who simply hasn't authored a view yet.
        `rm -rf dist && for f in *.html; do [ -e "$f" ] || { echo "agntux-build: no view *.html found — author at least one <name>.html before building"; exit 1; }; VITE_ENTRY="\${f%.html}" vite build --emptyOutDir=false; done && ` +
        `tsc --noEmit -p tsconfig.json && ` +
        `esbuild src/${slug}-view.ts --bundle --platform=node --format=esm ` +
        `--outfile=dist/${slug}-view.js --external:@agntux/plugin-runtime && ` +
        `node scripts/emit-manifest.mjs`,
    };
    writeFileSync(viewPkgDest, JSON.stringify(tmplPkg, null, 2) + "\n", "utf8");
    console.log(`  view-tool/package.json  ← written (deps + handler-agnostic build)`);
    anyWrite = true;
  } else {
    console.log(`  view-tool/package.json  ✓ already present`);
  }

  // 8b. vite.config.ts — handler-agnostic: one HTML entry per view, selected by
  //     VITE_ENTRY (the build loops over *.html). No hardcoded entry names, so
  //     the same config serves any number of handlers the specialist authors.
  const viteCfgDest = join(VIEW_TOOL_DEST, "vite.config.ts");
  if (!existsSync(viteCfgDest)) {
    const viteCfg =
      `import { defineConfig } from "vite";\n` +
      `import react from "@vitejs/plugin-react";\n` +
      `import tailwindcss from "@tailwindcss/vite";\n` +
      `import { viteSingleFile } from "vite-plugin-singlefile";\n` +
      `import { resolve } from "node:path";\n\n` +
      `// Handler-agnostic multi-view build. vite-plugin-singlefile sets\n` +
      `// inlineDynamicImports:true, which Rollup forbids with multiple inputs, so\n` +
      `// the npm \`build\` script builds once per *.html entry and selects it via\n` +
      `// VITE_ENTRY. Each entry MUST point at a real .html (not a .tsx) so the\n` +
      `// bundle is wrapped in real HTML markup (pass-10 E23). tailwindcss() inlines\n` +
      `// the CSS the iframe needs (pass-13 E28).\n` +
      `const entryName = process.env.VITE_ENTRY;\n` +
      `if (!entryName) {\n` +
      `  throw new Error("vite.config.ts: set VITE_ENTRY to the view name (a *.html basename).");\n` +
      `}\n\n` +
      `export default defineConfig({\n` +
      `  plugins: [react(), tailwindcss(), viteSingleFile()],\n` +
      `  build: {\n` +
      `    outDir: "dist/ui-resources",\n` +
      `    emptyOutDir: false,\n` +
      `    rollupOptions: {\n` +
      `      input: { [entryName]: resolve(__dirname, \`\${entryName}.html\`) },\n` +
      `    },\n` +
      `  },\n` +
      `});\n`;
    writeFileSync(viteCfgDest, viteCfg, "utf8");
    console.log(`  view-tool/vite.config.ts  ← written (VITE_ENTRY-driven)`);
    anyWrite = true;
  } else {
    console.log(`  view-tool/vite.config.ts  ✓ already present`);
  }

  // 8b.5 vitest.config.ts + a minimal setup — GENERATED, not copied. The
  //     canonical _template's vitest.config points setupFiles at a
  //     widget-matcher setup and its src/__tests__/ ships EXAMPLE tests for
  //     template components; copying those into a contributor plugin would run
  //     tests for components it doesn't have. Generate a self-contained pair
  //     instead so `vitest run` in view-tool/ uses THIS config (jsdom + globals)
  //     rather than falling through to vite.config.ts — which throws without
  //     VITE_ENTRY (the Test-#? "set VITE_ENTRY to the view name" round). Both
  //     written only-if-absent; the tests-author may override either.
  const vitestCfgDest = join(VIEW_TOOL_DEST, "vitest.config.ts");
  if (!existsSync(vitestCfgDest)) {
    const vitestCfg =
      `import { defineConfig } from "vitest/config";\n` +
      `import react from "@vitejs/plugin-react";\n\n` +
      `// Handler-agnostic test config. jsdom + globals so rich-UI component\n` +
      `// tests run; \`vitest run\` must NOT fall through to vite.config.ts (which\n` +
      `// throws without VITE_ENTRY). setupFiles registers @testing-library/jest-dom\n` +
      `// (+ React cleanup); include covers component tests under src/ AND the\n` +
      `// handler-side payload-shape guard under __tests__/.\n` +
      `export default defineConfig({\n` +
      `  plugins: [react()],\n` +
      `  resolve: { conditions: ["development", "browser"] },\n` +
      `  define: { "process.env.NODE_ENV": '"test"' },\n` +
      `  test: {\n` +
      `    environment: "jsdom",\n` +
      `    globals: true,\n` +
      `    setupFiles: ["./src/__tests__/setup.ts"],\n` +
      `    include: [\n` +
      `      "src/**/*.test.{ts,tsx}",\n` +
      `      "__tests__/**/*.test.{ts,tsx}",\n` +
      `    ],\n` +
      `  },\n` +
      `});\n`;
    writeFileSync(vitestCfgDest, vitestCfg, "utf8");
    console.log(`  view-tool/vitest.config.ts  ← written (jsdom; no VITE_ENTRY)`);
    anyWrite = true;
  } else {
    console.log(`  view-tool/vitest.config.ts  ✓ already present`);
  }

  const setupDest = join(VIEW_TOOL_DEST, "src", "__tests__", "setup.ts");
  if (!existsSync(setupDest)) {
    const setup =
      `import "@testing-library/jest-dom/vitest";\n` +
      `import { cleanup } from "@testing-library/react";\n` +
      `import { afterEach } from "vitest";\n\n` +
      `afterEach(() => {\n` +
      `  cleanup();\n` +
      `});\n`;
    mkdirSync(dirname(setupDest), { recursive: true });
    writeFileSync(setupDest, setup, "utf8");
    console.log(`  view-tool/src/__tests__/setup.ts  ← written (jest-dom + cleanup)`);
    anyWrite = true;
  } else {
    console.log(`  view-tool/src/__tests__/setup.ts  ✓ already present`);
  }

  // 8c. Verbatim, placeholder-free build config + the byte-frozen apps-client
  //     (E26) and React bindings. These are deterministic infrastructure, never
  //     creative — copying them is what keeps the build resolvable and lint
  //     E26-clean without the specialist ever touching them.
  placeViewToolFile("tsconfig.json");
  placeViewToolFile("tailwind.config.mjs");
  placeViewToolFile("scripts/emit-manifest.mjs");
  placeViewToolFile("src/globals.css");
  placeViewToolFile("src/vite-env.d.ts");
  placeViewToolDir("src/lib/apps-client");
  placeViewToolDir("src/lib/apps-react");
}

// ---------------------------------------------------------------------------
if (!anyWrite) {
  console.log(`scaffold-marketplace-assets: ${slug} already complete — no changes.`);
} else {
  console.log(`scaffold-marketplace-assets: ${slug} done.`);
}
