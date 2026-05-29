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
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveToolchain } from "./toolchain-layout.mjs";

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
// Resolve toolchain artifacts for the layout we're under (maintainer clone OR
// contributor bundle). PLUGINS_DIR is null in the bundle (no marketplace clone)
// — the bundle path always targets an explicit --plugin-dir.
const tc = resolveToolchain(__dirname);
const PLUGINS_DIR = tc.pluginsDir;
// render-skill ships in scripts/ in both layouts; in the bundle this entrypoint
// runs from bin/, so a bin-relative "./render-skill.mjs" wouldn't resolve.
// Dynamic-import it via the layout path instead.
const { renderSkill, RenderSkillError } = await import(
  pathToFileURL(tc.renderSkillScript).href
);

// CLI dispatch lives in main(), guarded below so this module can be imported
// (by tests) without running a build. Function declarations above/below are
// hoisted and side-effect-free on import.
async function main() {
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
//
// --all picks up every plugin that ships either a `mcp-server/` (local-
// server kind) or a `view-tool/` (source/remote-view-only kind, post P7).
// agntux-core ships both and so runs both pipelines below.
if (argv.all && !PLUGINS_DIR) {
  fail("--all requires the maintainer clone (there is no plugins/ directory in the bundle).");
}

const slugs = (
  argv.all
    ? readdirSync(PLUGINS_DIR).filter(
        (d) =>
          existsSync(join(PLUGINS_DIR, d, "mcp-server")) ||
          existsSync(join(PLUGINS_DIR, d, "view-tool")) ||
          // plugins that ship the in-bundle toolchain (agntux-build) have a
          // bundle to re-vendor even though they compile nothing.
          existsSync(join(PLUGINS_DIR, d, "bin", "validate-plugin.mjs")),
      )
    : argv._
).slice().sort();

if (slugs.length === 0) {
  fail("No plugins found.");
}

// --plugin-dir targets an explicit tree (the contributor build sandbox, or any
// out-of-clone path). It pairs with exactly one slug — the marker slug used for
// logging and the view_tools[].name prefix.
if (argv.pluginDir && slugs.length !== 1) {
  fail("--plugin-dir takes exactly one slug (the plugin's marker slug).");
}
if (!argv.pluginDir && !PLUGINS_DIR) {
  fail("Running from the bundle (no plugins/ dir): pass --plugin-dir <abs> with one slug.");
}

if (argv.serve && argv.port && slugs.length > 1) {
  fail(
    "--port cannot be combined with --serve and multiple slugs " +
      "(each server has its own default; specify --port for one plugin at a time)",
  );
}

for (const slug of slugs) {
  const pluginDir = argv.pluginDir
    ? resolve(argv.pluginDir)
    : join(PLUGINS_DIR, slug);
  if (!existsSync(pluginDir)) fail(`Plugin not found: ${pluginDir}`);
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
}

// Run the CLI only when invoked directly — keeps ensurePackagesAvailable +
// the vendoring/dedup helpers importable from tests without a real build.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}

// ── steps ────────────────────────────────────────────────────────────────────

async function buildPlugin(slug, pluginDir, skipInstall) {
  log(`[${slug}] starting build`);

  // agntux-build ships the build/validate toolchain in-bundle (bin/, scripts/,
  // canonical/packages, canonical templates). Re-vendor it from the repo-root
  // sources whenever agntux-build is built — like a dist artifact — so CI's
  // push-to-main rebuild keeps the bundle in sync. Repo layout only (the bundle
  // itself has no sources to sync from).
  if (slug === "agntux-build" && tc.layout === "repo") {
    log(`[${slug}] syncing in-bundle toolchain (bin/ + scripts/ + canonical/)`);
    runOrFail("node", [join(tc.base, "scripts", "sync-agntux-build-toolchain.mjs")], tc.base);
  }

  // C2 — `@agntux/ui-primitives` + `@agntux/plugin-runtime` are workspace deps
  // declared via file: paths. When the build runs inside AUX-plugins/ (the
  // maintainer clone) the deps already resolve to <repo>/packages — no-op. When
  // the build runs in a scaffolded sandbox location (the agntux-build stage-7
  // case) ensurePackagesAvailable vendors dist-only copies of the packages into
  // a PER-SESSION writable dir (…/builds/{session-id}/packages), which the
  // scaffold's view-tool file: deps (../../packages) resolve to. The canonical
  // source is read-only and picked in this order:
  //   1. AGNTUX_PACKAGES_DIR env var (explicit override; the validator sets it)
  //   2. <REPO_ROOT>/packages (maintainer clone)
  //   3. <CLAUDE_PLUGIN_ROOT>/canonical/packages (agntux-build bundle)
  // A shared dir is NEVER mutated (the L1 fix); the copy is dist-only (the L2
  // fix). If none resolve, fail with a clear error.
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

  // P7 routing predicate — pick build pipeline(s) by directory presence:
  //   - mcp-server/  → local-server kind → tsc + embed-bundle, check:bundle-sync
  //   - view-tool/   → source kind (remote-view-only) → vite + tsc + esbuild + emit-manifest
  // agntux-core has both, so it runs BOTH pipelines. plugin-toolkit and
  // agntux-build ship mcp-server/ only and skip the view-tool branch. New
  // source plugins (agntux-slack, agntux-gmail post-Phase-5) ship view-tool/
  // only and skip the legacy ui-handlers + mcp-server branch.
  const mcpServerDir = join(pluginDir, "mcp-server");
  const viewToolDir = join(pluginDir, "view-tool");
  const hasMcpServer = existsSync(mcpServerDir);
  const hasViewTool = existsSync(viewToolDir);

  if (hasMcpServer) {
    // Legacy ui-handlers components only feed the mcp-server embed; skip
    // them for view-tool-only plugins where they would be both absent and
    // unused.
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
    log(`[${slug}] building mcp-server (tsc + embed-bundle)`);
    if (memberInstall) {
      runOrFail("npm", ["install", "--no-audit", "--no-fund"], mcpServerDir);
    }
    runOrFail("npm", ["run", "build"], mcpServerDir);
    // check:bundle-sync is opt-in: plugins that embed a UI bundle ship the
    // script (agntux-core, agntux-slack/legacy); plugins without an
    // embedded UI (agntux-build) omit it. Skip when absent rather than
    // failing.
    if (hasMcpServerScript(mcpServerDir, "check:bundle-sync")) {
      runOrFail("npm", ["run", "check:bundle-sync"], mcpServerDir);
    } else {
      log(`[${slug}] mcp-server has no check:bundle-sync script — skipping`);
    }
  }

  if (hasViewTool) {
    // P7 view-tool pipeline. The plugin's view-tool/package.json owns the
    // command chain (vite → tsc → esbuild → emit-manifest); we just
    // invoke `npm run build` inside it and trust the package.json. Skip
    // check:bundle-sync — there is no embedded UI bundle (the remote
    // registry fetches ui-resources/*.html from GitHub directly).
    log(`[${slug}] building view-tool (vite + tsc + esbuild + emit-manifest)`);
    if (memberInstall) {
      runOrFail("npm", ["install", "--no-audit", "--no-fund"], viewToolDir);
    }
    // L2 — after node_modules is populated, assert a single @types/react graph
    // reachable from the view-tool. A duplicate is what made tsc fail with
    // TS2786 (ComponentErrorBoundary "cannot be used as a JSX component") on an
    // otherwise-correct plugin; fail loudly + routable here instead.
    assertSingleReactTypes(slug, pluginDir);
    // C1 — data-driven @agntux/ui-primitives import gate, BEFORE vite. Auto-
    // re-routes apps hooks (useHostStyleVariables, …) to ./lib/apps-react and
    // renames the deprecated useStructuredContent; HARD-fails on a symbol
    // exported by nothing (the hallucinated-import class — buildConnectorEnvelope,
    // StickyFooter) with a clear, routed message instead of vite's opaque
    // "not exported by" crash.
    log(`[${slug}] checking view-tool @agntux/ui-primitives imports`);
    runOrFail(
      "node",
      [tc.importCheckScript, "--plugin-dir", pluginDir, "--fix", "--packages-dir", tc.packagesDir],
      pluginDir,
    );
    runOrFail("npm", ["run", "build"], viewToolDir);
  }

  if (!hasMcpServer && !hasViewTool) {
    // Skill-only plugin (e.g. agntux-build post-0.5.0): ships skills/,
    // agents/, marketplace/ and nothing that needs a compile step. The
    // sync-skill render above still ran if relevant. Treat as a successful
    // no-op so package-plugins can proceed to zip the source tree.
    log(`[${slug}] skill-only plugin (no mcp-server/ or view-tool/) — nothing to compile`);
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
  if (!existsSync(mcpServerDir)) {
    fail(
      `[${slug}] has no mcp-server/ — this is a source/remote-view-only plugin; ` +
        `there is no local server to launch. Use the plugin-toolkit-test ` +
        `render-view-tool subcommand instead (see docs/specs/render-view-tool.md).`,
    );
  }
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
    if (!existsSync(mcpServerDir)) {
      fail(
        `[${slug}] has no mcp-server/ — source/remote-view-only plugins cannot ` +
          `be --served. Either drop ${slug} from this --serve run or use the ` +
          `plugin-toolkit-test render-view-tool subcommand for it.`,
      );
    }
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
  // Source candidates for the canonical (READ-ONLY) @agntux/* packages, in
  // priority order. The first one whose agntux-ui-primitives child exists wins.
  // tc.packagesDir is <repo>/packages in the maintainer clone and
  // <plugin>/canonical/packages in the contributor bundle.
  const candidates = [
    process.env.AGNTUX_PACKAGES_DIR,
    tc.packagesDir,
    process.env.CLAUDE_PLUGIN_ROOT
      ? join(process.env.CLAUDE_PLUGIN_ROOT, "canonical", "packages")
      : null,
  ].filter(Boolean);

  // ── Maintainer-clone fast path ─────────────────────────────────────────────
  // In the AUX-plugins clone, packages already live two levels up from the
  // plugin (<repo>/plugins/<slug> → <repo>/packages) and each repo plugin's own
  // view-tool file: dep already resolves there. If that dir exists AND is
  // (realpath-)the same tree as our canonical source, there is nothing to
  // vendor — NEVER disturb the repo's own packages/ (or a workspace symlink).
  const repoPackages = resolve(pluginDir, "..", "..", "packages");
  if (existsSync(join(repoPackages, "agntux-ui-primitives"))) {
    let sameAsCanonical = false;
    try {
      sameAsCanonical =
        realpathSync(repoPackages) === realpathSync(tc.packagesDir);
    } catch {
      /* one side unreadable — treat as different and vendor per-session */
    }
    if (sameAsCanonical) {
      log(`[${slug}] packages resolved in place (maintainer clone) — no vendoring`);
      return;
    }
  }

  // ── Contributor / sandbox path: per-session WRITABLE vendoring (L1) ─────────
  // The prior code vendored to resolve(pluginDir,"..","..","packages") — a dir
  // SHARED across every build session (…/.agntux-build/builds/packages). In the
  // Cowork sandbox that shared dir is immutable (EPERM on rmdir), so the in-place
  // rebuild could never start. Vendor instead into a PER-SESSION dir that is a
  // sibling of the plugin dir, inside the writable {session-id}/ dir:
  //   …/.agntux-build/builds/{session-id}/packages
  // The scaffold's view-tool file: deps point at ../../packages (from
  // view-tool/) which resolves to exactly this path. We only ever create or
  // replace this per-session copy — never a shared dir.
  const sessionPackages = resolve(pluginDir, "..", "packages");

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
        `${join(sessionPackages, "agntux-ui-primitives")} or one of: ` +
        `${candidates.join(", ") || "<no candidates>"}. ` +
        `Set AGNTUX_PACKAGES_DIR to point at a directory containing ` +
        `agntux-ui-primitives/, or run inside the AUX-plugins repo where ` +
        `packages/ already lives.`,
    );
  }

  // Defensive: never let the per-session target collide with the read-only
  // source (a misconfigured layout) — replacing it would delete the source.
  let collides = false;
  try {
    collides =
      existsSync(sessionPackages) &&
      realpathSync(sessionPackages) === realpathSync(source);
  } catch {
    /* unreadable — treat as no collision */
  }
  if (collides) {
    log(`[${slug}] per-session packages dir IS the source — leaving in place`);
    return;
  }

  // Copy package.json (lifecycle scripts + devDependencies stripped) + dist/ +
  // src/ + README — NEVER node_modules. A blanket recursive copy (the old
  // `cpSync(..., {dereference:true})` fallback) dragged a nested
  // node_modules/@types/react into the vendored tree, which made tsc fail with
  // TS2786 — duplicate React type identities — on a correct plugin (L2). A
  // dist-only copy guarantees the vendored primitives contribute ZERO
  // @types/react. Copy (not symlink) because the sandbox FS rejects cross-dir
  // symlinks (EPERM) and a copy keeps a single types graph.
  log(`[${slug}] vendoring packages/ → ${sessionPackages} (dist-only) from ${source}`);
  vendorPackagesDistOnly(source, sessionPackages);
}

