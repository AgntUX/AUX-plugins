#!/usr/bin/env node
/**
 * agntux-build MCP server — zero-dependency stdio JSON-RPC 2.0.
 *
 * MCP stdio transport = newline-delimited JSON-RPC 2.0 on stdin/stdout (NOT
 * Content-Length framed). stdout carries ONLY protocol messages (one per line);
 * ALL logging goes to stderr.
 *
 * WHY THIS SERVER EXISTS
 * ----------------------
 * Three prior attempts to submit a plugin failed because the build/validate/
 * render/marker work ran in the model's **Bash tool** — a restricted Linux
 * container (no ~/agntux, no Chromium, immutable shared dirs). The plugin's MCP
 * server, by contrast, is host-spawned and runs NATIVELY (darwin, the real
 * user, full filesystem, working Chromium — proven by cowork-env-probe). So the
 * heavy work lives HERE, behind atomic tool boundaries the model calls and
 * cannot partial-run, emulate, or fabricate around. The build skill only
 * ORCHESTRATES by calling these tools.
 *
 * WHY ZERO-DEP RAW JSON-RPC (not @modelcontextprotocol/sdk)
 * --------------------------------------------------------
 * The reference impl the plan points at (cowork-env-probe/mcp-server/index.mjs)
 * proved a raw stdio loop works in the real Cowork MCP context. Zero deps means
 * the shipped dist/index.js is self-contained with NO node_modules in the zip,
 * no bundler step that could rebind import.meta.url, and no eval-using
 * transitive dependency. The server imports only Node built-ins plus the
 * shared, already-shipped toolchain under ../../bin and ../../host-renderer.
 *
 * FAILURE SEMANTICS (the contract that removes fabrication pressure)
 * -----------------------------------------------------------------
 * Tool handlers NEVER throw to the JSON-RPC layer — a thrown protocol error is
 * what reads as "tool broken, I'll do it myself." Every handler returns a
 * structured result with `ok` plus, on failure, an `error_kind`
 * ("plugin" | "environment" | "usage" | "internal") and a `blocking` flag.
 * `render:"skipped"` is a SUCCESS (ok:true) — a browserless machine still
 * passes the build/lint/typecheck/tests gates, so no unpassable-yet-mandatory
 * gate exists.
 */

import process from "node:process";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  openSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";

const SERVER_INFO = { name: "agntux-build", version: readOwnVersion() };

// ── shared toolchain resolution (fileURLToPath, NEVER URL.pathname) ───────────
// The Cowork plugin lives under ~/Library/Application Support/... where a space
// becomes %20 and breaks .pathname; fileURLToPath decodes it. These resolve the
// same whether this file runs from src/ (dev) or dist/ (host launches
// dist/index.js) — both are one level under mcp-server/.
const VALIDATE_MJS = fileURLToPath(new URL("../../bin/validate-plugin.mjs", import.meta.url));
const SCAFFOLD_MJS = fileURLToPath(new URL("../../scripts/scaffold-marketplace-assets.mjs", import.meta.url));
const HOST_RENDERER_DIR = fileURLToPath(new URL("../../host-renderer", import.meta.url));
const TEST_HARNESS_CLI = fileURLToPath(new URL("../../test-harness/bin/cli.mjs", import.meta.url));
const BOOTSTRAP_WORKER = fileURLToPath(new URL("./bootstrap-worker.js", import.meta.url));

// Lazy-loaded shared pipeline (build→lint→typecheck→tests→validate→render) +
// tree-hash helpers, imported from the bundled bin/ entrypoint so its
// resolveToolchain(__dirname) sees the real bin/ location.
let _toolchain = null;
async function toolchain() {
  if (_toolchain) return _toolchain;
  _toolchain = await import(pathToFileURL(VALIDATE_MJS).href);
  return _toolchain;
}

// Managed, reusable Playwright browser cache. A one-time install lands here and
// is reused forever. It's a tool cache (not user data), so a fixed location
// under the home agntux dir is fine even if the user's project root is named
// differently.
const MANAGED_BROWSERS = path.join(
  os.homedir(),
  "agntux",
  ".agntux-build",
  ".headless-tools",
);

// Once a Chromium resolves ready in the managed dir it does not disappear, so
// cache it process-wide and skip the (synchronous, event-loop-blocking) probe
// on every subsequent tool call.
let browserReadyCached = false;

