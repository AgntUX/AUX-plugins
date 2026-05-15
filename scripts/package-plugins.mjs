#!/usr/bin/env node
/**
 * package-plugins.mjs — produce per-plugin .zip files for manual upload to
 * Claude Desktop (Settings → Plugins → Add plugins → Upload a file) or for
 * local install via `claude --plugin-dir ./my-plugin.zip`.
 *
 * Format spec (https://code.claude.com/docs/en/plugins-reference):
 *   - File extension is .zip (not .plugin — that variant is rejected by
 *     the desktop upload dialog, see anthropics/claude-code#28337/#40414)
 *   - .claude-plugin/plugin.json sits at the zip root (no wrapper folder)
 *   - 50 MB max per zip
 *
 * Usage:
 *   node scripts/package-plugins.mjs <slug> [<slug>...]   # one or more
 *   node scripts/package-plugins.mjs --all                # every plugin
 *   node scripts/package-plugins.mjs <slug> --skip-build  # skip build step
 *   node scripts/package-plugins.mjs <slug> --out <dir>   # override output dir
 *
 * By default the script runs `scripts/build-plugin.mjs <slug>` first to
 * regenerate dist/ outputs, then zips. Pass --skip-build if the dist tree
 * is already current (e.g. straight after CI's build-plugins.yml ran).
 *
 * Output: dist-zips/{slug}-{version}.zip (configurable via --out).
 *
 * Exit codes:
 *   0 — success (every zip produced and validated)
 *   1 — any step failed (build, zip, oversize, or missing manifest)
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const PLUGINS_DIR = join(REPO_ROOT, "plugins");
const DEFAULT_OUT_DIR = join(REPO_ROOT, "dist-zips");
const MAX_ZIP_BYTES = 50 * 1024 * 1024; // Claude Desktop upload cap

// Paths/patterns excluded from every plugin zip. These are dev artifacts,
// test scaffolding, or sources whose compiled output already ships in
// dist/ — including them would only inflate the zip toward the 50 MB cap.
//
// Each pattern is passed to `zip -x` as-is, so glob semantics are the
// system zip's (Info-ZIP). The `*` matches anything including `/`.
const EXCLUDE_PATTERNS = [
  "*/node_modules/*",
  "node_modules/*",
  "*/__tests__/*",
  "__tests__/*",
  "*/examples/*",
  "examples/*",
  "*/_overrides/*",
  "_overrides/*",
  "*.test.ts",
  "*.test.tsx",
  "*.test.js",
  "vitest.config.ts",
  "vitest.config.js",
  "*/vitest.config.ts",
  "*/vitest.config.js",
  "tsconfig*.json",
  "*/tsconfig*.json",
  "vite.config.ts",
  "vite.config.js",
  "*/vite.config.ts",
  "*/vite.config.js",
  "package-lock.json",
  ".DS_Store",
  "*/.DS_Store",
  // src/ is intentionally kept — the per-plugin total is < 1 MB across the
  // whole marketplace, and excluding it would also strip canonical scaffold
  // templates under `canonical/ui-handlers/_template/{view-tool,component}/src/`,
  // which the ui-handler-author agent reads at plugin-scaffold time. Plugin
  // authors don't lose much from the dist/ + src/ duplication.
  ".git/*",
  "*/.git/*",
  ".omc",
  ".omc/*",
  "*/.omc",
  "*/.omc/*",
];

const argv = parseArgs(process.argv.slice(2));

if (argv._.length === 0 && !argv.all) {
  fail(
    "usage: node scripts/package-plugins.mjs <slug>... | --all " +
      "[--skip-build] [--out <dir>]",
  );
}

ensureZipAvailable();

const slugs = (
  argv.all
    ? readdirSync(PLUGINS_DIR).filter((d) => {
        const dir = join(PLUGINS_DIR, d);
        return (
          statSync(dir).isDirectory() &&
          existsSync(join(dir, ".claude-plugin", "plugin.json"))
        );
      })
    : argv._
)
  .slice()
  .sort();

if (slugs.length === 0) fail("No plugins found.");

const outDir = resolve(argv.out ?? DEFAULT_OUT_DIR);
mkdirSync(outDir, { recursive: true });

if (argv.skipBuild) log("--skip-build set; using existing dist/ tree");

