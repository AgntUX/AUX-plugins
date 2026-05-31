#!/usr/bin/env node
/**
 * bootstrap-worker.js — detached, standalone renderer bootstrap.
 *
 * Spawned (detached, unref'd) by the MCP server's ensureBrowser() on first use,
 * so a tool call NEVER blocks on the ~1-2 min one-time install. It:
 *   1. `npm install` in the host-renderer dir (express, cors, playwright,
 *      @modelcontextprotocol/sdk, @agntux/plugin-runtime, …) with the browser
 *      download skipped (we place it in the managed dir explicitly in step 2).
 *   2. `playwright install chromium` into the managed PLAYWRIGHT_BROWSERS_PATH.
 *
 * Installs `chromium-headless-shell` (the headless-only binary, ~190 MB incl
 * ffmpeg vs ~533 MB for full chromium+ffmpeg). Verified end-to-end in a
 * clean-room: a shell-only install renders the gmail view-tool with
 * consoleErrors=0, and the functional probe-chromium (a real headless launch)
 * detects it correctly. No launch-channel change is needed — a plain
 * `chromium.launch({headless:true})` resolves to the shell when it's the only
 * binary present.
 *
 * Pure Node built-ins only. NEVER throws uncaught — every step is wrapped; on
 * error it records phase:"error", ok:false and still flushes progress. Human
 * lines go to stderr (the detached parent points stdio at a log file).
 *
 * Invocation: node bootstrap-worker.js <hostRendererDir> <managedBrowsersDir> <progressFile>
 */

import {
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Synchronous sleep for the detached worker (pure built-ins, no async). Used to
 * back off between Chromium-download retries. SharedArrayBuffer is available in
 * Node 20+; if it ever isn't, skip the backoff rather than throw.
 */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* no backoff available — proceed immediately */
  }
}

/**
 * Are the host-renderer deps already installed? Cheap proxy: the playwright CLI
 * is the load-bearing one (STEP 2 invokes it), so its presence means a prior
 * STEP 1 succeeded and we can skip re-running `npm install` on a retry.
 */
function hostRendererDepsReady(dir) {
  return (
    existsSync(path.join(dir, "node_modules", "playwright", "cli.js")) ||
    existsSync(path.join(dir, "node_modules", ".bin", "playwright"))
  );
}

/**
 * Is a chromium-headless-shell already laid down in the managed browsers dir?
 * Playwright lays browsers out as `chromium_headless_shell-<rev>/`. This is both
 * the retry skip-check AND the restricted-network pre-seed escape hatch: an
 * installer on a locked-down network can drop the binary here once and the
 * worker skips the CDN download entirely. (Launchability is re-checked
 * functionally by the validate render gate's `probe-chromium` before it
 * renders, so a dir-name match is a safe "skip the download" signal.)
 */
function chromiumHeadlessShellPresent(managedDir) {
  try {
    return readdirSync(managedDir).some((n) =>
      /chromium[-_]headless[-_]shell/i.test(n),
    );
  } catch {
    return false;
  }
}

function log(...a) {
  try {
    process.stderr.write("[bootstrap-worker] " + a.join(" ") + "\n");
  } catch {
    /* ignore */
  }
}
function nowIso() {
  return new Date().toISOString();
}
function errStr(e) {
  return String((e && e.message) || (e && e.code) || e);
}
function tail(s, n) {
  try {
    const str = String(s ?? "");
    return str.length > n ? str.slice(str.length - n) : str;
  } catch {
    return "";
  }
}

const hostRendererDir = process.argv[2];
const managedBrowsers = process.argv[3];
const progressFile = process.argv[4];

if (!hostRendererDir || !managedBrowsers || !progressFile) {
  log("usage: bootstrap-worker.js <hostRendererDir> <managedBrowsersDir> <progressFile>");
  process.exit(2);
}

const t0 = Date.now();
const progress = {
  phase: "starting",
  startedAt: nowIso(),
  updatedAt: nowIso(),
  ok: false,
  done: false,
  npmInstall: { ok: false, ms: 0, error: null, stderrTail: "", skipped: false },
  browserInstall: { ok: false, ms: 0, error: null, stderrTail: "", attempts: 0, skipped: false },
  totalMs: 0,
  error: null,
};

function flush() {
  try {
    progress.updatedAt = nowIso();
    progress.totalMs = Date.now() - t0;
    const tmp = progressFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(progress, null, 2));
    renameSync(tmp, progressFile);
  } catch (e) {
    log("flush failed:", errStr(e));
  }
}

