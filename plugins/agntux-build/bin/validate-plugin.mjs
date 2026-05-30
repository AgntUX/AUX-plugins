#!/usr/bin/env node
/**
 * validate-plugin.mjs — the deterministic pre-submission validation gate.
 *
 * This is the single CODE gate that converts every pre-submit dimension
 * (build, lint, view-tool typecheck, tests, render, structural validate)
 * from prose-only — which a broken plugin can sail past — into enforced,
 * exit-code-disciplined steps.
 *
 * Two entry points:
 *
 *   - `runValidation({ slug, pluginDir, sessionDir, installBrowser })`
 *     (EXPORTED) runs the staged pipeline in-process and returns a structured
 *     VERDICT object. It NEVER calls process.exit and NEVER throws to its
 *     caller — every failure (plugin defect, environment limitation, usage
 *     error, internal error) is captured into the returned verdict. This is
 *     what the agntux-build MCP server (`mcp-server/`) calls so the build/
 *     validate/render work runs inside the server's capable native context
 *     (full fs, real Chromium) rather than the restricted Bash sandbox, and so
 *     the model gets an atomic, un-forgeable result instead of a prose program
 *     it can hand-emulate. See skills/build/references/12-submit.md and the
 *     "we-have-been-working-harmonic-frog" plan.
 *
 *   - the CLI (`node validate-plugin.mjs <slug> --plugin-dir <abs>`) wraps
 *     runValidation, prints the legacy single-line JSON contract, writes a
 *     `validation-receipt.json` record, and maps the verdict to an exit code.
 *     The receipt is a convenience RECORD only — the marker program (and the
 *     MCP server) re-run validation and trust the verdict, never an on-disk
 *     receipt (which is forgeable).
 *
 * The verdict's `tree_sha256` is computed with the EXACT same walk + exclude
 * lists the stage-12 submit program uses, so the marker's tree_sha256 matches
 * for THIS tree.
 *
 * Steps run in order; the pipeline STOPS on the first HARD failure:
 *
 *   1. build        — node build-plugin.mjs <slug> --plugin-dir          HARD
 *   2. lint         — marketplace linter --plugin-dir                    HARD
 *   3. typecheck    — tsc --noEmit in <plugin>/view-tool/                HARD
 *   4. tests        — vitest in <plugin>/ AND <plugin>/view-tool/        HARD
 *   5. validate     — claude plugin validate <plugin-dir>               HARD when
 *                     the `claude` binary is on PATH, else recorded skipped
 *   6. render       — test-harness render per view_tools[].name.        SOFT:
 *                     genuine inability to obtain Chromium ⇒ "skipped";
 *                     a real render error (console errors / crash) ⇒ HARD
 *
 * CLI exit codes:
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
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveToolchain } from "./toolchain-layout.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Resolve every toolchain artifact (build script, lint entry, packages,
// canonical templates, render harness) for the layout we're running under —
// maintainer clone OR contributor bundle. Single source of layout knowledge.
const tc = resolveToolchain(__dirname);

// The tree-hash exclude lists. These MUST stay byte-for-byte in sync with the
// stage-12 submit program's EXCLUDE_DIRS / EXCLUDE_NAMES
// (skills/build/references/12-submit.md) — the verdict's tree_sha256 has to
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

// ── verdict plumbing ─────────────────────────────────────────────────────────

/**
 * A stop sentinel a stage throws to abort the pipeline with a structured
 * outcome. runValidation catches it and folds it into the verdict — it never
 * escapes to the caller.
 *
 *   blocking:true  → a fixable PLUGIN defect (fix-and-retry via `routing`).
 *   blocking:false → an ENVIRONMENT / USAGE limitation (honest stop; no
 *                    specialist re-dispatch, no success claim).
 */
class ValidationStop extends Error {
  constructor({ stage, detail, blocking = true, routing = null, errorKind = "plugin" }) {
    super(detail);
    this.name = "ValidationStop";
    this.stage = stage;
    this.detail = detail;
    this.blocking = blocking;
    this.routing = routing;
    this.errorKind = errorKind;
  }
}

