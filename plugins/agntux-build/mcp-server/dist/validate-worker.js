#!/usr/bin/env node
// =============================================================================
// validate-worker.js — runs runValidation() in a CHILD process so the agntux-
// build MCP server's event loop stays free to answer `ping` keepalives (and
// emit progress) during the multi-minute build→lint→typecheck→tests→validate→
// render pipeline. The in-process path used to block on synchronous spawnSync
// (bin/validate-plugin.mjs `run()`), starving the keepalive, so Claude Cowork
// closed the stdio connection with `-32000`. Spawned by index.js's
// validateInWorker().
//
// Contract: NEVER throws. ALWAYS writes the FULL runValidation verdict (the
// rich shape the agntux-build skill consumes — NOT the slim CLI `main()`
// output) to `--out` atomically (temp + rename), then exits 0. On internal
// crash it writes an internal-error verdict shape-compatible with
// runValidation's own.
//
// argv: validate-worker.js <slug> --plugin-dir <abs> [--session-dir <abs>] --out <abs>
//
// The relative import below resolves to plugins/agntux-build/bin/validate-
// plugin.mjs identically whether this file runs from src/ (dev) or dist/ (the
// host launches dist/index.js, which spawns dist/validate-worker.js) — both are
// one level under mcp-server/, mirroring index.js's VALIDATE_MJS.
// =============================================================================

import process from "node:process";
import { writeFileSync, renameSync } from "node:fs";
import { runValidation } from "../../bin/validate-plugin.mjs";

const errStr = (e) => String((e && e.message) || (e && e.code) || e);

function parseArgs(argv) {
  const o = { slug: undefined, pluginDir: undefined, sessionDir: undefined, outPath: undefined };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plugin-dir") o.pluginDir = argv[++i];
    else if (a === "--session-dir") o.sessionDir = argv[++i];
    else if (a === "--out") o.outPath = argv[++i];
    else rest.push(a);
  }
  o.slug = rest[0];
  return o;
}

function writeVerdict(outPath, verdict) {
  const tmp = `${outPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(verdict));
  renameSync(tmp, outPath);
}

// Shape-compatible with runValidation's own internal-error verdict so the
// parent (and the consuming agent) see a uniform structure on any failure.
function internalVerdict(args, detail) {
  return {
    ok: false,
    slug: args.slug ?? null,
    plugin_dir: args.pluginDir ?? null,
    session_dir: args.sessionDir ?? null,
    stages: {},
    stage_results: [],
    failed_stage: "internal",
    blocking: false,
    routing: null,
    error_kind: "internal",
    detail,
    summary:
      "Validation hit an internal error and could not complete; this is a toolchain issue, not a plugin defect.",
    next_action:
      "Stop honestly and call agntux_report_defect; do not re-dispatch a specialist.",
    validated_at: new Date().toISOString(),
  };
}

const args = parseArgs(process.argv.slice(2));

(async () => {
  if (!args.outPath) {
    // No result channel — nothing the parent can read. Fail loud on stderr only.
    process.stderr.write("[validate-worker] missing required --out <path>\n");
    process.exit(2);
  }

  // TEST-ONLY hook (never set in production): keep a validate deterministically
  // "in flight" so the responsiveness regression test can interleave a ping
  // without a real multi-minute build.
  const delayMs = Number(process.env.AGNTUX_VALIDATE_WORKER_TEST_DELAY_MS);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  let verdict;
  try {
    verdict = await runValidation({
      slug: args.slug,
      pluginDir: args.pluginDir,
      sessionDir: args.sessionDir,
      // The parent's ensureBrowser() owns the detached Chromium install + the
      // managed PLAYWRIGHT_BROWSERS_PATH; the worker must never inline-install.
      installBrowser: false,
    });
  } catch (e) {
    verdict = internalVerdict(args, `validation worker crashed: ${errStr(e)}`);
  }

  try {
    writeVerdict(args.outPath, verdict);
  } catch (e) {
    // Last-ditch: try to write an internal-error verdict so the parent doesn't
    // read a stale/absent file. If even this throws, the parent's read-miss
    // path synthesizes its own internal verdict.
    try {
      writeVerdict(args.outPath, internalVerdict(args, `could not write verdict: ${errStr(e)}`));
    } catch {
      /* parent handles the read miss */
    }
  }
  process.exit(0);
})();