/**
 * Copy each package directory under `sourceDir` into `destDir`, taking ONLY
 * package.json (with lifecycle scripts + devDependencies stripped so a
 * contributor's `npm install` of the file: dep never rebuilds the pre-built
 * dist) plus dist/ and README.md. node_modules is never copied — that is the L2
 * fix. Only each package's own per-session copy is replaced; nothing outside
 * destDir is touched.
 */
export function vendorPackagesDistOnly(sourceDir, destDir) {
  for (const e of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const srcPkg = join(sourceDir, e.name);
    const srcPkgJson = join(srcPkg, "package.json");
    if (!existsSync(srcPkgJson)) continue;
    const destPkg = join(destDir, e.name);
    rmSync(destPkg, { recursive: true, force: true });
    mkdirSync(destPkg, { recursive: true });
    let pkg = null;
    try {
      pkg = JSON.parse(readFileSync(srcPkgJson, "utf8"));
    } catch {
      /* fall back to a raw copy below */
    }
    if (pkg) {
      // Strip scripts (so `npm install` of the file: dep never runs tsc/prepare
      // — absent in the sandbox) and devDependencies (build-only). INVARIANT:
      // vendored @agntux/* packages must have NO registry-only runtime
      // `dependencies` (only peerDependencies the view-tool already satisfies),
      // or an offline contributor install would fail to fetch them.
      delete pkg.scripts;
      delete pkg.devDependencies;
      writeFileSync(
        join(destPkg, "package.json"),
        JSON.stringify(pkg, null, 2) + "\n",
      );
    } else {
      cpSync(srcPkgJson, join(destPkg, "package.json"));
    }
    // dist/ is what's imported (main/types); README rides along to match the
    // package's "files". src/ is intentionally NOT copied — consumers resolve
    // dist only, and the in-bundle canonical/packages/* ship dist-only anyway,
    // so copying src would just add surface.
    const distDir = join(srcPkg, "dist");
    if (existsSync(distDir)) cpSync(distDir, join(destPkg, "dist"), { recursive: true });
    const readme = join(srcPkg, "README.md");
    if (existsSync(readme)) cpSync(readme, join(destPkg, "README.md"));
  }
}

