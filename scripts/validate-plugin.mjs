#!/usr/bin/env node
/**
 * validate-plugin.mjs — the deterministic pre-submission validation gate.
 *
 * This is the single CODE gate that converts every pre-submit dimension
 * (build, lint, view-tool typecheck, tests, render, structural validate)
 * from prose-only — which a broken plugin can sail past — into enforced,
 * exit-code-disciplined steps. On full success it writes a tree-bound
 * `validation-receipt.json` whose `tree_sha256` is computed with the EXACT
 * same walk + exclude lists the stage-12 submit program uses, so
 * `SUBMISSION.json` is impossible to emit without a matching green receipt
 * for THIS tree (see skills/build/references/12-submit.md).
 *
 * Modelled on scripts/build-plugin.mjs's exit-code discipline
 * (fail() → process.exit(1)).
 *
 * Usage:
 *   node scripts/validate-plugin.mjs <slug>
 *   node scripts/validate-plugin.mjs <slug> --plugin-dir <abs> --session-dir <abs>
 *
 *   <slug>          full plugin slug, e.g. agntux-gmail (the marker SLUG).
 *   --plugin-dir    absolute path to the plugin tree to hash + validate.
 *                   Default: <REPO_ROOT>/plugins/<slug> (the AUX-plugins
 *                   clone layout). The build sandbox copy lives at
 *                   <agntux root>/.agntux-build/builds/{id}/agntux-{slug}/.
 *   --session-dir   absolute path the receipt is written into (a SIBLING of
 *                   the plugin dir, never inside the tree — so it can't
 *                   perturb the hash). Default: dirname(plugin-dir).
 *
 * The build/lint steps run through this repo's own tooling
 * (scripts/build-plugin.mjs, `lint:marketplace`), which resolve the plugin
 * under <REPO_ROOT>/plugins/<slug>. In the normal clone layout that is the
 * same tree as --plugin-dir; the sandbox copy is a byte-identical copy of it
 * (minus the exclude list), so the receipt's hash binds the synced tree.
 *
 * Steps run in order; the gate ABORTS non-zero on the first HARD failure and
 * writes NO receipt (no receipt ⇒ no submission):
 *
 *   1. build        — node scripts/build-plugin.mjs <slug>            HARD
 *   2. lint         — lint:marketplace --plugin <slug> (from root)     HARD
 *   3. typecheck    — tsc --noEmit in <plugin>/view-tool/ (its lint)   HARD
 *   4. tests        — vitest in <plugin>/ AND <plugin>/view-tool/      HARD
 *   5. validate     — claude plugin validate <plugin-dir>             HARD when
 *                     the `claude` binary is on PATH, else recorded skipped
 *   6. render       — test-harness render per view_tools[].name.      SOFT:
 *                     genuine inability to obtain Chromium ⇒ "skipped";
 *                     a real render error (console errors / crash) ⇒ HARD
 *   7. receipt      — write validation-receipt.json to the session dir
 *
 * On any HARD failure the script prints a single-line JSON diagnostic to
 * stdout — `{"ok":false,"failed_stage":"<stage>","detail":"..."}` — that the
 * stage-7 build loop parses to re-dispatch the owning specialist, then
 * exits 1. On success it prints `{"ok":true,...,"receipt_path":"..."}`.
 *
 * Exit codes:
 *   0 — every HARD step passed; receipt written
 *   1 — a HARD step failed (or bad args); no receipt
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

// The tree-hash exclude lists. These MUST stay byte-for-byte in sync with the
// stage-12 submit program's EXCLUDE_DIRS / EXCLUDE_NAMES
// (skills/build/references/12-submit.md) — the receipt's tree_sha256 has to
// match the marker's tree_sha256 over the same tree. `validation-receipt.json`
// is added to EXCLUDE_NAMES belt-and-suspenders (it lives in SESSION_DIR,
// already outside PLUGIN_DIR, but a future session-dir==plugin-dir layout must
// never let the receipt hash itself).
export const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", ".omc", "mcp-server", "hooks", "host-renderer",
  "test-harness", "agents",
]);
export const EXCLUDE_NAMES = new Set([
  "SUBMISSION.json", "SUBMISSION.json.tmp", ".DS_Store", ".mcp.json",
  "validation-receipt.json", "validation-receipt.json.tmp",
]);

const RECEIPT_SCHEMA_VERSION = "1.0.0";

/**
 * Walk a plugin tree, returning absolute paths of every kept file. Same
 * algorithm as the stage-12 submit program: skip EXCLUDE_DIRS at every level,
 * skip EXCLUDE_NAMES files.
 */