/**
 * Run the full validation pipeline in-process and return a structured verdict.
 * NEVER throws; NEVER calls process.exit. Shape:
 *
 *   {
 *     ok, slug, plugin_dir, session_dir,
 *     stages: { build, lint, typecheck, tests, validate, render },
 *     tree_sha256?,           // present only when ok:true
 *     failed_stage?, blocking?, routing?, error_kind?, detail?,  // when ok:false
 *     validated_at
 *   }
 *
 * Each stages.<name> is `{ status: "pass"|"skipped"|"fail", ...extra }`.
 *
 * @param {object}  opts
 * @param {string}  opts.slug             marker slug, e.g. agntux-gmail
 * @param {string}  opts.pluginDir        absolute path to the tree to validate
 * @param {string} [opts.sessionDir]      receipt dir (default: dirname(pluginDir))
 * @param {boolean}[opts.installBrowser]  when false, render never blocks on a
 *                                        browser install — absent browser ⇒
 *                                        render:skipped (the MCP server manages
 *                                        the browser bootstrap detached). When
 *                                        true (CLI default) render may run a
 *                                        one-time `playwright install`.
 */
export async function runValidation({
  slug,
  pluginDir,
  sessionDir,
  installBrowser = true,
} = {}) {
  const stages = {};
  const at = () => new Date().toISOString();

  try {
    if (!slug || typeof slug !== "string") {
      throw new ValidationStop({
        stage: "usage",
        detail: "slug is required",
        blocking: false,
        errorKind: "usage",
      });
    }
    if (!pluginDir) {
      throw new ValidationStop({
        stage: "usage",
        detail: "pluginDir is required",
        blocking: false,
        errorKind: "usage",
      });
    }
    pluginDir = resolve(pluginDir);
    sessionDir = sessionDir ? resolve(sessionDir) : dirname(pluginDir);
    if (!existsSync(pluginDir)) {
      throw new ValidationStop({
        stage: "usage",
        detail: `plugin dir not found: ${pluginDir} (build/scaffold it first)`,
        blocking: false,
        errorKind: "usage",
      });
    }

    log(`validating ${slug} (${tc.layout} layout)`);
    log(`  plugin-dir:  ${pluginDir}`);
    log(`  session-dir: ${sessionDir}`);

    const viewToolDir = join(pluginDir, "view-tool");
    const hasViewTool = existsSync(viewToolDir);

    // ── 1. build (HARD) ───────────────────────────────────────────────────────
    log("[1/6] build (build-plugin.mjs)");
    {
      const r = run("node", [tc.buildScript, slug, "--plugin-dir", pluginDir], tc.base, {
        env: { ...process.env, AGNTUX_PACKAGES_DIR: tc.packagesDir },
      });
      if (r.status !== 0) {
        throw new ValidationStop({
          stage: "build",
          detail: `build-plugin.mjs exited ${r.status} for ${slug}`,
          routing: "view-tool-builder",
        });
      }
      stages.build = { status: "pass" };
    }

    // ── 2. lint (HARD) ────────────────────────────────────────────────────────
    log("[2/6] lint (marketplace linter --plugin-dir)");
    {
      const lintArgs = [
        "--plugin", slug,
        "--plugin-dir", pluginDir,
        "--canonical-root", tc.canonicalRoot,
        "--apps-client-canonical-root", tc.appsClientCanonicalRoot,
        "--tmp-root", tc.tmpRoot,
      ];
      const r =
        tc.lintRunner === "tsx"
          ? run("npm", ["run", "lint:marketplace", "--", ...lintArgs], tc.base, { capture: true })
          : run("node", [tc.lintEntry, ...lintArgs], tc.base, { capture: true });
      process.stdout.write(r.stdout);
      process.stderr.write(r.stderr);
      if (r.status !== 0) {
        // Surface lint codes so the fix loop can route E05/E11/E04/E14 →
        // manifest-author, pass-8/E15 → ingest-prompt-author, BUILD-* →
        // view-tool-builder.
        const codes = (r.stdout + r.stderr).match(/\b(E\d{2}|BUILD-[A-Za-z-]+)\b/g) || [];
        const uniq = [...new Set(codes)];
        throw new ValidationStop({
          stage: "lint",
          detail: `marketplace lint failed for ${slug}${uniq.length ? ` (codes: ${uniq.join(",")})` : ""}`,
          routing: routeFromLintCodes(uniq),
        });
      }
      stages.lint = { status: "pass" };
    }

    // ── 3. view-tool typecheck (HARD) ─────────────────────────────────────────
    const hasTypecheck =
      hasViewTool && hasScript(join(viewToolDir, "package.json"), "lint");
    if (hasTypecheck) {
      log("[3/6] view-tool typecheck (tsc --noEmit)");
      const r = run("npm", ["run", "lint"], viewToolDir);
      if (r.status !== 0) {
        throw new ValidationStop({
          stage: "typecheck",
          detail: `view-tool tsc --noEmit failed for ${slug}`,
          routing: "view-tool-builder",
        });
      }
      stages.typecheck = { status: "pass" };
    } else {
      log("[3/6] view-tool typecheck — no view-tool/ lint script; skipping");
      stages.typecheck = { status: "skipped" };
    }

    // ── 4. tests (HARD) ───────────────────────────────────────────────────────
    log("[4/6] tests (vitest: plugin-root + view-tool)");
    {
      if (hasScript(join(pluginDir, "package.json"), "test")) {
        // No --passWithNoTests: a plugin that declares a `test` script is
        // expected to ship tests. A glob that matches nothing must NOT pass
        // green — exactly the "broken plugin sails through" class this stops.
        const r = run("npx", ["vitest", "run"], pluginDir);
        if (r.status !== 0) {
          throw new ValidationStop({
            stage: "tests",
            detail: `plugin-root vitest failed for ${slug}`,
            routing: "tests-author",
          });
        }
      } else {
        log("       plugin-root has no test script; skipping plugin-root suite");
      }
      if (hasViewTool) {
        const r = run("npx", ["vitest", "run", "--passWithNoTests"], viewToolDir);
        if (r.status !== 0) {
          throw new ValidationStop({
            stage: "tests",
            detail: `view-tool vitest failed for ${slug}`,
            routing: "tests-author",
          });
        }
      }
      stages.tests = { status: "pass" };
    }

    // ── 5. structural validate (HARD when `claude` is present) ─────────────────
    log("[5/6] structural validate (claude plugin validate)");
    {
      // Probe the SUBCOMMAND, not just the binary: `claude --version` can
      // succeed on a build that doesn't implement `plugin validate`.
      const probe = run("claude", ["plugin", "validate", "--help"], tc.base, { capture: true });
      if (probe.status === 0) {
        const r = run("claude", ["plugin", "validate", pluginDir], tc.base, { capture: true });
        process.stdout.write(r.stdout);
        process.stderr.write(r.stderr);
        if (r.status !== 0) {
          throw new ValidationStop({
            stage: "validate",
            detail: `claude plugin validate failed for ${pluginDir}`,
            routing: "manifest-author",
          });
        }
        stages.validate = { status: "pass" };
      } else {
        log("       `claude plugin validate` unavailable on this host — validate:skipped");
        stages.validate = { status: "skipped", reason: "claude_cli_unavailable" };
      }
    }

    // ── 6. render (SOFT — best-effort) ────────────────────────────────────────
    log("[6/6] render (test-harness, best-effort)");
    stages.render = hasViewTool
      ? runRenderGate(slug, pluginDir, { installBrowser })
      : { status: "skipped", reason: "no_view_tool" };

    // ── verdict ───────────────────────────────────────────────────────────────
    const treeSha = computeTreeSha256(pluginDir, slug);
    return {
      ok: true,
      slug,
      plugin_dir: pluginDir,
      session_dir: sessionDir,
      tree_sha256: treeSha,
      stages,
      validated_at: at(),
    };
  } catch (e) {
    if (e instanceof ValidationStop) {
      if (!stages[e.stage]) stages[e.stage] = { status: "fail", detail: e.detail };
      log(`[${e.stage}] ${e.detail}`);
      return {
        ok: false,
        slug: slug ?? null,
        plugin_dir: pluginDir ?? null,
        session_dir: sessionDir ?? null,
        stages,
        failed_stage: e.stage,
        blocking: e.blocking,
        routing: e.routing,
        error_kind: e.errorKind,
        detail: e.detail,
        validated_at: at(),
      };
    }
    // Unexpected internal error — never throw to the caller; report honestly.
    const detail = e && e.message ? e.message : String(e);
    log(`[internal] ${detail}`);
    return {
      ok: false,
      slug: slug ?? null,
      plugin_dir: pluginDir ?? null,
      session_dir: sessionDir ?? null,
      stages,
      failed_stage: "internal",
      blocking: false,
      routing: null,
      error_kind: "internal",
      detail,
      validated_at: at(),
    };
  }
}