// ── tool catalog ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "agntux_scaffold",
    description:
      "Scaffold the FLOOR for a freshly-created plugin tree, run IN THIS SERVER (native, host-path-writable — the same context agntux_validate / agntux_write_submission run in). Idempotent: copies the placeholder icon, emits the skills/{slug}/_overrides/frontmatter.yaml render floor (so the skill tree renders even before the ingest specialist writes the real map), marketplace/README.md, the plugin-root package.json + vitest.config.ts, and — when `view_tool:true` — the build-critical view-tool floor (package.json WITH the @agntux/ui-primitives workspace dep, the byte-frozen apps-client, tsconfig/tailwind/vite.config/emit-manifest). Each only when absent, NEVER overwriting a specialist's real output. Pass `view_tool:true` whenever the plugin ships ≥1 UI handler (decided in stage 5) so the view-tool-builder authors ONLY the per-handler UI, never the deterministic build config. Also kicks the detached renderer (Chromium) install so it is ready by the first agntux_validate. Call this ONCE at the start of stage 7, BEFORE dispatching the authoring specialists and before agntux_validate. Returns {ok:true, output, renderer_prewarm} or {ok:false, error_kind, blocking, detail}; NEVER throws. Do NOT run scaffold-marketplace-assets.mjs yourself via Bash — the Bash sandbox can't write the native host build path (EPERM); this server can.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Marker slug, e.g. agntux-gmail." },
        plugin_dir: { type: "string", description: "Absolute path to the build sandbox plugin tree (…/.agntux-build/builds/{session}/agntux-{slug}/). Created (with parents) if absent — you do not need to mkdir it first." },
        view_tool: { type: "boolean", description: "True when the plugin ships ≥1 UI handler — pre-places the build-critical view-tool floor (deps + apps-client + configs) so the specialist authors only the per-handler UI. Default false." },
      },
      required: ["slug", "plugin_dir"],
      additionalProperties: false,
    },
  },
  {
    name: "agntux_validate",
    description:
      "Validate a built plugin tree: build → lint → typecheck → tests → structural validate → faithful headless render, run IN THIS SERVER (native, full fs, real Chromium). Returns a structured verdict; NEVER throws. ok:true means every hard gate passed (render may be 'skipped' on a browserless machine — still ok). ok:false carries failed_stage + routing (a fixable plugin defect → fix and re-call) or blocking:false (an environment limit → honest stop). On first use the renderer self-installs Chromium in the background (~1-2 min); the verdict's `renderer.status` says 'installing' and render is 'skipped' until ready — re-call to include the render gate.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Marker slug, e.g. agntux-gmail." },
        plugin_dir: { type: "string", description: "Absolute path to the built plugin tree to validate." },
        session_dir: { type: "string", description: "Optional. Where a record receipt is written (default: parent of plugin_dir)." },
      },
      required: ["slug", "plugin_dir"],
      additionalProperties: false,
    },
  },
  {
    name: "agntux_write_submission",
    description:
      "Re-validate the plugin tree internally (the gate — no caller-supplied verdict is trusted), then pure-fs+crypto write the SUBMISSION.json finalization marker as a SIBLING of the plugin dir. Returns {ok, submission_id, tree_sha256, files, marker_path} on success, or {ok:false, verdict} when validation fails (and writes NOTHING). NEVER throws. This is the ONLY writer of SUBMISSION.json — never hand-author it.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Marker slug, e.g. agntux-gmail." },
        session: { type: "string", description: "Session id (YYYY-MM-DD-HHmmss)." },
        agntux_root: { type: "string", description: "Absolute agntux project root (the stage-0 resolver result)." },
        plugin_version: { type: "string", description: "Final plugin version (the plugin's own plugin.json)." },
        mode: { type: "string", enum: ["create", "update"], description: "create | update." },
        previous_version: { type: "string", description: "Only when mode is update." },
        revision_of: { type: "string", description: "Optional. A prior submission_id when revising." },
      },
      required: ["slug", "session", "agntux_root", "plugin_version", "mode"],
      additionalProperties: false,
    },
  },
  {
    name: "agntux_confirm_submission",
    description:
      "Poll the daemon's .submission-status.json sidecar (and check the desktop daemon is active) to confirm the marker was accepted and queued. Returns {queued:true,...} (the ONLY basis for telling a user 'submitted'), {queued:false, reason} (daemon dropped it — surface the reason), or {queued:null, reason} (daemon inactive/signed-out/timeout — finalized but not yet queued). NEVER throws.",
    inputSchema: {
      type: "object",
      properties: {
        session_dir: { type: "string", description: "Absolute path to the session dir holding SUBMISSION.json (…/.agntux-build/builds/{session})." },
      },
      required: ["session_dir"],
      additionalProperties: false,
    },
  },
  {
    name: "agntux_report_defect",
    description:
      "Bundle a FAILED build session for the agntux-build MAINTAINER. Reads the persisted validation verdict + logs (`{session_dir}/.validate/`) and the plugin tree manifest, writes `{session_dir}/DEFECT.json`, and returns {ok:true, defect_path, summary}. This is the HONEST-STOP action: call it when a failure is an environment/internal limit (a non-blocking, not-the-contributor's-fault wall) or the fix loop is exhausted, instead of fabricating a success. It does NOT submit anything to the marketplace — it only saves a local maintainer-facing report. NEVER throws.",
    inputSchema: {
      type: "object",
      properties: {
        session_dir: { type: "string", description: "Absolute path to the failed session dir (…/.agntux-build/builds/{session})." },
        note: { type: "string", description: "Optional. A short human note about what was being attempted / what failed." },
      },
      required: ["session_dir"],
      additionalProperties: false,
    },
  },
];

// ── renderer bootstrap (detached + polled; never blocks a tool call) ──────────

function bootstrapPaths() {
  const workDir = MANAGED_BROWSERS;
  return {
    workDir,
    progressFile: path.join(workDir, "bootstrap-progress.json"),
    logFile: path.join(workDir, "bootstrap.log"),
  };
}

function readBootstrapProgress() {
  const { progressFile } = bootstrapPaths();
  try {
    return JSON.parse(readFileSync(progressFile, "utf8"));
  } catch {
    return null;
  }
}

function startBootstrap() {
  const { workDir, progressFile, logFile } = bootstrapPaths();
  mkdirSync(workDir, { recursive: true });
  writeFileSync(
    progressFile,
    JSON.stringify({ phase: "starting", done: false, startedAt: new Date().toISOString() }, null, 2),
  );
  const out = openSync(logFile, "a");
  const child = spawn(
    process.execPath,
    [BOOTSTRAP_WORKER, HOST_RENDERER_DIR, MANAGED_BROWSERS, progressFile],
    { detached: true, stdio: ["ignore", out, out] },
  );
  child.unref();
  return { pid: child.pid, progressFile, logFile };
}

/**
 * Ensure the renderer (host-renderer deps + a Chromium in the managed dir) is
 * ready. NEVER blocks: if not ready, it kicks a detached install and reports
 * "installing" so the validate call returns promptly with render skipped.
 * Sets PLAYWRIGHT_BROWSERS_PATH so the probe + any launch use the managed dir.
 *
 * @returns {{ready:boolean, status:"ready"|"installing"|"unavailable", detail?:string}}
 */
