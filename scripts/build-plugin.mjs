#!/usr/bin/env node
/**
 * build-plugin.mjs — single source of truth for building a plugin's UI
 * handler components, then its mcp-server (which embeds the components),
 * then verifying bundle sync.
 *
 * Used by:
 *   - Local development (`npm run build` / `npm run dev` from a plugin root,
 *     or `/dev-plugin {slug}` from anywhere in the repo).
 *   - CI: `.github/workflows/ci.yml` runs this per changed plugin to verify
 *     the bundle is rebuildable; `.github/workflows/build-plugins.yml` runs
 *     it on push to main and commits the regenerated dist/ tree back.
 *
 * Build order matters. The mcp-server's tsc + embed-bundle step base64-embeds
 * `ui-handlers/*\/component/out/index.html` into the compiled JS, so every
 * component must build before the server.
 *
 * Usage:
 *   node scripts/build-plugin.mjs <slug>           # build one plugin
 *   node scripts/build-plugin.mjs --all            # build every plugin
 *   node scripts/build-plugin.mjs <slug> --serve   # build + launch in HTTP_MODE
 *   node scripts/build-plugin.mjs <slug> --skip-install
 *                                                  # skip `npm install` steps
 *                                                  # (CI sets this once at top)
 *
 * Exit codes:
 *   0 — success (every component, mcp-server, packages/mcp-license built; sync ok)
 *   1 — any step failed
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const PLUGINS_DIR = join(REPO_ROOT, "plugins");
const SHARED_LICENSE_PKG = join(REPO_ROOT, "packages", "mcp-license");

const argv = parseArgs(process.argv.slice(2));

if (argv._.length === 0 && !argv.all) {
  fail(
    "usage: node scripts/build-plugin.mjs <slug>|--all [--serve] [--skip-install] [--port <n>]",
  );
}

// Sort alphabetically so build order is deterministic across runs and
// across filesystems. This also keeps cross-plugin file: deps satisfied:
// agntux-slack/mcp-server depends on agntux-core/mcp-server (file:),
// so core must build before slack — which alphabetical order guarantees.
// If a future plugin introduces a non-alphabetical dependency we'll need
// to topologically sort instead.
const slugs = (
  argv.all
    ? readdirSync(PLUGINS_DIR).filter((d) =>
        existsSync(join(PLUGINS_DIR, d, "mcp-server")),
      )
    : argv._
).slice().sort();

if (slugs.length === 0) {
  fail("No plugins found.");
}

if (argv.serve && slugs.length > 1) {
  fail("--serve can only be used with a single plugin slug.");
}

// Always build the shared license package first — every plugin's mcp-server
// resolves `@agntux/mcp-license` via `file:../../../packages/mcp-license` and
// imports from its compiled dist/.
buildSharedLicensePackage(argv.skipInstall);

for (const slug of slugs) {
  const pluginDir = join(PLUGINS_DIR, slug);
  if (!existsSync(pluginDir)) fail(`Plugin not found: plugins/${slug}/`);
  buildPlugin(slug, pluginDir, argv.skipInstall);
}

if (argv.serve) {
  const slug = slugs[0];
  servePlugin(slug, argv.port);
}

log(`built ${slugs.length} plugin(s) successfully.`);
process.exit(0);

// ── steps ────────────────────────────────────────────────────────────────────

function buildSharedLicensePackage(skipInstall) {
  if (!existsSync(SHARED_LICENSE_PKG)) return;
  log(`[shared] building @agntux/mcp-license`);
  if (!skipInstall) {
    runOrFail("npm", ["install", "--no-audit", "--no-fund"], SHARED_LICENSE_PKG);
  }
  runOrFail("npm", ["run", "build"], SHARED_LICENSE_PKG);
}

function buildPlugin(slug, pluginDir, skipInstall) {
  log(`[${slug}] starting build`);

  const components = discoverComponents(pluginDir);
  log(
    `[${slug}] discovered ${components.length} UI component(s): ${
      components.map((c) => c.uiName).join(", ") || "(none)"
    }`,
  );

  // Component build (each ui-handler's component/ has its own package.json).
  for (const c of components) {
    log(`[${slug}/${c.uiName}] building component`);
    if (!skipInstall) {
      runOrFail("npm", ["install", "--no-audit", "--no-fund"], c.componentDir);
    }
    runOrFail("npm", ["run", "build"], c.componentDir);
    if (!existsSync(join(c.componentDir, "out", "index.html"))) {
      fail(
        `[${slug}/${c.uiName}] build did not produce out/index.html — check the component's vite config.`,
      );
    }
  }

  // MCP server build (tsc + embed-bundle.mjs picks up component/out/index.html).
  const mcpServerDir = join(pluginDir, "mcp-server");
  if (existsSync(mcpServerDir)) {
    log(`[${slug}] building mcp-server (tsc + embed-bundle)`);
    if (!skipInstall) {
      runOrFail("npm", ["install", "--no-audit", "--no-fund"], mcpServerDir);
    }
    runOrFail("npm", ["run", "build"], mcpServerDir);
    runOrFail("npm", ["run", "check:bundle-sync"], mcpServerDir);
  } else {
    log(`[${slug}] no mcp-server/ — skipping server build`);
  }
}

function servePlugin(slug, portArg) {
  const mcpServerDir = join(PLUGINS_DIR, slug, "mcp-server");
  const entry = join(mcpServerDir, "dist", "index.js");
  if (!existsSync(entry)) {
    fail(`[${slug}] mcp-server/dist/index.js missing — build must have failed.`);
  }
  const port = portArg ?? "5180";
  log(
    `[${slug}] launching MCP server in HTTP_MODE on http://127.0.0.1:${port} (Ctrl-C to stop)`,
  );
  const env = { ...process.env, HTTP_MODE: "1", PORT: String(port) };
  const result = spawnSync("node", [entry], {
    stdio: "inherit",
    env,
    cwd: mcpServerDir,
  });
  process.exit(result.status ?? 0);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function discoverComponents(pluginDir) {
  const out = [];
  const handlersDir = join(pluginDir, "ui-handlers");
  if (!existsSync(handlersDir)) return out;
  for (const entry of readdirSync(handlersDir)) {
    if (entry.startsWith("_")) continue; // skip _template
    const componentDir = join(handlersDir, entry, "component");
    const pkgJson = join(componentDir, "package.json");
    if (!existsSync(pkgJson)) continue;
    out.push({ uiName: entry, componentDir });
  }
  return out;
}

function parseArgs(args) {
  const out = { _: [], all: false, serve: false, skipInstall: false, port: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--all") out.all = true;
    else if (a === "--serve") out.serve = true;
    else if (a === "--skip-install") out.skipInstall = true;
    else if (a === "--port") out.port = args[++i];
    else if (a.startsWith("--port=")) out.port = a.slice("--port=".length);
    else if (a.startsWith("--")) fail(`Unknown flag: ${a}`);
    else out._.push(a);
  }
  return out;
}

function runOrFail(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd });
  if (r.status !== 0) {
    fail(`Step failed: ${cmd} ${args.join(" ")} (cwd=${cwd}) — exit ${r.status}`);
  }
}

function log(msg) {
  console.log(`build-plugin: ${msg}`);
}

function fail(msg) {
  console.error(`build-plugin: ${msg}`);
  process.exit(1);
}