export function walkTree(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name)) walkTree(join(dir, e.name), acc);
    } else if (e.isFile() && !EXCLUDE_NAMES.has(e.name)) {
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

/**
 * Compute tree_sha256 over a plugin tree, byte-identical to the stage-12
 * submit program: each kept file → `${slug}/${relativePath}` keyed sha256,
 * sorted by path.localeCompare, hashed as `path\tsha256` lines joined by \n.
 * `slug` is the marker SLUG (e.g. agntux-gmail) so the path prefixes match.
 */
export function computeTreeSha256(pluginDir, slug) {
  const files = walkTree(pluginDir)
    .map((abs) => {
      const buf = readFileSync(abs);
      return {
        path: `${slug}/${relative(pluginDir, abs)}`,
        sha256: createHash("sha256").update(buf).digest("hex"),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  return createHash("sha256")
    .update(files.map((f) => `${f.path}\t${f.sha256}`).join("\n"))
    .digest("hex");
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const out = { _: [], pluginDir: undefined, sessionDir: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--plugin-dir") out.pluginDir = args[++i];
    else if (a.startsWith("--plugin-dir=")) out.pluginDir = a.slice("--plugin-dir=".length);
    else if (a === "--session-dir") out.sessionDir = args[++i];
    else if (a.startsWith("--session-dir=")) out.sessionDir = a.slice("--session-dir=".length);
    else if (a.startsWith("--")) fail("usage", `Unknown flag: ${a}`);
    else out._.push(a);
  }
  return out;
}

function log(msg) {
  console.error(`validate-plugin: ${msg}`);
}

/** HARD failure: print the machine-readable diagnostic + exit 1, no receipt. */
function fail(stage, detail) {
  console.log(JSON.stringify({ ok: false, failed_stage: stage, detail }));
  console.error(`validate-plugin: [${stage}] ${detail}`);
  process.exit(1);
}

/** Run a command, streaming output. Returns { status, stdout, stderr }. */
function run(cmd, args, cwd, { capture = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  return {
    status: r.status,
    signal: r.signal,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function hasScript(pkgPath, name) {
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return Boolean(pkg.scripts && pkg.scripts[name]);
  } catch {
    return false;
  }
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const slug = argv._[0];
  if (!slug) {
    fail("usage", "usage: node scripts/validate-plugin.mjs <slug> [--plugin-dir <abs> --session-dir <abs>]");
  }

  const canonicalPluginDir = join(REPO_ROOT, "plugins", slug);
  const pluginDir = argv.pluginDir ? resolve(argv.pluginDir) : canonicalPluginDir;
  const sessionDir = argv.sessionDir ? resolve(argv.sessionDir) : dirname(pluginDir);

  // The build (build-plugin.mjs) and lint (lint:marketplace) steps resolve the
  // plugin from <REPO_ROOT>/plugins/<slug> and cannot target an arbitrary tree.
  // If --plugin-dir points elsewhere, hashing it would bind a tree the gate
  // never built or linted — silently validating the wrong bytes. Refuse that:
  // validate the working tree, and use --session-dir to redirect the receipt
  // (the synced copy is byte-identical on hashed files, so the tree_sha256
  // matches the marker program's hash regardless — see 12-submit.md §b.5).
  if (pluginDir !== canonicalPluginDir) {
    fail(
      "usage",
      `--plugin-dir (${pluginDir}) must equal ${canonicalPluginDir}: the build + lint ` +
        `steps can only target <repo>/plugins/<slug>, so a divergent --plugin-dir would hash ` +
        `a tree they never validated. Validate the working tree and pass only --session-dir ` +
        `to place the receipt next to the marker.`,
    );
  }

  if (!existsSync(pluginDir)) {
    fail("usage", `plugin dir not found: ${pluginDir} (build/scaffold it first)`);
  }

  log(`validating ${slug}`);
  log(`  plugin-dir:  ${pluginDir}`);
  log(`  session-dir: ${sessionDir}`);

  const viewToolDir = join(pluginDir, "view-tool");
  const hasViewTool = existsSync(viewToolDir);

  // ── 1. build (HARD) ───────────────────────────────────────────────────────
  // The single source of truth for building. Compiles view-tool/ (vite → tsc
  // → esbuild → emit-manifest) and re-renders the sync skill from canonical.
  log("[1/6] build (build-plugin.mjs)");
  {
    const r = run("node", [join(REPO_ROOT, "scripts", "build-plugin.mjs"), slug], REPO_ROOT);
    if (r.status !== 0) {
      fail("build", `build-plugin.mjs exited ${r.status} for ${slug}`);
    }
  }

  // ── 2. lint (HARD) ────────────────────────────────────────────────────────
  // lint:marketplace lives ONLY in the repo-root package.json — invoke from
  // REPO_ROOT, never from inside plugins/{slug}/.
  log("[2/6] lint (lint:marketplace --plugin)");
  {
    const r = run("npm", ["run", "lint:marketplace", "--", "--plugin", slug], REPO_ROOT, {
      capture: true,
    });
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    if (r.status !== 0) {
      // Surface the lint codes so the stage-7 loop can route E05/E11/E04/E14 →
      // manifest-author vs pass-8/E15 → ingest-prompt-author.
      const codes = (r.stdout + r.stderr).match(/\bE\d{2}\b/g) || [];
      fail("lint", `lint:marketplace failed for ${slug}${codes.length ? ` (codes: ${[...new Set(codes)].join(",")})` : ""}`);
    }
  }

  // ── 3. view-tool typecheck (HARD) ─────────────────────────────────────────
  // The view-tool's own `lint` script is `tsc --noEmit`. build-plugin.mjs runs
  // the full build (which includes tsc -p), but a standalone typecheck here is
  // the explicit gate and catches type drift independent of the bundler step.
  if (hasViewTool && hasScript(join(viewToolDir, "package.json"), "lint")) {
    log("[3/6] view-tool typecheck (tsc --noEmit)");
    const r = run("npm", ["run", "lint"], viewToolDir);
    if (r.status !== 0) {
      fail("typecheck", `view-tool tsc --noEmit failed for ${slug}`);
    }
  } else {
    log("[3/6] view-tool typecheck — no view-tool/ lint script; skipping");
  }

  // ── 4. tests (HARD) ───────────────────────────────────────────────────────
  // The plugin-root vitest.config globs only __tests__/**, so the view-tool
  // suite (view-tool/__tests__ + view-tool/src/**) must be run separately.
  // --passWithNoTests so a plugin that ships no view-tool tests doesn't hard
  // fail on "No test files found".
  log("[4/6] tests (vitest: plugin-root + view-tool)");
  {
    if (hasScript(join(pluginDir, "package.json"), "test")) {
      // No --passWithNoTests here: a plugin that declares a `test` script is
      // expected to ship tests (cold-start at minimum). A misconfigured glob
      // that matches nothing must NOT pass green — that is exactly the "broken
      // plugin sails through" class this gate exists to stop.
      const r = run("npx", ["vitest", "run"], pluginDir);
      if (r.status !== 0) fail("tests", `plugin-root vitest failed for ${slug}`);
    } else {
      log("       plugin-root has no test script; skipping plugin-root suite");
    }
    if (hasViewTool) {
      const r = run("npx", ["vitest", "run", "--passWithNoTests"], viewToolDir);
      if (r.status !== 0) fail("tests", `view-tool vitest failed for ${slug}`);
    }
  }

  // ── 5. structural validate (HARD when `claude` is present) ────────────────
  // The doc-recommended pre-submit structural check. A genuine absence of the
  // `claude` binary is an environment limitation (CI sandboxes), not a plugin
  // defect — record it as skipped rather than blocking, mirroring render's
  // soft-skip discipline. When the binary IS present, a non-zero exit is a
  // real structural problem and hard-blocks.
  log("[5/6] structural validate (claude plugin validate)");
  let pluginValidate = "skipped";
  {
    // Probe the SUBCOMMAND, not just the binary: `claude --version` can succeed
    // on a build that doesn't implement `plugin validate`, which would turn a
    // CLI-capability gap into a false hard-block. `plugin validate --help`
    // exiting 0 means the subcommand exists and accepts a target.
    const probe = run("claude", ["plugin", "validate", "--help"], REPO_ROOT, { capture: true });
    if (probe.status === 0) {
      const r = run("claude", ["plugin", "validate", pluginDir], REPO_ROOT, { capture: true });
      process.stdout.write(r.stdout);
      process.stderr.write(r.stderr);
      if (r.status !== 0) {
        fail("validate", `claude plugin validate failed for ${pluginDir}`);
      }
      pluginValidate = "pass";
    } else {
      log("       `claude plugin validate` unavailable on this host — recording validate:skipped");
    }
  }

  // ── 6. render (SOFT — best-effort) ────────────────────────────────────────
  // Best-effort by the user's decision: a genuine inability to obtain Chromium
  // downgrades render to "skipped"; a real render error (console errors or a
  // harness crash) hard-blocks. Content-check failures alone (e.g. empty-args
  // degraded states) do NOT block — they're not the bug class this gate
  // protects (the gate protects against console errors / CSP violations /
  // crashes that escaped to the worker).
  log("[6/6] render (test-harness, best-effort)");
  const render = hasViewTool
    ? runRenderGate(slug, pluginDir)
    : "skipped";

  // ── 7. receipt ────────────────────────────────────────────────────────────
  const treeSha = computeTreeSha256(pluginDir, slug);
  const agntuxBuildVersion = readAgntuxBuildVersion();
  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    slug,
    tree_sha256: treeSha,
    build: "pass",
    lint: "pass",
    typecheck: hasViewTool && hasScript(join(viewToolDir, "package.json"), "lint") ? "pass" : "skipped",
    tests: "pass",
    validate: pluginValidate,
    render,
    agntux_build_version: agntuxBuildVersion,
    validated_at: new Date().toISOString(),
  };

  mkdirSync(sessionDir, { recursive: true });
  const receiptPath = join(sessionDir, "validation-receipt.json");
  const tmp = `${receiptPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(receipt, null, 2));
  renameSync(tmp, receiptPath);

  log(`receipt written → ${receiptPath}`);
  console.log(
    JSON.stringify({
      ok: true,
      slug,
      tree_sha256: treeSha,
      render,
      validate: pluginValidate,
      receipt_path: receiptPath,
    }),
  );
  process.exit(0);
}

/**
 * Run the headless render harness once per view_tools[].name and decide the
 * SOFT render verdict. Returns "pass" | "skipped"; HARD-fails (no return) on a
 * real render error.
 */
function runRenderGate(slug, pluginDir) {
  const manifestPath = join(pluginDir, "view-tool", "dist", "view-tools.manifest.json");
  if (!existsSync(manifestPath)) {
    // build step already passed, so a missing manifest would be surprising;
    // treat as nothing to render rather than blocking.
    log("       no view-tools.manifest.json — nothing to render; skipping");
    return "skipped";
  }
  let toolNames;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    toolNames = (manifest.view_tools || []).map((t) => t.name).filter(Boolean);
  } catch (e) {
    log(`       could not parse view-tools.manifest.json (${e.message}); skipping render`);
    return "skipped";
  }
  if (toolNames.length === 0) {
    log("       manifest declares no view_tools; skipping render");
    return "skipped";
  }

  const harness = join(REPO_ROOT, "plugins", "agntux-build", "test-harness", "bin", "cli.mjs");
  const hostRenderer = join(REPO_ROOT, "plugins", "agntux-build", "host-renderer");
  if (!existsSync(harness)) {
    log("       agntux-build test-harness not found; skipping render");
    return "skipped";
  }

  // probe-chromium: { installed: bool }. Exit 0 = installed.
  const probe = run("node", [harness, "probe-chromium"], REPO_ROOT, { capture: true });
  let installed = probe.status === 0;
  if (!installed) {
    log("       Chromium not installed — attempting one-time playwright install");
    const inst = run("npx", ["--prefix", hostRenderer, "playwright", "install", "chromium"], REPO_ROOT, {
      capture: true,
    });
    if (inst.status !== 0) {
      log("       could not obtain Chromium (offline/disk/permissions) — render:skipped (soft)");
      return "skipped";
    }
    installed = true;
  }

  // Render artifacts (screenshot + metadata) go to a temp dir, never into the
  // repo / plugin tree — the harness default is ./test-results, which would
  // pollute REPO_ROOT and perturb a dev's git status.
  const renderOut = join(tmpdir(), "agntux-validate-render", slug);
  mkdirSync(renderOut, { recursive: true });

  for (const tool of toolNames) {
    const r = run(
      "node",
      [harness, "render", "--plugin", pluginDir, "--tool", tool, "--out", renderOut],
      REPO_ROOT,
      { capture: true },
    );
    const out = `${r.stdout}\n${r.stderr}`;
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    // The harness summary line carries `consoleErrors=<n>` and `state=<state>`.
    const ceMatch = out.match(/consoleErrors=(\d+)/);
    const consoleErrors = ceMatch ? Number(ceMatch[1]) : null;
    if (consoleErrors !== null && consoleErrors > 0) {
      fail("render", `view tool ${tool} rendered with ${consoleErrors} console error(s)`);
    }
    // A handler-thrown `tool error:` is a real render error (the protected bug
    // class), distinct from content-check failures — hard-block it even when
    // consoleErrors=0.
    if (/^tool error:/m.test(out)) {
      const te = (out.match(/^tool error: .*/m) || ["tool error"])[0];
      fail("render", `view tool ${tool}: ${te.slice(0, 200)}`);
    }
    // No parseable summary AND a non-zero exit ⇒ the harness itself crashed
    // (bad bundle, dynamic import failure) — that IS a render error.
    if (consoleErrors === null && r.status !== 0) {
      const reason = (out.match(/render failed: .*/) || ["harness crashed"])[0];
      fail("render", `view tool ${tool}: ${reason.slice(0, 200)}`);
    }
    // consoleErrors===0 with content-check fails (exit 1) ⇒ soft pass: the
    // gate protects against console errors / crashes / handler errors, not
    // empty-args degraded states.
  }
  return "pass";
}

function readAgntuxBuildVersion() {
  // Prefer the running plugin context; fall back to the tracked plugin.json.
  const candidates = [
    process.env.CLAUDE_PLUGIN_ROOT
      ? join(process.env.CLAUDE_PLUGIN_ROOT, ".claude-plugin", "plugin.json")
      : null,
    join(REPO_ROOT, "plugins", "agntux-build", ".claude-plugin", "plugin.json"),
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf8")).version;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

// Run the CLI only when invoked directly — keeps the helpers importable from
// tests without triggering a full validation run.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
