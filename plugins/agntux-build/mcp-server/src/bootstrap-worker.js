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
 * Full chromium (NOT chromium-headless-shell): the Phase-0 cold-bootstrap proof
 * used `playwright install chromium` + `chromium.launch({headless:true})` and
 * rendered successfully (mode default, no --no-sandbox). headless-shell would
 * shave the one-time download but needs probe-chromium + the launch channel
 * changed in lockstep, unverifiable without a live Playwright run — deferred as
 * a size follow-up; correctness first.
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
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
  npmInstall: { ok: false, ms: 0, error: null, stderrTail: "" },
  browserInstall: { ok: false, ms: 0, error: null, stderrTail: "" },
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
  // the managed dir explicitly in step 2).
  progress.phase = "npm-install";
  flush();
  {
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
  // playwright CLI.
  progress.phase = "browser-install";
  flush();
  {
    const cliJs = path.join(hostRendererDir, "node_modules", "playwright", "cli.js");
    const cliBin = path.join(hostRendererDir, "node_modules", ".bin", "playwright");
    let cmd;
    let args;
    if (existsSync(cliJs)) {
      cmd = process.execPath;
      args = [cliJs, "install", "chromium"];
    } else {
      cmd = cliBin;
      args = ["install", "chromium"];
    }
    const s = Date.now();
    const r = spawnSync(cmd, args, {
      cwd: hostRendererDir,
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: managedBrowsers },
      timeout: 600000,
      encoding: "utf8",
    });
    progress.browserInstall.ms = Date.now() - s;
    progress.browserInstall.ok = r.status === 0;
    progress.browserInstall.stderrTail = tail(r.stderr, 1500);
    if (r.error) progress.browserInstall.error = errStr(r.error);
    else if (r.status !== 0) progress.browserInstall.error = "browser install exited with status " + r.status;
    log("browser-install ok=" + progress.browserInstall.ok + " ms=" + progress.browserInstall.ms);
    if (!progress.browserInstall.ok) {
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
