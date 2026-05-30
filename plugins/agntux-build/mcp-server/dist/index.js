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
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  realpathSync,
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
      "Scaffold the marketplace-asset FLOOR for a freshly-created plugin tree, run IN THIS SERVER (native, host-path-writable — the same context agntux_validate / agntux_write_submission run in). Idempotent: copies the placeholder icon, emits the skills/{slug}/_overrides/frontmatter.yaml render floor (so the skill tree renders even before the ingest specialist writes the real map), marketplace/README.md, and the plugin-root package.json + vitest.config.ts — each only when absent, NEVER overwriting a specialist's real output. Call this ONCE at the start of stage 7, BEFORE dispatching the authoring specialists and before agntux_validate. Returns {ok:true, output} or {ok:false, error_kind, blocking, detail}; NEVER throws. Do NOT run scaffold-marketplace-assets.mjs yourself via Bash — the Bash sandbox can't write the native host build path (EPERM); this server can.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Marker slug, e.g. agntux-gmail." },
        plugin_dir: { type: "string", description: "Absolute path to the build sandbox plugin tree (…/.agntux-build/builds/{session}/agntux-{slug}/)." },
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
        detail: prog.error || "renderer bootstrap failed (will retry shortly)",
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
  if (!slug || !pluginDir) {
    return { ok: false, error_kind: "usage", blocking: false, detail: "slug and plugin_dir are required" };
  }
  if (!existsSync(pluginDir)) {
    return { ok: false, error_kind: "usage", blocking: false, detail: `plugin dir not found: ${pluginDir}` };
  }
  // Run the scaffold script NATIVELY in this server (host-path-writable). The
  // script is idempotent and writes only absent floor assets. spawnSync (not
  // import): the script runs its work at module top-level with no main-guard,
  // so a child process is the clean boundary. Capture both streams.
  let r;
  try {
    r = spawnSync(process.execPath, [SCAFFOLD_MJS, "--slug", slug, "--plugin-dir", pluginDir], {
      encoding: "utf8",
      env: process.env,
    });
  } catch (e) {
    return { ok: false, error_kind: "internal", blocking: false, detail: `could not spawn scaffold: ${errStr(e)}` };
  }
  const output = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.status === 0) {
    return { ok: true, output };
  }
  // A scaffold failure is an agntux-build packaging/tooling defect (missing
  // canonical template, unwritable dir) — NOT a contributor problem. blocking:
  // false so the orchestrator stops honestly and logs a maintainer defect
  // rather than re-dispatching a specialist.
  return {
    ok: false,
    error_kind: "internal",
    blocking: false,
    detail: output || `scaffold exited with status ${r.status}${r.signal ? ` (signal ${r.signal})` : ""}`,
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
        else payload = { ok: false, error_kind: "usage", blocking: false, detail: `unknown tool: ${name}` };
      } catch (e) {
        payload = { ok: false, error_kind: "internal", blocking: false, detail: errStr(e) };
      }
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
  startServer();
}