/**
 * L2 regression guard. After the view-tool's node_modules is populated, assert
 * exactly one @types/react is reachable from the plugin tree (the view-tool's
 * node_modules + the per-session vendored packages). More than one re-creates
 * the TS2786 duplicate-identity crash; fail with a routable
 * `BUILD-types-react-dup` code instead of a cryptic tsc error. `skipLibCheck`
 * does NOT mask TS2786 (it fires on the consuming file), so dedup must happen at
 * resolution.
 */
function assertSingleReactTypes(slug, pluginDir) {
  const viewTool = join(pluginDir, "view-tool");
  if (!existsSync(viewTool)) return;
  const roots = [
    join(viewTool, "node_modules"),
    resolve(pluginDir, "..", "packages"),
  ];
  const hits = findReactTypesCopies(roots);
  if (hits.length > 1) {
    fail(
      `[${slug}] BUILD-types-react-dup: ${hits.length} copies of @types/react are ` +
        `reachable from the view-tool, which makes tsc fail with TS2786 ` +
        `(duplicate React type identities). Vendoring must be dist-only (no ` +
        `node_modules). Copies:\n${hits.map((h) => `  - ${h}`).join("\n")}`,
    );
  }
}

/**
 * Find every `@types/react/package.json` under the given roots, de-duplicated
 * by realpath (a single physical copy reachable via two link paths counts
 * once). Symlinked directories are not traversed (dirent.isDirectory() is false
 * for a symlink), which avoids cycles and keeps the walk bounded to the real
 * node_modules / packages trees.
 */