function main() {
  log("start; node", process.version, "pid", process.pid);
  log("hostRendererDir", hostRendererDir);
  log("managedBrowsers", managedBrowsers);

  try {
    mkdirSync(managedBrowsers, { recursive: true });
  } catch (e) {
    progress.phase = "error";
    progress.error = "mkdir managed dir: " + errStr(e);
    progress.done = true;
    flush();
    return;
  }

  // STEP 1: install host-renderer deps (browser download skipped; placed in
  // the managed dir explicitly in step 2). Skipped on a retry when the deps are
  // already present, so a retry only redoes the missing piece (the browser).
  progress.phase = "npm-install";
  flush();
  if (hostRendererDepsReady(hostRendererDir)) {
    progress.npmInstall.ok = true;
    progress.npmInstall.skipped = true;
    log("npm-install skipped — host-renderer deps already present");
  } else {
    const s = Date.now();
    const r = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: hostRendererDir,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: managedBrowsers,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      },
      timeout: 300000,
      encoding: "utf8",
    });
    progress.npmInstall.ms = Date.now() - s;
    progress.npmInstall.ok = r.status === 0;
    progress.npmInstall.stderrTail = tail(r.stderr, 1500);
    if (r.error) {
      // The host-spawned MCP server may run under a minimal PATH that lacks
      // npm; surface that distinctly so the operator can diagnose it (vs a
      // generic spawn failure).
      progress.npmInstall.error =
        r.error.code === "ENOENT"
          ? "npm not found on PATH — the host-spawned MCP server's PATH may not include npm"
          : errStr(r.error);
    } else if (r.status !== 0) {
      progress.npmInstall.error = "npm install exited with status " + r.status;
    }
    log("npm-install ok=" + progress.npmInstall.ok + " ms=" + progress.npmInstall.ms);
    if (!progress.npmInstall.ok) {
      progress.phase = "error";
      progress.error = "npm-install: " + (progress.npmInstall.error || "failed");
      progress.done = true;
      flush();
      return;
    }
  }
  flush();

  // STEP 2: install Chromium into the managed dir via the just-installed
  // playwright CLI. Pre-seed escape hatch: if a chromium-headless-shell is
  // already present (a prior run, or an installer dropped it on a locked-down
  // network), skip the download entirely. Otherwise the download is wrapped in a
  // bounded retry with incremental backoff — CDN downloads flake on restricted
  // networks, and a single transient failure must not abort the whole bootstrap
  // (forcing ensureBrowser to redo even the npm install).
  progress.phase = "browser-install";
  flush();
  if (chromiumHeadlessShellPresent(managedBrowsers)) {
    progress.browserInstall.ok = true;
    progress.browserInstall.skipped = true;
    log("browser-install skipped — chromium-headless-shell already present (pre-seed/cache)");
  } else {
    const cliJs = path.join(hostRendererDir, "node_modules", "playwright", "cli.js");
    const cliBin = path.join(hostRendererDir, "node_modules", ".bin", "playwright");
    let cmd;
    let args;
    if (existsSync(cliJs)) {
      cmd = process.execPath;
      args = [cliJs, "install", "chromium-headless-shell"];
    } else {
      cmd = cliBin;
      args = ["install", "chromium-headless-shell"];
    }
    const MAX_ATTEMPTS = 3;
    const s = Date.now();
    let ok = false;
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      const r = spawnSync(cmd, args, {
        cwd: hostRendererDir,
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: managedBrowsers },
        timeout: 600000,
        encoding: "utf8",
      });
      progress.browserInstall.attempts = attempt;
      progress.browserInstall.stderrTail = tail(r.stderr, 1500);
      if (r.error) lastError = errStr(r.error);
      else if (r.status !== 0) lastError = "browser install exited with status " + r.status;
      else lastError = null;
      ok = !r.error && r.status === 0;
      log(`browser-install attempt ${attempt}/${MAX_ATTEMPTS} ok=${ok}`);
      flush();
      if (!ok) {
        // A partial/failed download may still have laid down a launchable shell
        // (or a concurrent run finished it) — re-check before another attempt.
        if (chromiumHeadlessShellPresent(managedBrowsers)) {
          ok = true;
          break;
        }
        if (attempt < MAX_ATTEMPTS) {
          const backoffMs = attempt * 5000; // 5s, then 10s
          log(`browser-install backing off ${backoffMs}ms before retry`);
          sleepSync(backoffMs);
        }
      }
    }
    progress.browserInstall.ms = Date.now() - s;
    progress.browserInstall.ok = ok;
    if (!ok) progress.browserInstall.error = lastError || "failed";
    log("browser-install ok=" + ok + " attempts=" + progress.browserInstall.attempts + " ms=" + progress.browserInstall.ms);
    if (!ok) {
      progress.phase = "error";
      progress.error = "browser-install: " + (progress.browserInstall.error || "failed");
      progress.done = true;
      flush();
      return;
    }
  }
  flush();

  progress.phase = "done";
  progress.ok = true;
  progress.done = true;
  flush();
  log("done totalMs=" + progress.totalMs);
}

try {
  main();
} catch (e) {
  try {
    progress.phase = "error";
    progress.error = errStr(e);
    progress.ok = false;
    progress.done = true;
    flush();
    log("top-level catch:", errStr(e));
  } catch {
    /* nothing else we can do */
  }
}
