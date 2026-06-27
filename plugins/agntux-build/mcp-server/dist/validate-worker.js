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
// Contract: emit a structured verdict to `--out` on EVERY survivable exit path.
// The happy path writes the FULL runValidation verdict (the rich shape the
// agntux-build skill consumes — NOT the slim CLI `main()` output) atomically
// (temp + rename), then exits 0. Defense-in-depth for the failure paths:
//   1. a breadcrumb verdict is written BEFORE the pipeline runs, so a crash that
//      produces nothing else still leaves a readable "started but did not
//      complete" file instead of a bare ENOENT for the parent;
//   2. the toolchain import is DYNAMIC + try-wrapped, so a module-load failure
//      becomes a verdict;
//   3. process-level uncaughtException/unhandledRejection guards write a verdict
//      for JS-level faults that escape the try.
// What this CANNOT catch: a native abort (e.g. an Electron-as-node V8/Node
// assertion — `node::MaybeStackBuffer ... (length+1) <= capacity()`), which
// terminates the process with a signal and bypasses ALL JS handling. For that
// case the breadcrumb (1) plus the PARENT's exit-code/signal/stderr-tail capture
// (index.js validateInWorker) is what surfaces the real cause.
//
// argv: validate-worker.js <slug> --plugin-dir <abs> [--session-dir <abs>] --out <abs>
//
// The relative import below resolves to plugins/agntux-build/bin/validate-
// plugin.mjs identically whether this file runs from src/ (dev) or dist/ (the
// host launches dist/index.js, which spawns dist/validate-worker.js) — both are
// one level under mcp-server/, mirroring index.js's VALIDATE_MJS.
// =============================================================================

import process from "node:process";
import { writeFileSync, renameSync, writeSync } from "node:fs";

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

// Never-throwing verdict writer used by every failure path, including the
// process-level guards below.
function safeWriteVerdict(detail) {
  try {
    if (args.outPath) writeVerdict(args.outPath, internalVerdict(args, detail));
  } catch {
    /* parent's read-miss / signal-capture path synthesizes its own verdict */
  }
}

// JS-level last-resort guards: a thrown error or rejected promise that escapes
// the try below would otherwise kill the worker with no verdict. These do NOT
// fire for a native abort (a signal) — surfacing that is the parent's job.
process.on("uncaughtException", (e) => {
  safeWriteVerdict(`validation worker uncaught exception: ${errStr(e)}`);
  process.exit(0);
});
process.on("unhandledRejection", (e) => {
  safeWriteVerdict(`validation worker unhandled rejection: ${errStr(e)}`);
  process.exit(0);
});

(async () => {
  if (!args.outPath) {
    // No result channel — nothing the parent can read. Fail loud on stderr only.
    process.stderr.write("[validate-worker] missing required --out <path>\n");
    process.exit(2);
  }

  // Breadcrumb: a verdict written BEFORE the pipeline runs, so there is always a
  // readable file on disk. On a signal / non-clean exit the PARENT
  // authoritatively synthesizes the crash verdict from the captured exit
  // code/signal/output (it does NOT rely on this file); the breadcrumb's residual
  // value is the edge case of a clean exit (code 0) that nonetheless wrote
  // nothing. Overwritten by the real verdict below on any survivable outcome.
  safeWriteVerdict(
    "validation worker started but did not complete — the process exited before producing a verdict; see the worker output tail captured by the server.",
  );

  // ── TEST-ONLY hooks (never set in production) ────────────────────────────────
  // Deterministically keep a validate "in flight" so the responsiveness test can
  // interleave a ping without a real multi-minute build.
  const delayMs = Number(process.env.AGNTUX_VALIDATE_WORKER_TEST_DELAY_MS);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }
  // Simulate an uncatchable signal-kill (the native-abort failure class) so the
  // PARENT's crash-report path can be asserted without a real native crash. Runs
  // AFTER the breadcrumb to prove the breadcrumb doesn't mask the signal in the
  // parent's report. We emit a head sentinel + filler exceeding the parent's tail
  // cap + the marker LAST, then kill: this also exercises the parent KEEPING the
  // END of the stream (where a real crash stack prints) while truncating the
  // head. A child's piped stderr is NON-BLOCKING on Linux, so a bare writeSync of
  // the >8 KB filler partial-writes / throws EAGAIN and silently drops the bytes
  // written LAST (the marker) — the exact CI flake this hook produced (green on
  // macOS's blocking pipes, red on Linux). writeAllSync loops on the returned
  // byte count and retries EAGAIN so every byte lands in the pipe buffer before
  // the kill. SIGKILL (not SIGABRT) is deliberate — equally uncatchable and
  // equally yields close(signal=…), but emits NO OS crash report / core dump on
  // every test run.
  if (process.env.AGNTUX_VALIDATE_WORKER_TEST_ABORT) {
    const writeAllSync = (fd, str) => {
      let buf = Buffer.from(str);
      while (buf.length) {
        let n = 0;
        try {
          n = writeSync(fd, buf);
        } catch (e) {
          if (e && e.code === "EAGAIN") continue; // pipe full; the parent is draining — retry
          break; // any other error: best-effort, give up
        }
        buf = buf.subarray(n);
      }
    };
    writeAllSync(2, "AGNTUX_VALIDATE_WORKER_TEST_HEAD_SENTINEL\n");
    writeAllSync(2, `${"x".repeat(12000)}\n`);
    writeAllSync(2, "AGNTUX_VALIDATE_WORKER_TEST_ABORT_MARKER\n");
    process.kill(process.pid, "SIGKILL");
    await new Promise(() => {}); // never resolves; the signal terminates us
  }
  // Simulate a JS-level fault that escapes to the unhandledRejection guard.
  if (process.env.AGNTUX_VALIDATE_WORKER_TEST_THROW) {
    throw new Error("AGNTUX_VALIDATE_WORKER_TEST_THROW_MARKER");
  }

  let verdict;
  try {
    // Dynamic (not static top-level) import so a module-load failure is caught
    // and turned into a verdict instead of a silent module-init crash.
    const { runValidation } = await import("../../bin/validate-plugin.mjs");
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
    // read the stale breadcrumb. If even this throws, the parent's read /
    // signal-capture path synthesizes its own internal verdict.
    try {
      writeVerdict(args.outPath, internalVerdict(args, `could not write verdict: ${errStr(e)}`));
    } catch {
      /* parent handles the read miss */
    }
  }
  process.exit(0);
})();