function ensureBrowser() {
  // Explicit opt-out (CI / tests / a contributor who wants build+lint+tests
  // only): never touch the filesystem or start an install — render reports
  // skipped, which is ok:true.
  if (process.env.AGNTUX_BUILD_SKIP_RENDER) {
    return { ready: false, status: "disabled", detail: "AGNTUX_BUILD_SKIP_RENDER set" };
  }
  if (browserReadyCached) return { ready: true, status: "ready" };
  process.env.PLAYWRIGHT_BROWSERS_PATH = MANAGED_BROWSERS;
  try {
    mkdirSync(MANAGED_BROWSERS, { recursive: true });
  } catch {
    return { ready: false, status: "unavailable", detail: "managed browser dir not writable" };
  }

  const depsReady = existsSync(path.join(HOST_RENDERER_DIR, "node_modules", "playwright"));
  let browserReady = false;
  if (depsReady) {
    const probe = spawnSync("node", [TEST_HARNESS_CLI, "probe-chromium"], {
      env: process.env,
      encoding: "utf8",
    });
    browserReady = probe.status === 0;
  }
  if (depsReady && browserReady) {
    browserReadyCached = true;
    return { ready: true, status: "ready" };
  }

  const prog = readBootstrapProgress();
  if (prog && !prog.done) {
    return { ready: false, status: "installing", detail: prog.phase || "in-progress" };
  }
  if (prog && prog.done && prog.ok === false) {
    // A prior bootstrap failed. Back off briefly so we don't spawn a worker on
    // every call, but DO retry an OLDER failure by falling through to a fresh
    // startBootstrap below — a transient failure (offline/disk) must not wedge
    // render permanently (an unparseable/absent timestamp counts as stale).
    const last = Date.parse(prog.updatedAt || prog.startedAt || "");
    if (Number.isFinite(last) && Date.now() - last < 2 * 60_000) {
      return {
        ready: false,
        status: "unavailable",
        detail: bootstrapFailureDetail(prog),
      };
    }
    // stale/unknown-age failure → fall through and retry a fresh bootstrap.
  }
  // Not ready and nothing in progress (or a prior success that's now missing) —
  // kick a detached install and report installing.
  try {
    startBootstrap();
  } catch (e) {
    return { ready: false, status: "unavailable", detail: `could not start renderer bootstrap: ${errStr(e)}` };
  }
  return {
    ready: false,
    status: "installing",
    detail: "setting up the renderer (~1-2 min); re-run validate to include the render gate",
  };
}

// ── tool handlers (each returns a plain JSON-able result; NEVER throws) ───────

async function handleScaffold(args) {
  const slug = str(args.slug);
  const pluginDir = str(args.plugin_dir);
  const withViewTool = args.view_tool === true;
  if (!slug || !pluginDir) {
    return { ok: false, error_kind: "usage", blocking: false, detail: "slug and plugin_dir are required" };
  }
  // The build-sandbox plugin dir is THIS tool's to create — it lays the floor
  // INTO it. Requiring the caller to pre-create it forced a Bash `mkdir` detour
  // and (because the missing-dir verdict had no summary of its own) surfaced a
  // misleading "scaffold failed in the build stage: compile error" envelope.
  // Create it (and any missing parents) idempotently; a genuinely unwritable
  // path surfaces as an internal tooling error below.
  try {
    mkdirSync(pluginDir, { recursive: true });
  } catch (e) {
    return { ok: false, error_kind: "internal", blocking: false, detail: `could not create plugin dir ${pluginDir}: ${errStr(e)}` };
  }
  // Pre-warm the renderer NOW (stage-7 start): kick the detached Chromium
  // install so it is ready by the first agntux_validate. The 7-specialist
  // authoring pass overlaps the ~1-2 min install, so render runs on validate
  // round 1 instead of forcing a second "installing" round. Non-blocking and
  // idempotent — a no-op if already ready/in-progress/disabled.
  let rendererPrewarm;
  try {
    rendererPrewarm = ensureBrowser().status;
  } catch (e) {
    rendererPrewarm = `prewarm-error: ${errStr(e)}`;
  }
  // Run the scaffold script NATIVELY in this server (host-path-writable). The
  // script is idempotent and writes only absent floor assets. spawnSync (not
  // import): the script runs its work at module top-level with no main-guard,
  // so a child process is the clean boundary. Capture both streams. --view-tool
  // also pre-places the build-critical view-tool floor for UI plugins.
  const scaffoldArgs = [SCAFFOLD_MJS, "--slug", slug, "--plugin-dir", pluginDir];
  if (withViewTool) scaffoldArgs.push("--view-tool");
  let r;
  try {
    r = spawnSync(process.execPath, scaffoldArgs, {
      encoding: "utf8",
      env: process.env,
    });
  } catch (e) {
    return { ok: false, error_kind: "internal", blocking: false, detail: `could not spawn scaffold: ${errStr(e)}`, renderer_prewarm: rendererPrewarm };
  }
  const output = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.status === 0) {
    return { ok: true, output, renderer_prewarm: rendererPrewarm };
  }
  // A scaffold failure is an agntux-build packaging/tooling defect (missing
  // canonical template, unwritable dir) — NOT a contributor problem. blocking:
  // false so the orchestrator stops honestly and logs a maintainer defect
  // rather than re-dispatching a specialist. parseFirstError() names the file/
  // line when the scaffold output carries one, so a tooling defect points at
  // the culprit.
  let firstError = {};
  try {
    const { parseFirstError } = await toolchain();
    firstError = parseFirstError(output) || {};
  } catch {
    /* best-effort enrichment; omit on failure */
  }
  return {
    ok: false,
    error_kind: "internal",
    blocking: false,
    ...firstError,
    detail: output || `scaffold exited with status ${r.status}${r.signal ? ` (signal ${r.signal})` : ""}`,
    renderer_prewarm: rendererPrewarm,
  };
}