// Build + package each plugin independently so a single plugin's build
// failure (e.g. a pre-existing rollup/vite error in one source tree) only
// skips that one plugin instead of aborting the whole run.
const results = [];
const failures = [];
for (const slug of slugs) {
  if (!argv.skipBuild) {
    log(`building ${slug}`);
    const r = spawnSync(
      "node",
      [join(REPO_ROOT, "scripts/build-plugin.mjs"), slug],
      { stdio: "inherit", cwd: REPO_ROOT },
    );
    if (r.status !== 0) {
      log(`[${slug}] build failed (exit ${r.status}); skipping package step`);
      failures.push({ slug, stage: "build" });
      continue;
    }
  }
  try {
    results.push(packageOne(slug));
  } catch (e) {
    log(`[${slug}] package failed: ${e.message}`);
    failures.push({ slug, stage: "package", error: e.message });
  }
}

log(`\npackaged ${results.length} plugin(s):`);
for (const r of results) {
  console.log(
    `  ${r.slug.padEnd(20)} ${r.zipPath}  (${formatBytes(r.size)})`,
  );
}
if (failures.length > 0) {
  log(`\n${failures.length} plugin(s) failed:`);
  for (const f of failures) {
    console.log(`  ${f.slug.padEnd(20)} ${f.stage}${f.error ? `: ${f.error}` : ""}`);
  }
}
log(`\nupload via Claude Desktop → Settings → Plugins → Add plugins → Upload a file`);
log(`or test locally:  claude --plugin-dir <zip-path>`);
process.exit(failures.length > 0 ? 1 : 0);

// ── steps ────────────────────────────────────────────────────────────────────

function packageOne(slug) {
  const pluginDir = join(PLUGINS_DIR, slug);
  const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `missing .claude-plugin/plugin.json — not a valid plugin directory`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version = manifest.version ?? "0.0.0";
  const zipName = `${slug}-${version}.zip`;
  const zipPath = join(outDir, zipName);
  if (existsSync(zipPath)) rmSync(zipPath);

  log(`[${slug}] zipping → ${zipPath}`);
  // -r recurse, -q quiet, -X strip extra attrs (DS_Store etc), -9 max compress.
  // Run from inside the plugin dir with target "." so paths are stored
  // relative to plugin root — .claude-plugin/plugin.json lands at zip root.
  const args = ["-r", "-q", "-X", "-9", zipPath, "."];
  for (const pattern of EXCLUDE_PATTERNS) {
    args.push("-x", pattern);
  }
  const r = spawnSync("zip", args, { cwd: pluginDir, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`zip failed (exit ${r.status})`);

  // Validate: must contain .claude-plugin/plugin.json at root, must be under
  // the 50 MB cap, and must be a valid zip (`zip -T`).
  const test = spawnSync("zip", ["-T", zipPath], { stdio: "pipe" });
  if (test.status !== 0) {
    throw new Error(
      `produced zip is corrupt: ${test.stderr?.toString() ?? ""}`,
    );
  }
  const listing = spawnSync("unzip", ["-l", zipPath], { stdio: "pipe" });
  const text = listing.stdout?.toString() ?? "";
  if (!text.includes(".claude-plugin/plugin.json")) {
    throw new Error(
      `zip is missing .claude-plugin/plugin.json at the root — ` +
        `Claude Desktop will reject it`,
    );
  }

  const size = statSync(zipPath).size;
  if (size > MAX_ZIP_BYTES) {
    throw new Error(
      `zip is ${formatBytes(size)} — exceeds Claude Desktop's 50 MB upload cap. ` +
        `Review excludes in scripts/package-plugins.mjs.`,
    );
  }

  return { slug, version, zipPath, size };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function ensureZipAvailable() {
  const r = spawnSync("zip", ["-v"], { stdio: "ignore" });
  if (r.status !== 0 && r.error?.code === "ENOENT") {
    fail(
      "system `zip` not found on PATH. macOS ships it at /usr/bin/zip; " +
        "on Linux install via `apt-get install zip` or equivalent.",
    );
  }
}

function parseArgs(args) {
  const out = { _: [], all: false, skipBuild: false, out: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--all") out.all = true;
    else if (a === "--skip-build") out.skipBuild = true;
    else if (a === "--out") out.out = args[++i];
    else if (a.startsWith("--out=")) out.out = a.slice("--out=".length);
    else if (a.startsWith("--")) fail(`Unknown flag: ${a}`);
    else out._.push(a);
  }
  return out;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function log(msg) {
  console.log(`package-plugins: ${msg}`);
}

function fail(msg) {
  console.error(`package-plugins: ${msg}`);
  process.exit(1);
}