/** Map lint codes to the owning specialist for the fix loop. */
function routeFromLintCodes(codes) {
  if (codes.some((c) => c.startsWith("BUILD-"))) return "view-tool-builder";
  // E15 is the skill-render-drift code (per the stage-7 dispatch table in
  // 07-build.md); everything else routes to the manifest author.
  if (codes.includes("E15")) return "ingest-prompt-author";
  return "manifest-author";
}

/**
 * Run the headless render harness once per view_tools[].name and decide the
 * SOFT render verdict. Returns `{ status: "pass"|"skipped", reason?,
 * browser_resolved? }`. Throws ValidationStop (blocking) on a real render error
 * (console errors / handler error / harness crash) — the protected bug class.
 *
 * @param {{installBrowser:boolean}} opts when installBrowser is false, an absent
 *   browser yields status:"skipped" rather than running a (slow, blocking)
 *   `playwright install`. The MCP server passes false and bootstraps the
 *   browser separately (detached) so a tool call never blocks ~1 min.
 */
function runRenderGate(slug, pluginDir, { installBrowser = true } = {}) {
  const manifestPath = join(pluginDir, "view-tool", "dist", "view-tools.manifest.json");
  if (!existsSync(manifestPath)) {
    log("       no view-tools.manifest.json — nothing to render; skipping");
    return { status: "skipped", reason: "no_manifest" };
  }
  let toolNames;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    toolNames = (manifest.view_tools || []).map((t) => t.name).filter(Boolean);
  } catch (e) {
    log(`       could not parse view-tools.manifest.json (${e.message}); skipping render`);
    return { status: "skipped", reason: "manifest_unparseable" };
  }
  if (toolNames.length === 0) {
    log("       manifest declares no view_tools; skipping render");
    return { status: "skipped", reason: "no_view_tools" };
  }

  const harness = tc.testHarnessCli;
  const hostRenderer = tc.hostRenderer;
  if (!existsSync(harness)) {
    log("       agntux-build test-harness not found; skipping render");
    return { status: "skipped", reason: "no_test_harness" };
  }

  // probe-chromium: exit 0 = a launchable Chromium resolves (respecting
  // PLAYWRIGHT_BROWSERS_PATH, which the MCP server points at its managed dir).
  const probe = run("node", [harness, "probe-chromium"], tc.base, { capture: true });
  let browserResolved = probe.status === 0 ? "cache" : "none";
  if (browserResolved === "none") {
    if (!installBrowser) {
      log("       no Chromium and installBrowser:false — render:skipped (browser bootstrapping elsewhere)");
      return { status: "skipped", reason: "browser_not_ready", browser_resolved: "none" };
    }
    log("       Chromium not installed — attempting one-time chromium-headless-shell install");
    const inst = run("npx", ["--prefix", hostRenderer, "playwright", "install", "chromium-headless-shell"], tc.base, {
      capture: true,
    });
    if (inst.status !== 0) {
      log("       could not obtain Chromium (offline/disk/permissions) — render:skipped (soft)");
      return { status: "skipped", reason: "browser_unobtainable", browser_resolved: "none" };
    }
    browserResolved = "installed";
  }

  // Render artifacts go to a temp dir, never into the repo / plugin tree.
  const renderOut = join(tmpdir(), "agntux-validate-render", slug);
  mkdirSync(renderOut, { recursive: true });

  const tools = [];
  for (const tool of toolNames) {
    const r = run(
      "node",
      [harness, "render", "--plugin", pluginDir, "--tool", tool, "--out", renderOut],
      tc.base,
      { capture: true },
    );
    const out = `${r.stdout}\n${r.stderr}`;
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    const ceMatch = out.match(/consoleErrors=(\d+)/);
    const consoleErrors = ceMatch ? Number(ceMatch[1]) : null;
    const stateMatch = out.match(/state=([a-z-]+)/);
    if (consoleErrors !== null && consoleErrors > 0) {
      throw new ValidationStop({
        stage: "render",
        detail: `view tool ${tool} rendered with ${consoleErrors} console error(s)`,
        routing: "view-tool-builder",
      });
    }
    if (/^tool error:/m.test(out)) {
      const te = (out.match(/^tool error: .*/m) || ["tool error"])[0];
      throw new ValidationStop({
        stage: "render",
        detail: `view tool ${tool}: ${te.slice(0, 200)}`,
        routing: "view-tool-builder",
      });
    }
    if (consoleErrors === null && r.status !== 0) {
      const reason = (out.match(/render failed: .*/) || ["harness crashed"])[0];
      throw new ValidationStop({
        stage: "render",
        detail: `view tool ${tool}: ${reason.slice(0, 200)}`,
        routing: "view-tool-builder",
      });
    }
    tools.push({
      name: tool,
      consoleErrors: consoleErrors ?? 0,
      state: stateMatch ? stateMatch[1] : null,
    });
  }
  return { status: "pass", browser_resolved: browserResolved, tools };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const out = { _: [], pluginDir: undefined, sessionDir: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--plugin-dir") out.pluginDir = args[++i];
    else if (a.startsWith("--plugin-dir=")) out.pluginDir = a.slice("--plugin-dir=".length);
    else if (a === "--session-dir") out.sessionDir = args[++i];
    else if (a.startsWith("--session-dir=")) out.sessionDir = a.slice("--session-dir=".length);
    else if (a.startsWith("--")) failCli("usage", `Unknown flag: ${a}`);
    else out._.push(a);
  }
  return out;
}