async function handleValidate(args) {
  const slug = str(args.slug);
  const pluginDir = str(args.plugin_dir);
  const sessionDir = args.session_dir ? str(args.session_dir) : undefined;
  if (!slug || !pluginDir) {
    return { ok: false, error_kind: "usage", blocking: false, detail: "slug and plugin_dir are required" };
  }
  const { runValidation } = await toolchain();
  const eb = ensureBrowser();
  // installBrowser:false — the renderer is bootstrapped detached above, so the
  // validate call never blocks on a ~1-min install. If the browser is ready the
  // probe finds it (PLAYWRIGHT_BROWSERS_PATH is set) and render runs.
  const verdict = await runValidation({ slug, pluginDir, sessionDir, installBrowser: false });
  verdict.renderer = describeRenderer(eb, verdict);
  // Surface the running harness version in every verdict (Part G) so the agent
  // and user can see, mid-build, WHICH agntux-build bundle is actually running —
  // answering "is the served bundle current?" BEFORE submission, instead of
  // after a fixed bug confusingly reappears from a stale installed zip.
  verdict.agntux_build_version = readOwnVersion();
  return verdict;
}

async function handleWriteSubmission(args) {
  const slug = str(args.slug);
  const session = str(args.session);
  const agntuxRoot = str(args.agntux_root);
  const pluginVersion = str(args.plugin_version);
  const mode = str(args.mode);
  const previousVersion = args.previous_version ? str(args.previous_version) : null;
  const revisionOf = args.revision_of ? str(args.revision_of) : null;

  if (!slug || !session || !agntuxRoot || !pluginVersion || !mode) {
    return { ok: false, error_kind: "usage", blocking: false, detail: "slug, session, agntux_root, plugin_version, mode are required" };
  }
  if (mode !== "create" && mode !== "update") {
    return { ok: false, error_kind: "usage", blocking: false, detail: `mode must be create|update (got ${mode})` };
  }

  const sessionDir = path.join(agntuxRoot, ".agntux-build", "builds", session);
  const pluginDir = path.join(sessionDir, slug);
  // SIBLING of the plugin dir — NEVER inside it.
  const markerPath = path.join(sessionDir, "SUBMISSION.json");

  if (!existsSync(pluginDir)) {
    return { ok: false, error_kind: "usage", blocking: false, detail: `plugin dir not found: ${pluginDir}` };
  }

  // ── THE GATE — re-validate the EXACT tree; no caller verdict trusted ────────
  const { runValidation, walkTree } = await toolchain();
  const eb = ensureBrowser();
  const verdict = await runValidation({ slug, pluginDir, sessionDir, installBrowser: false });
  verdict.renderer = describeRenderer(eb, verdict);
  if (!verdict.ok) {
    return {
      ok: false,
      error_kind: verdict.error_kind || "plugin",
      blocking: verdict.blocking !== false,
      failed_stage: verdict.failed_stage,
      routing: verdict.routing,
      detail: verdict.detail || "validation failed — refusing to write SUBMISSION.json",
      verdict,
    };
  }

  // ── walk + hash the post-validation tree (files[] with bytes) ──────────────
  let files, treeSha;
  try {
    ({ files, treeSha } = treeFilesAndSha(pluginDir, slug, walkTree));
  } catch (e) {
    return { ok: false, error_kind: "internal", blocking: false, detail: `tree walk failed: ${errStr(e)}` };
  }

  // ── contributor + dco from contributor.json ON DISK ────────────────────────
  let contrib;
  try {
    contrib = JSON.parse(readFileSync(path.join(agntuxRoot, ".agntux-build", "contributor.json"), "utf8"));
  } catch (e) {
    return { ok: false, error_kind: "usage", blocking: false, detail: `could not read contributor.json: ${errStr(e)}` };
  }
  if (!isValidContributor(contrib)) {
    return { ok: false, error_kind: "usage", blocking: false, detail: "contributor.json missing name/email/dco fields" };
  }

  const marker = assembleMarker({
    slug,
    pluginVersion,
    mode,
    previousVersion,
    revisionOf,
    sessionId: session,
    agntuxBuildVersion: readOwnVersion(),
    contrib,
    treeSha,
    files,
    validation: {
      build: verdict.stages.build?.status ?? "pass",
      lint: verdict.stages.lint?.status ?? "pass",
      tests: verdict.stages.tests?.status ?? "pass",
      validate: verdict.stages.validate?.status ?? "pass",
      render: verdict.stages.render?.status ?? "skipped",
    },
  });
  const submissionId = marker.submission_id;

  // ── in-memory self-check against the daemon + server gates ─────────────────
  const selfCheck = markerSelfCheck(marker, { pluginDir, sessionDir, markerPath });
  if (!selfCheck.ok) {
    return { ok: false, error_kind: "internal", blocking: false, detail: selfCheck.detail };
  }

  // ── atomic write (temp + rename) ───────────────────────────────────────────
  try {
    mkdirSync(sessionDir, { recursive: true });
    const tmp = `${markerPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(marker, null, 2));
    renameSync(tmp, markerPath);
  } catch (e) {
    return { ok: false, error_kind: "internal", blocking: false, detail: `could not write marker: ${errStr(e)}` };
  }

  return {
    ok: true,
    submission_id: submissionId,
    tree_sha256: treeSha,
    files: files.length,
    marker_path: markerPath,
    validation: marker.validation,
    renderer: verdict.renderer,
  };
}

async function handleConfirmSubmission(args) {
  const sessionDir = str(args.session_dir);
  if (!sessionDir) {
    return { queued: null, reason: "usage", detail: "session_dir is required" };
  }
  // Derive the agntux project root: …/.agntux-build/builds/{session} → root.
  const agntuxRoot = path.resolve(sessionDir, "..", "..", "..");
  const teamsJson = path.join(agntuxRoot, ".agntux", "teams.json");
  const daemonLock = path.join(agntuxRoot, ".agntux", "daemon.lock");
  const daemonActive = () => existsSync(teamsJson) && existsSync(daemonLock);

  const statusPath = path.join(sessionDir, ".submission-status.json");
  const readStatus = () => {
    try {
      return JSON.parse(readFileSync(statusPath, "utf8"));
    } catch {
      return null;
    }
  };

  // Fast path: if the daemon is provably inactive AND no sidecar exists yet,
  // don't burn ~30s — the sidecar will never appear.
  let status = readStatus();
  if (!status && !daemonActive()) {
    return { queued: null, reason: "daemon_inactive", daemon_active: false };
  }
  // Poll ~30s: the daemon writes the sidecar within ~1-2s of the POST resolving.
  for (let i = 0; !status && i < 30; i++) {
    await sleep(1000);
    status = readStatus();
  }

  // Re-sample daemonActive at the end so a daemon that started during the poll
  // is reflected.
  if (status && status.ok === true) {
    return { queued: true, status, daemon_active: daemonActive() };
  }
  if (status && status.ok === false) {
    return { queued: false, reason: status.reason || "server_rejected", status, daemon_active: daemonActive() };
  }
  // No sidecar after the timeout.
  if (!daemonActive()) {
    return { queued: null, reason: "daemon_inactive", daemon_active: false };
  }
  return { queued: null, reason: "timeout_signed_out", daemon_active: true };
}

/**
 * Bundle a FAILED build session into {session_dir}/DEFECT.json for the
 * agntux-build maintainer. Reads the persisted validation verdict + .validate/
 * logs and (best-effort) the plugin tree manifest. Submits NOTHING to the
 * marketplace — it's the honest-stop receipt for an environment/internal wall or
 * an exhausted fix loop. NEVER throws.
 *
 * Exported so the unit test can drive it directly (the dispatch path in handle()
 * still calls the same function); importing the module is side-effect-free.
 */
export async function handleReportDefect(args) {
  const sessionDir = str(args.session_dir);
  const note = args.note ? str(args.note) : null;
  if (!sessionDir) {
    return { ok: false, error_kind: "usage", blocking: false, detail: "session_dir is required" };
  }
  if (!existsSync(sessionDir)) {
    return { ok: false, error_kind: "usage", blocking: false, detail: `session_dir not found: ${sessionDir}` };
  }
  try {
    const { walkTree, tail } = await toolchain();
    const validateDir = path.join(sessionDir, ".validate");

    // ── persisted verdict (best-effort) ─────────────────────────────────────
    let verdict = null;
    try {
      verdict = JSON.parse(readFileSync(path.join(validateDir, "verdict.json"), "utf8"));
    } catch {
      verdict = null;
    }

    // ── *.log tails, keyed by filename (best-effort) ────────────────────────
    const logs = {};
    try {
      for (const name of readdirSync(validateDir)) {
        if (!name.endsWith(".log")) continue;
        try {
          logs[name] = tail(readFileSync(path.join(validateDir, name), "utf8"));
        } catch {
          /* skip an unreadable log */
        }
      }
    } catch {
      /* no .validate dir / unreadable */
    }

    // ── plugin dir → tree manifest (best-effort) ────────────────────────────
    // Prefer the verdict's recorded plugin_dir if it still exists; otherwise the
    // single child directory of session_dir whose basename starts with agntux-.
    let pluginDir = null;
    if (verdict && typeof verdict.plugin_dir === "string" && existsSync(verdict.plugin_dir)) {
      pluginDir = verdict.plugin_dir;
    } else {
      try {
        const children = readdirSync(sessionDir).filter((n) => {
          if (!n.startsWith("agntux-")) return false;
          try {
            return statSync(path.join(sessionDir, n)).isDirectory();
          } catch {
            return false;
          }
        });
        if (children.length === 1) pluginDir = path.join(sessionDir, children[0]);
      } catch {
        /* unreadable session dir contents */
      }
    }

    let tree = null;
    if (pluginDir) {
      try {
        const slug = path.basename(pluginDir);
        const { files, treeSha } = treeFilesAndSha(pluginDir, slug, walkTree);
        tree = { tree_sha256: treeSha, files_count: files.length };
      } catch {
        tree = null; // manifest is best-effort; omit on failure
      }
    }

    // ── assemble + atomic write ─────────────────────────────────────────────
    const defect = {
      schema_version: "1.0.0",
      kind: "agntux-build.defect",
      created_at: new Date().toISOString(),
      agntux_build_version: readOwnVersion(),
      session_dir: sessionDir,
      note: note || null,
      verdict,
      logs,
      tree,
    };

    const defectPath = path.join(sessionDir, "DEFECT.json");
    const tmp = `${defectPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(defect, null, 2));
    renameSync(tmp, defectPath);

    return {
      ok: true,
      defect_path: defectPath,
      files: tree ? tree.files_count : 0,
      summary: "Saved a defect bundle for the maintainer at DEFECT.json.",
    };
  } catch (e) {
    return { ok: false, error_kind: "internal", blocking: false, detail: errStr(e) };
  }
}

