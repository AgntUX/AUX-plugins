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
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSkill, RenderSkillError } from "./render-skill.mjs";

// stdout/stderr signatures that indicate Vite + @vitejs/plugin-react crashed
// architecturally (aarch64 Linux is the canonical host) rather than failing
// for a real error in the component code. On match, fall back to esbuild
// per plan §C4. Non-architectural failures (typescript errors, missing
// imports, etc.) propagate so the contributor sees the real cause.
const TOOLCHAIN_CRASH_SIGNATURES = [
  /Bus error/i,
  /SIGBUS/,
  /Segmentation fault/i,
  /core dumped/i,
];

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
  await buildPlugin(slug, pluginDir, argv.skipInstall);
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

async function buildPlugin(slug, pluginDir, skipInstall) {
  log(`[${slug}] starting build`);

  // C2 — `@agntux/ui-primitives` is a workspace dep declared via the
  // file:../../../../../packages/agntux-ui-primitives path. When the
  // build runs inside AUX-plugins/ (the normal case) that path resolves
  // to packages/agntux-ui-primitives — already there, no-op. When the
  // build runs in a scaffolded location outside AUX-plugins/ (the
  // agntux-build stage 7 case), the path doesn't resolve. ensurePackages
  // creates a symlink (or copies on filesystems that don't allow them)
  // from a sourceable location, picking in this order:
  //   1. AGNTUX_PACKAGES_DIR env var (explicit override)
  //   2. <REPO_ROOT>/packages (internal AUX-plugins build — already there)
  //   3. <CLAUDE_PLUGIN_ROOT>/canonical/packages (agntux-build scaffold)
  // If none resolve and the file: target is missing, log a clear error.
  ensurePackagesAvailable(slug, pluginDir);

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
    // C4 — Try Vite first, fall back to esbuild on architectural crashes
    // (aarch64 Linux is the canonical SIGBUS host). The locale-stubs
    // problem (canonical use-translation.ts static-imports 11 locales)
    // is solved at the template level: the canonical scaffold ships all
    // 11 locale files (10 are en-US copies awaiting real translations).
    // Customised use-translation hooks in shipped plugins import only
    // the locales they ship — no runtime stubbing required.
    await runComponentBuildWithFallback(slug, c);
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

function ensurePackagesAvailable(slug, pluginDir) {
  // Resolve the `@agntux/ui-primitives` workspace path via the canonical
  // `file:../../../../../packages/agntux-ui-primitives` declaration:
  // 5 levels up from {plugin}/ui-handlers/{name}/component/ lands at
  // {pluginDir}/../../packages. Same calculation from {pluginDir} alone.
  const expected = resolve(pluginDir, "..", "..", "packages");
  const expectedPrimitive = join(expected, "agntux-ui-primitives");
  if (existsSync(expectedPrimitive)) return;

  // Source candidates, in priority order. The first one whose
  // agntux-ui-primitives child exists wins.
  const candidates = [
    process.env.AGNTUX_PACKAGES_DIR,
    join(REPO_ROOT, "packages"),
    process.env.CLAUDE_PLUGIN_ROOT
      ? join(process.env.CLAUDE_PLUGIN_ROOT, "canonical", "packages")
      : null,
  ].filter(Boolean);

  let source = null;
  for (const cand of candidates) {
    if (existsSync(join(cand, "agntux-ui-primitives"))) {
      source = cand;
      break;
    }
  }
  if (!source) {
    fail(
      `[${slug}] @agntux/ui-primitives not resolvable. Expected ` +
        `${expectedPrimitive} or one of: ${candidates.join(", ") || "<no candidates>"}. ` +
        `Set AGNTUX_PACKAGES_DIR to point at a directory containing ` +
        `agntux-ui-primitives/, or run inside the AUX-plugins repo where ` +
        `packages/ already lives.`,
    );
  }

  log(`[${slug}] linking packages/ from ${source}`);
  mkdirSync(dirname(expected), { recursive: true });
  try {
    symlinkSync(source, expected, "dir");
  } catch (err) {
    // EPERM on Windows or some sandboxed filesystems — fall back to copy.
    if (err.code === "EPERM" || err.code === "EXDEV") {
      log(
        `[${slug}] symlink failed (${err.code}); copying packages/ instead`,
      );
      cpSync(source, expected, { recursive: true, dereference: true });
    } else {
      throw err;
    }
  }
}

async function runComponentBuildWithFallback(slug, component) {
  // First pass: the canonical Vite + @vitejs/plugin-react path. Stream
  // stdout/stderr live to the user (so a long build keeps showing
  // progress) while also tee-ing into a buffer so we can sniff for
  // architectural-crash signatures on failure. Plain stdio:"inherit"
  // would lose the buffer; plain stdio:"pipe" would batch output to
  // the end. Run async + manual tee gives us both.
  const { status, signal, stdout, stderr } = await runAndTee(
    "npm",
    ["run", "build"],
    component.componentDir,
  );

  if (status === 0) return;

  const combined = `${stdout}\n${stderr}\n${signal ?? ""}`;
  const crashed =
    signal === "SIGBUS" ||
    signal === "SIGSEGV" ||
    TOOLCHAIN_CRASH_SIGNATURES.some((re) => re.test(combined));
  if (!crashed) {
    fail(
      `[${slug}/${component.uiName}] component build failed (exit ${status}). ` +
        `Not an architectural crash; propagating the real error above.`,
    );
  }

  log(
    `[${slug}/${component.uiName}] Vite crashed architecturally${
      signal ? ` (signal=${signal})` : ""
    }; falling back to direct esbuild`,
  );
  runEsbuildFallback(slug, component);
}

function runAndTee(cmd, args, cwd) {
  const proc = spawn(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    stdout += chunk;
  });
  proc.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    stderr += chunk;
  });
  return new Promise((resolve) => {
    proc.on("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function runEsbuildFallback(slug, component) {
  const componentDir = component.componentDir;
  const entry = pickEsbuildEntry(componentDir);
  if (!entry) {
    fail(
      `[${slug}/${component.uiName}] esbuild fallback could not find an entry ` +
        `(looked for src/main.tsx, src/main.ts, src/index.tsx, src/index.ts).`,
    );
  }
  const outDir = join(componentDir, "out");
  mkdirSync(outDir, { recursive: true });
  const bundlePath = join(outDir, "bundle.js");
  const args = [
    "esbuild",
    entry,
    "--bundle",
    `--outfile=${bundlePath}`,
    "--jsx=automatic",
    "--loader:.json=json",
    "--loader:.css=text",
    "--target=es2022",
    "--format=esm",
    "--minify",
    "--resolve-extensions=.tsx,.ts,.jsx,.js,.mjs",
    "--conditions=import,module,browser,default",
    "--alias:react=./node_modules/react",
    "--alias:react-dom=./node_modules/react-dom",
    "--alias:react/jsx-runtime=./node_modules/react/jsx-runtime.js",
    "--external:tailwindcss",
  ];
  // Drop --no-install so npx will fetch esbuild on demand if it's not
  // already in the workspace's node_modules (the canonical scaffold
  // doesn't list esbuild as a component dep — it only enters the picture
  // here as an architectural-crash escape hatch).
  const r = spawnSync("npx", args, {
    cwd: componentDir,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    fail(
      `[${slug}/${component.uiName}] esbuild fallback also failed (exit ${r.status}). ` +
        `The component likely has a real build error — check the output above.`,
    );
  }
  // Wrap the bundle into a single-file HTML shell so the rest of the
  // pipeline (embed-bundle.mjs etc.) still finds out/index.html.
  const bundleSource = readFileSync(bundlePath, "utf8");
  const html =
    `<!doctype html>\n<html><head><meta charset="utf-8"><title></title></head>` +
    `<body><div id="root"></div><script type="module">${bundleSource}</script></body></html>\n`;
  const indexPath = join(outDir, "index.html");
  writeFileSync(indexPath, html, "utf8");
  log(`[${slug}/${component.uiName}] esbuild fallback produced out/index.html`);
}

function pickEsbuildEntry(componentDir) {
  for (const candidate of [
    "src/main.tsx",
    "src/main.ts",
    "src/index.tsx",
    "src/index.ts",
  ]) {
    if (existsSync(join(componentDir, candidate))) return candidate;
  }
  return null;
}

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