function log(msg) {
  console.error(`validate-plugin: ${msg}`);
}

/** CLI-only HARD failure: print the machine-readable diagnostic + exit 1. */
function failCli(stage, detail) {
  console.log(JSON.stringify({ ok: false, failed_stage: stage, detail }));
  console.error(`validate-plugin: [${stage}] ${detail}`);
  process.exit(1);
}

/** Run a command, streaming output. Returns { status, signal, stdout, stderr }. */
function run(cmd, args, cwd, { capture = false, env } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    ...(env ? { env } : {}),
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

function readAgntuxBuildVersion() {
  const candidates = [
    process.env.CLAUDE_PLUGIN_ROOT
      ? join(process.env.CLAUDE_PLUGIN_ROOT, ".claude-plugin", "plugin.json")
      : null,
    tc.layout === "bundle" ? join(tc.base, ".claude-plugin", "plugin.json") : null,
    join(tc.base, "plugins", "agntux-build", ".claude-plugin", "plugin.json"),
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

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const slug = argv._[0];
  if (!slug) {
    failCli("usage", "usage: node validate-plugin.mjs <slug> [--plugin-dir <abs> --session-dir <abs>]");
  }

  let pluginDir;
  if (argv.pluginDir) {
    pluginDir = resolve(argv.pluginDir);
  } else if (tc.pluginsDir) {
    pluginDir = join(tc.pluginsDir, slug);
  } else {
    failCli(
      "usage",
      "running from the agntux-build bundle (no marketplace clone): pass --plugin-dir <abs> " +
        "pointing at the build sandbox tree (…/.agntux-build/builds/{id}/agntux-{slug}/)",
    );
  }
  const sessionDir = argv.sessionDir ? resolve(argv.sessionDir) : dirname(pluginDir);

  // CLI runs natively (maintainer or in-bundle sandbox), so it may install a
  // browser inline for the render gate.
  const verdict = await runValidation({ slug, pluginDir, sessionDir, installBrowser: true });

  if (!verdict.ok) {
    // Preserve the legacy single-line failure contract the stage-7 loop parses.
    console.log(JSON.stringify({ ok: false, failed_stage: verdict.failed_stage, detail: verdict.detail }));
    console.error(`validate-plugin: [${verdict.failed_stage}] ${verdict.detail}`);
    process.exit(1);
  }

  // Success: write the convenience receipt RECORD (not trusted downstream) and
  // print the legacy single-line success contract.
  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    slug,
    tree_sha256: verdict.tree_sha256,
    build: verdict.stages.build?.status ?? "pass",
    lint: verdict.stages.lint?.status ?? "pass",
    typecheck: verdict.stages.typecheck?.status ?? "skipped",
    tests: verdict.stages.tests?.status ?? "pass",
    validate: verdict.stages.validate?.status ?? "skipped",
    render: verdict.stages.render?.status ?? "skipped",
    agntux_build_version: readAgntuxBuildVersion(),
    validated_at: verdict.validated_at,
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
      tree_sha256: verdict.tree_sha256,
      render: verdict.stages.render?.status ?? "skipped",
      validate: verdict.stages.validate?.status ?? "skipped",
      receipt_path: receiptPath,
    }),
  );
  process.exit(0);
}

// Run the CLI only when invoked directly — keeps runValidation + the hash
// helpers importable from the MCP server / tests without a full validation run.
// Resolve BOTH sides with realpathSync before comparing: Node realpath-resolves
// import.meta.url (symlinks followed — the Cowork plugin dir is a symlink, and
// /tmp→/private/tmp on macOS) while argv[1] is the raw invocation path, so a raw
// `import.meta.url === pathToFileURL(argv[1]).href` compare never matches under a
// symlinked/spaced path — the silent, restart-proof failure fixed in the MCP
// server's launch guard. NEVER URL.pathname (it %20-breaks on the space in the
// Cowork "Application Support" path).
function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(__filename) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
if (isMainModule()) {
  main();
}