// ── JSON-RPC plumbing ─────────────────────────────────────────────────────────

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function log(...a) {
  process.stderr.write("[agntux-build] " + a.join(" ") + "\n");
}

function toolResult(id, payload) {
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] },
  };
}

async function handle(req) {
  const { id, method, params } = req;
  const isNotification = id === undefined || id === null;
  try {
    if (method === "initialize") {
      const clientProto = params && params.protocolVersion;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: clientProto || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    }
    if (method === "notifications/initialized" || method === "initialized") return null;
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    if (method === "tools/call") {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      // Each handler returns a structured result; we wrap internal errors into
      // a structured payload too — NEVER a JSON-RPC error (that reads as "tool
      // broken, I'll do it myself").
      let payload;
      try {
        if (name === "agntux_scaffold") payload = await handleScaffold(args);
        else if (name === "agntux_validate") payload = await handleValidate(args);
        else if (name === "agntux_write_submission") payload = await handleWriteSubmission(args);
        else if (name === "agntux_confirm_submission") payload = await handleConfirmSubmission(args);
        else if (name === "agntux_report_defect") payload = await handleReportDefect(args);
        else payload = { ok: false, error_kind: "usage", blocking: false, detail: `unknown tool: ${name}` };
      } catch (e) {
        payload = { ok: false, error_kind: "internal", blocking: false, detail: errStr(e) };
      }
      // Uniform feedback: every tool result carries a `summary` (+ next_action).
      // NEVER throws; on any error the payload passes through unchanged.
      payload = await withFeedback(payload, { tool: name });
      return toolResult(id, payload);
    }
    if (isNotification) return null;
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } };
  } catch (e) {
    if (isNotification) return null;
    return { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error: " + errStr(e) } };
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function str(v) {
  return typeof v === "string" ? v : "";
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}
function errStr(e) {
  return String((e && e.message) || (e && e.code) || e);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
/**
 * Guarantee every tool result carries a human-readable `summary` (+ `next_action`).
 * If the payload already has a `summary` string we leave it untouched (the
 * validate / write_submission verdicts derive their own richer summary). Otherwise
 * we synthesize one from the shared buildSummary() helper. NEVER throws — on any
 * error the payload is returned unchanged (the anti-fabrication contract: a
 * feedback hiccup must not turn a real result into a thrown protocol error).
 */
async function withFeedback(payload, { tool } = {}) {
  try {
    if (!payload || typeof payload !== "object") return payload;
    if (typeof payload.summary === "string") return payload;
    const { buildSummary } = await toolchain();
    // Normalize the MCP tool name (e.g. agntux_confirm_submission) to the short
    // token buildSummary branches on (confirm_submission); otherwise every
    // synthesized summary falls to the generic/failure path — which mislabeled a
    // queued:true confirm SUCCESS as a build failure.
    const { summary, next_action } = buildSummary({
      tool: String(tool || "").replace(/^agntux_/, ""),
      ok: payload.ok,
      error_kind: payload.error_kind,
      blocking: payload.blocking,
      failed_stage: payload.failed_stage,
      failed_file: payload.failed_file,
      failed_line: payload.failed_line,
      error_code: payload.error_code,
      routing: payload.routing,
      queued: payload.queued,
      reason: payload.reason,
      detail: payload.detail,
    });
    if (typeof summary === "string") payload.summary = summary;
    // Don't clobber a next_action a handler already set.
    if (payload.next_action === undefined && next_action !== undefined) {
      payload.next_action = next_action;
    }
    return payload;
  } catch {
    return payload;
  }
}
/**
 * Reconcile the renderer status reported to the orchestrator. If render actually
 * ran this call (verdict.stages.render.status === "pass"), the browser is
 * provably ready — report "ready" (and cache it) even if ensureBrowser said
 * "installing" before a concurrently-finishing install. Otherwise report what
 * ensureBrowser observed.
 */
function describeRenderer(eb, verdict) {
  if (verdict && verdict.stages && verdict.stages.render && verdict.stages.render.status === "pass") {
    browserReadyCached = true;
    return { status: "ready" };
  }
  return { status: eb.status, ...(eb.detail ? { detail: eb.detail } : {}) };
}
/**
 * Plain-language detail for a persistent renderer-bootstrap failure (Part F.4).
 * A browser-install failure on a restricted network is HARNESS setup, not a
 * plugin defect — say so clearly and point at the two fixes (allowlist the
 * Playwright CDN, or pre-seed the browser). Render stays SOFT (skipped,
 * blocking:false → the verdict is still ok:true on an otherwise-green tree), so
 * the agent stops honestly and never improvises.
 */
function bootstrapFailureDetail(prog) {
  const phase = (prog && prog.phase) || "";
  const raw = (prog && prog.error) || "renderer bootstrap failed (will retry shortly)";
  // Surface the Chromium/CDN guidance ONLY for an actual browser-install
  // failure — either the phase is browser-install (bootstrap-worker prefixes
  // its error "browser-install: …") or the error text carries a
  // browser-specific token. A STEP-1 npm-install failure whose text merely
  // mentions "registry"/"proxy" must NOT be mislabeled as a Chromium download
  // problem, or the fix advice (allowlist the Playwright CDN / pre-seed the
  // browser) would point at the wrong thing.
  const isBrowserPhase = /browser-install/i.test(`${phase} ${raw}`);
  const browserToken = /playwright|chromium|headless-shell|cdn\.playwright/i.test(raw);
  if (isBrowserPhase || browserToken) {
    return (
      "Chromium couldn't be downloaded on your network — this is renderer/harness " +
      "setup, NOT a defect in your plugin. The plugin tree is otherwise green and " +
      "render is skipped. Ask the maintainer to allowlist the Playwright CDN, or " +
      "pre-seed chromium-headless-shell into the managed browsers dir " +
      "(host-renderer/README.md → “Pre-seeding Chromium”)."
    );
  }
  return raw;
}

function readOwnVersion() {
  // This server's version tracks the agntux-build plugin version. Prefer the
  // plugin's own plugin.json (two levels up from mcp-server/{src,dist}).
  const candidates = [
    process.env.CLAUDE_PLUGIN_ROOT
      ? path.join(process.env.CLAUDE_PLUGIN_ROOT, ".claude-plugin", "plugin.json")
      : null,
    fileURLToPath(new URL("../../.claude-plugin/plugin.json", import.meta.url)),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, "utf8")).version;
    } catch {
      /* try next */
    }
  }
  return "0.0.0";
}

