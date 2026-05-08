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
 *   node scripts/build-plugin.mjs <slug> [<slug>...]     # build one or more plugins
 *   node scripts/build-plugin.mjs --all                   # build every plugin
 *   node scripts/build-plugin.mjs <slug> --serve          # build + launch in HTTP_MODE
 *   node scripts/build-plugin.mjs <slug1> <slug2> --serve # build all, run all servers in parallel
 *   node scripts/build-plugin.mjs <slug> --skip-install
 *                                                         # skip `npm install` steps
 *                                                         # (CI sets this once at top)
 *
 * Workspace-rooted plugins (those whose plugin-root package.json declares
 * `workspaces`) get a single `npm install` at the plugin root instead of
 * per-member installs. This is required for npm 10.9+, whose arborist
 * crashes ("Cannot read properties of null (reading 'package')") if you
 * run `npm install` inside a workspace member directory.
 *
 * Exit codes:
 *   0 — success (every component and mcp-server built; bundle-sync ok)
 *   1 — any step failed
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSkill, RenderSkillError } from "./render-skill.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const PLUGINS_DIR = join(REPO_ROOT, "plugins");

const argv = parseArgs(process.argv.slice(2));

if (argv._.length === 0 && !argv.all) {
  fail(
    "usage: node scripts/build-plugin.mjs <slug>... | --all [--serve] [--skip-install] [--port <n>]",
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

if (argv.serve && argv.port && slugs.length > 1) {
  fail(
    "--port cannot be combined with --serve and multiple slugs " +
      "(each server has its own default; specify --port for one plugin at a time)",
  );
}

for (const slug of slugs) {
  const pluginDir = join(PLUGINS_DIR, slug);
  if (!existsSync(pluginDir)) fail(`Plugin not found: plugins/${slug}/`);
  buildPlugin(slug, pluginDir, argv.skipInstall);
}

if (argv.serve) {
  log(`built ${slugs.length} plugin(s) successfully; launching server(s)`);
  servePlugins(slugs, argv.port);
  // servePlugins handles its own process exit (single) or keeps the event
  // loop alive via child stdio pipes (multi). Control does not reach the
  // success-log path below.
} else {
  log(`built ${slugs.length} plugin(s) successfully.`);
  process.exit(0);
}

// ── steps ────────────────────────────────────────────────────────────────────

function buildPlugin(slug, pluginDir, skipInstall) {
  log(`[${slug}] starting build`);

  // npm 10.9+ crashes ("Cannot read properties of null (reading 'package')")
  // if you run `npm install` inside a workspace member directory. When the
  // plugin's root package.json declares workspaces, do ONE install at the
  // plugin root and skip per-member installs — the workspace install
  // populates everything via npm's hoisting.
  const wsRooted = isWorkspaceRooted(pluginDir);
  const memberInstall = !skipInstall && !wsRooted;
  if (!skipInstall && wsRooted) {
    log(`[${slug}] workspace install (plugin root, hoists to all members)`);
    runOrFail("npm", ["install", "--no-audit", "--no-fund"], pluginDir);
  }

  // Render the sync skill from canonical/ + _overrides/ before anything
  // else needs the rendered SKILL.md. Opt-in: only fires when the plugin
  // ships skills/sync/_overrides/. Plugins that haven't migrated are
  // unaffected.
  renderSyncSkillIfPresent(slug, pluginDir);

  const components = discoverComponents(pluginDir);
  log(
    `[${slug}] discovered ${components.length} UI component(s): ${
      components.map((c) => c.uiName).join(", ") || "(none)"
    }`,
  );

  // Component build (each ui-handler's component/ has its own package.json).
  for (const c of components) {
    log(`[${slug}/${c.uiName}] building component`);
    if (memberInstall) {
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
    if (memberInstall) {
      runOrFail("npm", ["install", "--no-audit", "--no-fund"], mcpServerDir);
    }
    runOrFail("npm", ["run", "build"], mcpServerDir);
    runOrFail("npm", ["run", "check:bundle-sync"], mcpServerDir);
  } else {
    log(`[${slug}] no mcp-server/ — skipping server build`);
  }
}

function servePlugins(slugs, portArg) {
  if (slugs.length === 1) {
    serveSingle(slugs[0], portArg);
    return;
  }
  serveMany(slugs);
}

function serveSingle(slug, portArg) {
  const mcpServerDir = join(PLUGINS_DIR, slug, "mcp-server");
  const entry = join(mcpServerDir, "dist", "index.js");
  if (!existsSync(entry)) {
    fail(`[${slug}] mcp-server/dist/index.js missing — build must have failed.`);
  }
  const env = { ...process.env, HTTP_MODE: "1" };
  if (portArg !== undefined) env.PORT = String(portArg);
  log(
    `[${slug}] launching MCP server in HTTP_MODE${
      portArg !== undefined ? ` on port ${portArg}` : " (using server's default port)"
    } — Ctrl-C to stop`,
  );
  const result = spawnSync("node", [entry], {
    stdio: "inherit",
    env,
    cwd: mcpServerDir,
  });
  process.exit(result.status ?? 0);
}

function serveMany(slugs) {
  // Each MCP server has its own default PORT (e.g. agntux-core=5170,
  // agntux-slack=5180). We do NOT pass PORT, so each picks its own default
  // and ports don't collide. Use --serve with one slug + --port to override.
  const procs = [];
  let exiting = false;

  const stopAll = (signal) => {
    if (exiting) return;
    exiting = true;
    for (const { slug, proc } of procs) {
      log(`[${slug}] stopping (${signal ?? "SIGTERM"})`);
      try {
        proc.kill("SIGTERM");
      } catch {
        // Already dead.
      }
    }
  };

  for (const slug of slugs) {
    const mcpServerDir = join(PLUGINS_DIR, slug, "mcp-server");
    const entry = join(mcpServerDir, "dist", "index.js");
    if (!existsSync(entry)) {
      fail(`[${slug}] mcp-server/dist/index.js missing — build must have failed.`);
    }
    log(`[${slug}] launching MCP server in HTTP_MODE (using server's default port)`);
    const env = { ...process.env, HTTP_MODE: "1" };
    const proc = spawn("node", [entry], {
      env,
      cwd: mcpServerDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    pipeWithPrefix(proc.stdout, slug, process.stdout);
    pipeWithPrefix(proc.stderr, slug, process.stderr);
    proc.on("exit", (code, signal) => {
      // First child to exit unexpectedly tears down the rest so the user
      // doesn't end up with one server running and one dead.
      if (!exiting) {
        log(`[${slug}] exited (${signal ?? `code ${code}`}); stopping others`);
        stopAll(signal ?? "child-exit");
      }
    });
    procs.push({ slug, proc });
  }

  process.on("SIGINT", () => stopAll("SIGINT"));
  process.on("SIGTERM", () => stopAll("SIGTERM"));
  // Don't process.exit here — let the children keep the event loop alive
  // via their pipes; the script exits naturally when all have exited.
}

function pipeWithPrefix(src, slug, dst) {
  let buf = "";
  src.setEncoding("utf8");
  src.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      dst.write(`[${slug}] ${line}\n`);
    }
  });
  src.on("end", () => {
    if (buf) dst.write(`[${slug}] ${buf}\n`);
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function renderSyncSkillIfPresent(slug, pluginDir) {
  const syncDir = join(pluginDir, "skills", "sync");
  const overridesDir = join(syncDir, "_overrides");
  if (!existsSync(overridesDir)) return; // plugin hasn't migrated yet
  const canonicalDir = join(
    REPO_ROOT,
    "canonical",
    "prompts",
    "ingest",
    "skills",
    "sync",
  );
  if (!existsSync(canonicalDir)) {
    log(`[${slug}] canonical sync template missing — skipping render`);
    return;
  }
  log(`[${slug}] rendering skills/sync/ from canonical + _overrides/`);
  try {
    renderSkill({ canonicalDir, overridesDir, outputDir: syncDir });
  } catch (e) {
    const msg = e instanceof RenderSkillError ? e.message : String(e);
    fail(`[${slug}] render-skill failed: ${msg}`);
  }
}

function isWorkspaceRooted(pluginDir) {
  const pkgPath = join(pluginDir, "package.json");
  if (!existsSync(pkgPath)) return false;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return false;
  }
  return Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0;
}

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