export function findReactTypesCopies(roots) {
  const byReal = new Map(); // realpath(@types/react/package.json) → first path
  const visited = new Set(); // realpath(dir) → cycle + already-walked guard
  const stack = roots.filter((r) => existsSync(r));
  while (stack.length) {
    const dir = stack.pop();
    let real;
    try {
      real = realpathSync(dir);
    } catch {
      real = dir;
    }
    if (visited.has(real)) continue; // symlink cycle or already walked
    visited.add(real);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      // statSync FOLLOWS symlinks (unlike dirent.isDirectory()): npm/pnpm
      // routinely symlink package dirs, and a duplicate @types/react reachable
      // only behind a symlink must still count — a missed dup re-creates the
      // very TS2786 crash this guard exists to prevent. The visited-realpath set
      // keeps the symlink-following walk cycle-safe.
      let st;
      try {
        st = statSync(full);
      } catch {
        continue; // dangling symlink / unreadable
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (
        st.isFile() &&
        e.name === "package.json" &&
        basename(dir) === "react" &&
        basename(dirname(dir)) === "@types"
      ) {
        let key = full;
        try {
          key = realpathSync(full);
        } catch {
          /* keep raw path */
        }
        if (!byReal.has(key)) byReal.set(key, full);
      }
    }
  }
  return [...byReal.values()];
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
  // Real layout is skills/<slug>/_overrides (the rendered tree is named after
  // the slug so the host exposes it as /<slug>); the legacy skills/sync/ name
  // is still tolerated. Rendering here at build time makes the committed skill
  // tree reproducible from canonical even if the flow forgot to run
  // render-skill — the deterministic-render guarantee lint pass 8 enforces.
  const syncDir = [join(pluginDir, "skills", slug), join(pluginDir, "skills", "sync")].find(
    (d) => existsSync(join(d, "_overrides")),
  );
  if (!syncDir) return; // plugin doesn't opt into the canonical render pipeline
  const overridesDir = join(syncDir, "_overrides");
  const canonicalDir = tc.canonicalSyncDir;
  if (!existsSync(canonicalDir)) {
    log(`[${slug}] canonical sync template missing — skipping render`);
    return;
  }
  const skillRel = syncDir === join(pluginDir, "skills", slug) ? `skills/${slug}/` : "skills/sync/";
  log(`[${slug}] rendering ${skillRel} from canonical + _overrides/`);
  try {
    renderSkill({ canonicalDir, overridesDir, outputDir: syncDir });
  } catch (e) {
    const msg = e instanceof RenderSkillError ? e.message : String(e);
    fail(`[${slug}] render-skill failed: ${msg}`);
  }
}

function hasMcpServerScript(mcpServerDir, scriptName) {
  const pkgPath = join(mcpServerDir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return Boolean(pkg.scripts && pkg.scripts[scriptName]);
  } catch {
    return false;
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
  const out = { _: [], all: false, serve: false, skipInstall: false, port: undefined, pluginDir: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--all") out.all = true;
    else if (a === "--serve") out.serve = true;
    else if (a === "--skip-install") out.skipInstall = true;
    else if (a === "--port") out.port = args[++i];
    else if (a.startsWith("--port=")) out.port = a.slice("--port=".length);
    else if (a === "--plugin-dir") out.pluginDir = args[++i];
    else if (a.startsWith("--plugin-dir=")) out.pluginDir = a.slice("--plugin-dir=".length);
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