// ── marker helpers (pure; exported for unit tests) ──────────────────────────

/**
 * Walk + hash the post-validation tree into the marker's files[] (each
 * `{path, sha256, bytes}`) and the dedup tree_sha256. Takes walkTree from the
 * shared validate-plugin module so the EXCLUDE lists never drift.
 */
export function treeFilesAndSha(pluginDir, slug, walkTree) {
  const files = walkTree(pluginDir)
    .map((abs) => {
      const buf = readFileSync(abs);
      return {
        path: `${slug}/${path.relative(pluginDir, abs)}`,
        sha256: createHash("sha256").update(buf).digest("hex"),
        bytes: buf.length,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const treeSha = createHash("sha256")
    .update(files.map((f) => `${f.path}\t${f.sha256}`).join("\n"))
    .digest("hex");
  return { files, treeSha };
}

/** Assemble the schema-1.1.0 submission marker (pure). */
export function assembleMarker({
  slug,
  pluginVersion,
  mode,
  previousVersion,
  revisionOf,
  sessionId,
  agntuxBuildVersion,
  contrib,
  treeSha,
  files,
  validation,
}) {
  return {
    schema_version: "1.1.0",
    kind: "agntux-build.submission",
    status: "final",
    submission_id: `${slug}@${pluginVersion}+${treeSha.slice(0, 8)}`,
    ...(revisionOf ? { revision_of: revisionOf } : {}),
    plugin_slug: slug,
    plugin_version: pluginVersion,
    mode,
    ...(mode === "update" ? { previous_version: previousVersion } : {}),
    session_id: sessionId,
    build_root: slug,
    agntux_build_version: agntuxBuildVersion,
    contributor: {
      name: contrib.name,
      email: contrib.email,
      ...(contrib.socials ? { socials: contrib.socials } : {}),
    },
    dco: {
      version: contrib.dco_text_version,
      agreed_at: contrib.dco_agreed_at,
      signed_off_by: `${contrib.name} <${contrib.email}>`,
    },
    validation,
    submitted_at: new Date().toISOString(),
    tree_sha256: treeSha,
    files,
  };
}

/** contributor.json must carry name/email/dco fields. */
export function isValidContributor(contrib) {
  return (
    isNonEmptyString(contrib?.name) &&
    isNonEmptyString(contrib?.email) &&
    isNonEmptyString(contrib?.dco_text_version) &&
    isNonEmptyString(contrib?.dco_agreed_at)
  );
}

/**
 * Self-check the in-memory marker against the daemon + server gates BEFORE
 * writing — a marker that would be silently skipped (wrong shape) or mislocated
 * (inside the plugin dir, not a sibling) must never reach disk.
 */
export function markerSelfCheck(marker, { pluginDir, sessionDir, markerPath }) {
  const okShape =
    marker.schema_version &&
    marker.kind === "agntux-build.submission" &&
    marker.status === "final" &&
    marker.submission_id &&
    Array.isArray(marker.files) &&
    marker.files.length > 0 &&
    marker.files.length <= 4096;
  if (!okShape) return { ok: false, detail: "marker failed shape self-check (daemon would skip it)" };
  if (path.dirname(markerPath) !== sessionDir) return { ok: false, detail: "marker is not in the session dir" };
  if (markerPath.startsWith(pluginDir + path.sep)) {
    return { ok: false, detail: "marker must be a sibling of the plugin dir, not inside it" };
  }
  return { ok: true };
}

// ── zero-user-Node runtime shim ───────────────────────────────────────────────
// The build shells out to bare `node`/`npm`/`npx` (validate → build-plugin.mjs →
// `npm install` → vite/tsc/vitest; render bootstrap → `npx playwright install`).
// On a user machine with NO node/npm on PATH, the bin/agntux-node.sh launcher
// (which launched THIS server) resolves the AgntUX desktop app's runtime and
// exports AGNTUX_ELECTRON (Electron-as-node) + AGNTUX_NPM_CLI (bundled npm). At
// startup we build a temp shim bin dir whose `node`/`npm`/`npx` re-exec that
// runtime, prepend it to process.env.PATH, and set ELECTRON_RUN_AS_NODE=1. The
// toolchain's run() helpers inherit process.env, so every downstream child
// resolves the shim with NO per-call threading. A no-op when no AgntUX runtime
// is present (dev / CI) — the system node/npm on PATH is used unchanged.

// The genuine AgntUX desktop app's Developer ID signing identity — mirrors
// bin/agntux-node.sh. The marker is untrusted input (user-writable dir), so a
// marker-derived runtime is bound to this identity, never a path shape.
const AGNTUX_TEAM_ID = "K6B5DNTSS7";
const AGNTUX_BUNDLE_ID = "ai.agntux.teams";

/** Shell double-quote a path for embedding in a generated `sh` shim. */
function shQuote(s) {
  return `"${String(s).replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * Read the desktop app's runtime marker as a fallback when the launcher's env
 * exports are absent (server launched without bin/agntux-node.sh). Pure
 * structural read (existence-checked electronPath) — identity verification is
 * the caller's job (verifyAgntuxRuntime). Returns null on any miss.
 */
export function readRuntimeMarker(home = os.homedir()) {
  try {
    const p = path.join(home, "Library", "Application Support", "AgntUX", "electron-runtime.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    if (m && typeof m.electronPath === "string" && existsSync(m.electronPath)) {
      return { electronPath: m.electronPath, npmCliPath: typeof m.npmCliPath === "string" ? m.npmCliPath : "" };
    }
  } catch {
    /* no marker / unreadable */
  }
  return null;
}

/** The `*.app` bundle root for an Electron exe path, or "" if not a bundle. */
function bundleRootOf(electron) {
  const m = /^(.*\.app)\/Contents\/MacOS\//.exec(electron || "");
  return m ? m[1] : "";
}

/**
 * Verify an electron path is the GENUINE, signed AgntUX runtime (codesign Team
 * ID + bundle id). Used to gate a marker-derived runtime on the fallback path
 * the launcher's own codesign check didn't cover. NEVER throws; false on any
 * doubt. Exported for tests.
 */
export function verifyAgntuxRuntime(electron) {
  try {
    const bundle = bundleRootOf(electron);
    if (!bundle || !existsSync(electron)) return false;
    const v = spawnSync("codesign", ["--verify", "--strict", bundle], { encoding: "utf8" });
    if (v.status !== 0) return false;
    const d = spawnSync("codesign", ["-dvv", bundle], { encoding: "utf8" });
    const info = `${d.stdout || ""}${d.stderr || ""}`;
    return (
      info.includes(`TeamIdentifier=${AGNTUX_TEAM_ID}`) &&
      info.includes(`Identifier=${AGNTUX_BUNDLE_ID}`)
    );
  } catch {
    return false;
  }
}

/**
 * Constrain a bundled npm-cli.js to live inside the bundle of `electron`
 * (<bundle>/Contents/Resources/npm/…) and exist. A foreign/absent path → "".
 * Pure + exported for tests.
 */
export function npmUnderBundle(electron, npmCli) {
  if (!npmCli) return "";
  const bundle = bundleRootOf(electron);
  if (!bundle) return "";
  const resourcesNpm = path.join(bundle, "Contents", "Resources", "npm");
  const rel = path.relative(resourcesNpm, npmCli);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return "";
  return existsSync(npmCli) ? npmCli : "";
}

/**
 * Build a temp shim bin dir with `node`/`npm`/`npx` that re-exec the AgntUX
 * Electron runtime as Node. Pure + exported for unit tests. Returns
 * { shimDir, hasNpm } or null when no electron path is given.
 */
export function buildRuntimeShim({ electron, npmCli, tmpRootDir } = {}) {
  if (!electron) return null;
  const shimDir = mkdtempSync(path.join(tmpRootDir || os.tmpdir(), "agntux-build-shim-"));
  const writeShim = (name, body) => {
    const p = path.join(shimDir, name);
    writeFileSync(p, body, { mode: 0o755 });
    chmodSync(p, 0o755); // umask can clear the bits writeFileSync's mode asked for
  };
  // ELECTRON_RUN_AS_NODE is also set process-wide below, but pin it per-shim so
  // these work even if a child scrubs the inherited env.
  writeShim("node", `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shQuote(electron)} "$@"\n`);
  const hasNpm = Boolean(npmCli);
  if (hasNpm) {
    writeShim("npm", `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shQuote(electron)} ${shQuote(npmCli)} "$@"\n`);
    // npx-cli.js is a sibling of npm-cli.js in a normal npm. Only shim it when
    // it actually exists, so a stripped npm degrades to "no npx" instead of a
    // wrapper pointing at a missing CLI.
    const npxCli = path.join(path.dirname(npmCli), "npx-cli.js");
    if (existsSync(npxCli)) {
      writeShim("npx", `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shQuote(electron)} ${shQuote(npxCli)} "$@"\n`);
    }
  }
  return { shimDir, hasNpm };
}

/**
 * Install the runtime shim into this process's env (PATH prepend +
 * ELECTRON_RUN_AS_NODE). NEVER throws (a shim failure degrades to system PATH,
 * it must not wedge the server). Trust model: an AGNTUX_ELECTRON from the env
 * was already codesign-verified by the launcher; a marker-derived runtime is
 * verified HERE before use.
 */
function initRuntimeShim() {
  try {
    let electron = process.env.AGNTUX_ELECTRON || "";
    let npmCli = process.env.AGNTUX_NPM_CLI || "";
    if (!electron) {
      const m = readRuntimeMarker();
      if (m && verifyAgntuxRuntime(m.electronPath)) {
        electron = m.electronPath;
        npmCli = npmUnderBundle(electron, m.npmCliPath);
      }
    }
    if (!electron) {
      log("no AgntUX runtime (env/verified marker); using system node/npm on PATH");
      return;
    }
    const built = buildRuntimeShim({ electron, npmCli });
    if (!built) return;
    // Reap the temp shim dir on clean exit (best-effort; the OS reaps tmp on
    // reboot if we crash). Synchronous so it completes inside the exit handler.
    process.on("exit", () => {
      try {
        rmSync(built.shimDir, { recursive: true, force: true });
      } catch {
        /* tmp dir already gone */
      }
    });
    process.env.PATH = `${built.shimDir}${path.delimiter}${process.env.PATH || ""}`;
    process.env.ELECTRON_RUN_AS_NODE = "1";
    log(`runtime shim ready at ${built.shimDir} (npm ${built.hasNpm ? "on" : "absent"})`);
  } catch (e) {
    log(`runtime shim init failed (continuing with system PATH): ${errStr(e)}`);
  }
}

// ── stdin loop ────────────────────────────────────────────────────────────────

export function startServer() {
  let buf = "";
  // Serialize handlers through a single chain so two concurrent
  // agntux_write_submission calls to the same session can't race on the build /
  // tree-hash / temp+rename of SUBMISSION.json. Requests are normally
  // sequential anyway; this is a cheap correctness backstop.
  let chain = Promise.resolve();
  let pending = 0;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        log("bad json:", line.slice(0, 120));
        continue;
      }
      const reqs = Array.isArray(req) ? req : [req];
      for (const r of reqs) {
        pending++;
        chain = chain
          .then(() => handle(r))
          .then((res) => {
            if (res) send(res);
          })
          .catch((e) => log("handler err", errStr(e)))
          .finally(() => {
            pending--;
          });
      }
    }
  });
  process.stdin.on("end", async () => {
    // Don't drop an in-flight tool result (a multi-minute write_submission) when
    // the host closes stdin — drain pending/queued handlers first (bounded).
    const deadline = Date.now() + 10 * 60_000;
    while (pending > 0 && Date.now() < deadline) {
      await new Promise((r) => {
        const t = setTimeout(r, 50);
        t.unref?.();
      });
    }
    process.exit(0);
  });
  log("started; node", process.version, "pid", process.pid);
}

// Launch the server only when run directly (the host launches dist/index.js).
// Importing this module (unit tests) is side-effect-free.
//
// Do NOT compare `import.meta.url === pathToFileURL(process.argv[1]).href`:
// Node realpath-resolves `import.meta.url` (symlinks followed — the Cowork
// plugin dir is a symlink, and `/tmp`→`/private/tmp` on macOS), while argv[1]
// is the raw invocation path. They never match under a symlink (or a spaced
// path), so `startServer()` would never run and NO tools would register — a
// silent, restart-proof failure. Resolve BOTH sides to a real filesystem path.
function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
if (isMainModule()) {
  initRuntimeShim();
  startServer();
}
