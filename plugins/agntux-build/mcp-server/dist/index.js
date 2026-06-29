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
  createWriteStream,
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
// Sibling worker that runs the (blocking) validation pipeline in a CHILD process
// so this server's event loop stays free to answer ping keepalives + emit
// progress. Resolves the same from src/ and dist/. See validate-worker.js.
const VALIDATE_WORKER = fileURLToPath(new URL("./validate-worker.js", import.meta.url));
// Backstop: if a grandchild (npm/tsc/vitest/playwright) wedges, SIGKILL the
// worker so the tool call returns an honest timeout verdict instead of hanging
// forever (which would also pin the progress ticker and block the stdin-end
// drain). Matches the stdin-end drain deadline; a real validate+render finishes
// in minutes.
const VALIDATE_WORKER_DEADLINE_MS = 10 * 60_000;

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
  {
    name: "agntux_marketplace_lookup",
    description:
      "Stage-1 ANTI-DUPLICATE GATE: check whether an AgntUX plugin for the requested system already exists BEFORE scaffolding a new one. Fetches marketplace/index.json reading PAST the GitHub CDN — the GitHub Contents API with the raw media type returns the file at its CURRENT commit (api.github.com is NOT the raw CDN, so no stale edge cache; no base64 to decode; the raw media type also handles files past the 1 MB base64 cap), falling back to a cache-busted raw URL, then a local dev clone, then a previously-cached copy. Matches server-side and returns ONLY the matched entries + a bounded slug list, so the full index (21 KB today, megabytes at scale) NEVER floods the model context. Returns {ok:true, source, fetched_at, stale, total_plugins, exact_match, keyword_matches, slugs, summary}. exact_match!==null ⇒ the plugin ALREADY EXISTS (route to install/update — never build a duplicate). ok:false ⇒ the marketplace could NOT be verified (network down AND no cache) — treat as UNKNOWN, tell the user, and confirm before building; NEVER read a failure as 'no plugin exists'. NEVER throws. Replaces the old host-side WebFetch of raw.githubusercontent.com, which served 2-week-stale content and offered duplicate builds.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The candidate plugin slug — bare ('linear') or already agntux- prefixed ('agntux-linear'). Drives the exact-match check." },
        query: { type: "string", description: "The user's system name plus any obvious aliases (e.g. 'github gh', 'google calendar gcal', 'gmail mail'). Drives the soft keyword/tagline match. Always pass it." },
        agntux_root: { type: "string", description: "Absolute agntux project root (the stage-0 resolver result). Optional — enables caching the fetched index to .agntux-build/marketplace-index.cache.json for an offline fallback." },
      },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "agntux_fetch_published_plugin",
    description:
      "Fetch the LATEST PUBLISHED source of an existing plugin from the public marketplace repo (AgntUX/AUX-plugins) into the build sandbox, so a FIX/UPDATE is authored against current code — never a stale local copy. Use this at the start of an update-mode fix (the user reported an existing, PUBLISHED plugin is broken) BEFORE dispatching the authoring specialists: it downloads plugins/agntux-{slug}/ at `ref` (default the main branch HEAD = latest published) and writes it to …/.agntux-build/builds/{session}/agntux-{slug}/, the exact path agntux_scaffold/agntux_validate/agntux_write_submission already use. Returns {ok:true, build_path, version, source_ref, files_written} — use build_path as the authoring base and bump the version from the returned `version`. ok:false carries error_kind: 'not_found' (the slug is NOT in the public repo — e.g. a never-merged submission; fall back to the local build), 'rate_limited' (GitHub 403/429 — retry shortly or use a local build), 'network', or 'usage'. NEVER throws, never partially populates build_path (fail-closed). Reads unauthenticated like agntux_marketplace_lookup; AUX-plugins is public so no token is needed.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The plugin slug — bare ('linear') or already agntux- prefixed ('agntux-linear')." },
        agntux_root: { type: "string", description: "Absolute agntux project root (the stage-0 resolver result). The fetched tree lands under {agntux_root}/.agntux-build/builds/{session}/." },
        session: { type: "string", description: "Current session id (YYYY-MM-DD-HHmmss) — selects the target build-sandbox dir." },
        ref: { type: "string", description: "Optional git ref to fetch. Default 'main' (latest published source). Pass a tag like 'agntux-{slug}@{version}' to pin an exact published version." },
      },
      required: ["slug", "agntux_root", "session"],
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

/**
 * Internal-error verdict, shape-compatible with runValidation's own
 * (so the consuming agent sees a uniform structure on any failure path).
 */
function workerErrorVerdict({ slug, pluginDir, sessionDir }, detail) {
  return {
    ok: false,
    slug: slug ?? null,
    plugin_dir: pluginDir ?? null,
    session_dir: sessionDir ?? null,
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

/**
 * Honest `detail` for a worker that produced no usable verdict. A native abort
 * (an uncatchable Electron-as-node V8/Node assertion, e.g.
 * `node::MaybeStackBuffer ... (length+1) <= capacity()`) terminates the worker
 * with a signal and writes nothing, so the captured exit code / signal + a
 * bounded tail of the worker's own stderr/stdout is the ONLY record of the
 * cause. Folding it in here is what turns the old, useless
 * `could not read worker verdict: ENOENT` into an actionable verdict (and
 * DEFECT.json) for the maintainer.
 */
function workerCrashDetail({ readErr, code, signal, errTail, outTail }) {
  let head;
  if (signal) {
    head = `validation worker was killed by ${signal} — an uncatchable native crash/abort (e.g. an Electron-as-node V8 assertion) that bypasses JS error handling; it wrote no verdict`;
  } else if (code != null && code !== 0) {
    head = `validation worker exited with code ${code} without producing a verdict`;
  } else if (readErr) {
    head = `could not read worker verdict: ${errStr(readErr)}`;
  } else {
    head = "validation worker produced no verdict";
  }
  const tail = (errTail || "").trim() || (outTail || "").trim();
  return tail ? `${head}. Worker output tail:\n${tail}` : head;
}

/**
 * Run the validation pipeline in a CHILD process so this server's event loop
 * stays free to answer ping keepalives (and emit progress) during the multi-
 * minute build→…→render run. The in-process path blocked on synchronous
 * spawnSync (bin/validate-plugin.mjs `run()`), starving the keepalive, which is
 * why Cowork closed the connection with `-32000` on long validate-and-render
 * calls. Returns the SAME fully-decorated verdict the in-process path produced
 * (full runValidation shape + `renderer` + `agntux_build_version`). NEVER throws
 * — spawn/exit/read failures fold into an internal-error verdict.
 *
 * @param {{slug:string, pluginDir:string, sessionDir?:string, progressToken?:unknown}} a
 */
async function validateInWorker({ slug, pluginDir, sessionDir, progressToken } = {}) {
  // ensureBrowser FIRST: it sets process.env.PLAYWRIGHT_BROWSERS_PATH and kicks
  // the detached Chromium install. The child inherits env:process.env, so it
  // sees the managed browser dir; `installBrowser:false` is correct in the child.
  const eb = ensureBrowser();

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "agntux-validate-"));
  const outPath = path.join(tmpDir, "verdict.json");
  const childArgs = [VALIDATE_WORKER, slug, "--plugin-dir", pluginDir, "--out", outPath];
  if (sessionDir) childArgs.push("--session-dir", sessionDir);

  let verdict = null;
  let ticker = null;
  let watchdog = null;
  // Capture the worker's exit code/signal + a bounded tail of its own
  // stderr/stdout. A native abort (an Electron-as-node V8 assertion) is
  // uncatchable from the worker's JS, so it writes NO verdict — this captured
  // tail is the only record of why.
  let childCode = null;
  let childSignal = null;
  const TAIL_CAP = 8192; // chars (not bytes); ample for a native crash stack, well within the stdout-safe range
  let errTail = "";
  let outTail = "";
  const keepTail = (cur, d) => {
    const s = cur + d.toString();
    return s.length > TAIL_CAP ? s.slice(s.length - TAIL_CAP) : s;
  };
  try {
    await new Promise((resolve) => {
      const child = spawn(process.execPath, childArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      // Drain BOTH child pipes (an undrained >64KB OS buffer of build output
      // would wedge the child). Keep a bounded tail for crash diagnostics, then
      // route to OUR stderr only — never our stdout, which is the JSON-RPC channel.
      child.stdout.on("data", (d) => { outTail = keepTail(outTail, d); process.stderr.write(d); });
      child.stderr.on("data", (d) => { errTail = keepTail(errTail, d); process.stderr.write(d); });
      // The crash verdict must not be computed until the child has exited AND
      // both stdio pipes have fully drained. When the worker dies by signal
      // immediately after writing (a native abort, or the TEST_ABORT hook), the
      // child 'close' event can fire before the LAST stderr 'data' chunk is
      // delivered — dropping the END of the stream, which is exactly the crash
      // stack we need to surface (and made this path's verdict test flaky). Gate
      // resolution on all three. 'close' (not 'end') also covers an errored or
      // destroyed stream, so a pipe fault can't strand us waiting forever.
      let exited = false;
      let stdoutDone = false;
      let stderrDone = false;
      const settleIfReady = () => { if (exited && stdoutDone && stderrDone) resolve(); };
      child.stdout.on("close", () => { stdoutDone = true; settleIfReady(); });
      child.stderr.on("close", () => { stderrDone = true; settleIfReady(); });
      // Watchdog: a wedged grandchild (npm/tsc/vitest/playwright) would never
      // let the worker close → the call would hang forever and the ticker would
      // emit "validating…" indefinitely. Kill it and return an honest timeout.
      watchdog = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
        verdict = workerErrorVerdict(
          { slug, pluginDir, sessionDir },
          `validation worker exceeded the ${Math.round(VALIDATE_WORKER_DEADLINE_MS / 60_000)}-minute deadline and was killed`,
        );
        resolve();
      }, VALIDATE_WORKER_DEADLINE_MS);
      watchdog.unref?.();
      // Defense-in-depth + UX: emit progress while the child runs, but ONLY
      // when the client opted in by sending a progressToken (per MCP spec).
      // Keeps activity-based host timeouts alive in addition to ping-response.
      if (progressToken !== undefined && progressToken !== null) {
        let n = 0;
        ticker = setInterval(() => {
          send({
            jsonrpc: "2.0",
            method: "notifications/progress",
            params: { progressToken, progress: ++n, message: "validating…" },
          });
        }, 5000);
        ticker.unref?.();
      }
      child.on("error", (e) => {
        verdict = workerErrorVerdict({ slug, pluginDir, sessionDir }, `spawn failed: ${errStr(e)}`);
        resolve();
      });
      child.on("close", (code, signal) => { childCode = code; childSignal = signal; exited = true; settleIfReady(); });
    });
  } catch (e) {
    verdict = workerErrorVerdict({ slug, pluginDir, sessionDir }, `worker error: ${errStr(e)}`);
  } finally {
    // Stop the ticker BEFORE the verdict response is sent so no progress
    // notification can arrive after the result; stop the watchdog so it can't
    // fire after a normal completion.
    if (ticker) clearInterval(ticker);
    if (watchdog) clearTimeout(watchdog);
  }

  // The watchdog / spawn-error / promise-catch paths already set `verdict`.
  // Otherwise the worker ran to a close: trust the on-disk verdict ONLY on a
  // clean exit (code 0, no signal). A non-clean exit means the worker died
  // before overwriting its pre-run breadcrumb (a native abort writes nothing) —
  // synthesize an honest crash verdict from the captured exit code/signal/output
  // (preserving any partial stages the worker had recorded on disk).
  if (!verdict) {
    const cleanExit = childCode === 0 && childSignal == null;
    let onDisk = null;
    let readErr = null;
    try {
      onDisk = JSON.parse(readFileSync(outPath, "utf8"));
    } catch (e) {
      readErr = e;
    }
    if (cleanExit && onDisk && typeof onDisk === "object") {
      verdict = onDisk;
    } else {
      verdict = workerErrorVerdict(
        { slug, pluginDir, sessionDir },
        workerCrashDetail({ readErr, code: childCode, signal: childSignal, errTail, outTail }),
      );
      // Defensive: preserve any partial stage progress the worker recorded on
      // disk. Today the worker only writes the empty-stages breadcrumb before a
      // crash, so this is effectively a no-op — kept for a future worker that
      // checkpoints incremental stages.
      if (onDisk && typeof onDisk === "object" && onDisk.stages && Object.keys(onDisk.stages).length) {
        verdict.stages = onDisk.stages;
      }
    }
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* OS reaps tmp */
  }

  // Airtight: a verdict that somehow isn't an object (e.g. a worker that wrote
  // literal `null`) would throw on the decoration below — fold it into a
  // structured verdict so this helper truly never throws.
  if (!verdict || typeof verdict !== "object") {
    verdict = workerErrorVerdict({ slug, pluginDir, sessionDir }, "worker produced a non-object verdict");
  }

  // EXACT same decoration the old in-process handlers applied: reconcile the
  // renderer status and stamp the running harness version into every verdict.
  // Best-effort — a decoration throw must never discard an otherwise-valid verdict.
  try {
    verdict.renderer = describeRenderer(eb, verdict);
    verdict.agntux_build_version = readOwnVersion();
  } catch {
    /* keep the undecorated verdict rather than throwing */
  }
  return verdict;
}

async function handleValidate(args) {
  const slug = str(args.slug);
  const pluginDir = str(args.plugin_dir);
  const sessionDir = args.session_dir ? str(args.session_dir) : undefined;
  if (!slug || !pluginDir) {
    return { ok: false, error_kind: "usage", blocking: false, detail: "slug and plugin_dir are required" };
  }
  return await validateInWorker({ slug, pluginDir, sessionDir, progressToken: args.__progressToken });
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
  // Runs in a child process (validateInWorker) so the server's event loop stays
  // free to answer ping keepalives during this multi-minute re-validate — the
  // same disconnect fix as agntux_validate. `walkTree` is still needed below for
  // the post-validation tree hash; `renderer`/version decoration happen inside
  // the helper.
  const { walkTree } = await toolchain();
  const verdict = await validateInWorker({ slug, pluginDir, sessionDir, progressToken: args.__progressToken });
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
    return { ok: false, error_kind: "usage", blocking: false, detail: "contributor.json missing DCO fields (dco_text_version / dco_agreed_at)" };
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

// ── marketplace existence-check (stage-1 anti-duplicate gate) ─────────────────
// The build skill's stage 1 must learn whether a plugin already exists before
// offering to scaffold a new one. The previous path — the host WebFetching
// raw.githubusercontent.com — served STALE CDN content (a 2-week-old edge cache
// missed a freshly-landed plugin and offered to build a duplicate). This tool
// reads PAST the CDN deterministically and matches server-side, so the full
// index never floods the model context.

const MARKETPLACE_OWNER_REPO = "AgntUX/AUX-plugins";
const MARKETPLACE_BRANCH = "main";
const MARKETPLACE_FILE = "marketplace/index.json";
// The Contents API + raw media type returns the file's CURRENT-commit bytes with
// NO CDN in the path (api.github.com is not the raw CDN) and no base64 to decode.
const MARKETPLACE_CONTENTS_API = `https://api.github.com/repos/${MARKETPLACE_OWNER_REPO}/contents/${MARKETPLACE_FILE}?ref=${MARKETPLACE_BRANCH}`;
const MARKETPLACE_RAW_URL = `https://raw.githubusercontent.com/${MARKETPLACE_OWNER_REPO}/${MARKETPLACE_BRANCH}/${MARKETPLACE_FILE}`;
const MARKETPLACE_FETCH_TIMEOUT_MS = 10_000;
const MARKETPLACE_SLUGS_CAP = 200;
// The real index is ~21 KB; cap the read so a hijacked/hostile endpoint can't
// OOM the server with a fast multi-GB body (the timeout bounds slow drips, not
// large fast responses).
const MARKETPLACE_MAX_BYTES = 8 * 1024 * 1024;

// Generic words that would soft-match half the marketplace — dropped so a
// keyword/tagline hit means something. The user's input is a product name
// ("Linear", "Notion"), so meaningful tokens survive.
const MARKETPLACE_STOPWORDS = new Set([
  "the", "and", "for", "with", "app", "tool", "plugin", "agntux", "into",
  "from", "your", "this", "that", "new", "support", "connector", "system",
]);

/** Normalize a candidate slug to its canonical `agntux-{slug}` marketplace key. */
export function canonicalPluginSlug(slug) {
  const s = String(slug || "").trim().toLowerCase();
  if (!s) return "";
  return s.startsWith("agntux-") ? s : `agntux-${s}`;
}

/** A parsed object is the AgntUX aggregate index iff it carries a plugins OBJECT. */
function isAgntuxMarketplace(parsed) {
  return Boolean(
    parsed &&
      typeof parsed === "object" &&
      parsed.plugins &&
      typeof parsed.plugins === "object" &&
      !Array.isArray(parsed.plugins),
  );
}

/** Tokenize free text into distinct, meaningful lowercase search tokens. */
function marketplaceTokens(text) {
  return [
    ...new Set(
      String(text || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2 && !MARKETPLACE_STOPWORDS.has(t)),
    ),
  ];
}

/** Split text into lowercase alphanumeric word parts. */
function wordParts(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * First soft-match reason (slug / keyword / tagline) for an entry, or null.
 * Matches on WORD parts, not raw substrings — a raw `.includes` falsely paired
 * "box" with "inbox", "go" with "google-calendar", etc. (advisory-path noise).
 * Checked slug → keyword → tagline; the prefix in the returned reason encodes
 * that precedence.
 */
function marketplaceMatchReason(tokens, pluginSlug, entry) {
  const slugParts = wordParts(pluginSlug.replace(/^agntux-/, ""));
  const kwParts = (Array.isArray(entry?.keywords) ? entry.keywords : []).flatMap((k) => wordParts(k));
  const tagParts = wordParts(str(entry?.tagline));
  for (const t of tokens) {
    if (slugParts.includes(t)) return `slug:${t}`;
    if (kwParts.includes(t)) return `keyword:${t}`;
    if (tagParts.includes(t)) return `tagline:${t}`;
  }
  return null;
}

/**
 * Match a candidate against the aggregate index. Pure (no I/O), exported for
 * unit tests. Returns the EXACT slug hit (the load-bearing anti-duplicate
 * signal) plus soft keyword/tagline hits — never the whole index. The exact hit
 * is excluded from keyword_matches so it is reported exactly once.
 */
export function matchMarketplace(index, { slug, query } = {}) {
  const plugins = isAgntuxMarketplace(index) ? index.plugins : {};
  const allSlugs = Object.keys(plugins);
  const canonical = canonicalPluginSlug(slug);
  const bare = canonical.replace(/^agntux-/, "");

  let exact_match = null;
  if (canonical && Object.prototype.hasOwnProperty.call(plugins, canonical)) {
    const e = plugins[canonical] || {};
    exact_match = { slug: canonical, tagline: str(e.tagline), description: str(e.description) };
  }

  // Fall back to the bare slug for tokens when no free-text query is supplied.
  const tokens = marketplaceTokens(query || bare);
  const keyword_matches = [];
  if (tokens.length) {
    for (const ps of allSlugs) {
      if (ps === canonical) continue; // the exact hit is reported separately
      const reason = marketplaceMatchReason(tokens, ps, plugins[ps] || {});
      if (reason) {
        keyword_matches.push({ slug: ps, tagline: str((plugins[ps] || {}).tagline), matched_on: reason });
      }
    }
  }

  return { total_plugins: allSlugs.length, exact_match, keyword_matches };
}

/** GET a URL as text with a hard timeout; never throws. */
async function httpGetText(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MARKETPLACE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} from ${url}` };
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MARKETPLACE_MAX_BYTES) {
      return { ok: false, detail: `response too large (${declared} bytes) from ${url}` };
    }
    const text = await res.text();
    if (Buffer.byteLength(text) > MARKETPLACE_MAX_BYTES) {
      return { ok: false, detail: `response exceeded ${MARKETPLACE_MAX_BYTES} bytes from ${url}` };
    }
    return { ok: true, text };
  } catch (e) {
    return { ok: false, detail: errStr(e) };
  } finally {
    clearTimeout(timer);
  }
}

function marketplaceCachePath(agntuxRoot) {
  // Only honor an absolute root — a relative/garbage value would resolve the
  // cache against the server's cwd. The fixed trailing segments mean the write
  // can only ever land on `.agntux-build/marketplace-index.cache.json`.
  if (!agntuxRoot || !path.isAbsolute(agntuxRoot)) return null;
  return path.join(agntuxRoot, ".agntux-build", "marketplace-index.cache.json");
}

/**
 * Fetch the marketplace index, reading PAST the GitHub CDN. Order: a local dev
 * clone (maintainer fast path, only when it is unmistakably THIS marketplace) →
 * the Contents API raw media type (current commit, no CDN) → the raw URL with a
 * cache-buster → a previously-cached copy (offline last resort). Writes every
 * fresh network fetch to the cache so the last resort is real. The cache is read
 * ONLY when the network fails, so it never reintroduces staleness. Never throws.
 */
async function fetchMarketplaceIndex({ agntuxRoot } = {}) {
  const cachePath = marketplaceCachePath(agntuxRoot);

  // 1) Local dev clone — four levels up from mcp-server/{src,dist}/index.js is
  // the repo root. Guarded by isAgntuxMarketplace so an unrelated four-levels-up
  // marketplace/index.json on an end-user machine can't masquerade as ours.
  try {
    const localPath = fileURLToPath(new URL("../../../../marketplace/index.json", import.meta.url));
    if (existsSync(localPath)) {
      const parsed = JSON.parse(readFileSync(localPath, "utf8"));
      if (isAgntuxMarketplace(parsed)) {
        return { ok: true, index: parsed, source: "local-dev", fetched_at: new Date().toISOString() };
      }
    }
  } catch {
    /* not a dev clone / unreadable — fall through to the network */
  }

  // 2) Contents API (raw media type) → 3) raw URL, cache-busted.
  let net = await httpGetText(MARKETPLACE_CONTENTS_API, {
    Accept: "application/vnd.github.raw+json",
    "User-Agent": "agntux-build",
    "X-GitHub-Api-Version": "2022-11-28",
    "Cache-Control": "no-cache",
  });
  let source = "contents-api";
  if (!net.ok) {
    // Fallback only if the Contents API failed (e.g. unauthenticated 403/429
    // rate-limit). NOTE: the `?t=` buster defeats browser/proxy caches but
    // raw.githubusercontent.com's edge can still serve a stale object for a
    // path, so `source:"raw-cachebusted"` is NOT a guarantee of freshness — the
    // `source` field exists so a stale read is at least diagnosable.
    net = await httpGetText(`${MARKETPLACE_RAW_URL}?t=${Date.now()}`, {
      "User-Agent": "agntux-build",
      "Cache-Control": "no-cache",
    });
    source = "raw-cachebusted";
  }
  if (net.ok) {
    let parsed = null;
    try {
      parsed = JSON.parse(net.text);
    } catch {
      parsed = null;
    }
    if (isAgntuxMarketplace(parsed)) {
      const fetched_at = new Date().toISOString();
      if (cachePath) {
        try {
          mkdirSync(path.dirname(cachePath), { recursive: true });
          const tmp = `${cachePath}.tmp`;
          writeFileSync(tmp, JSON.stringify({ fetched_at, source, index: parsed }));
          renameSync(tmp, cachePath);
        } catch {
          /* cache is best-effort; a write failure must not fail the lookup */
        }
      }
      return { ok: true, index: parsed, source, fetched_at };
    }
  }

  // 4) Stale cache — a known-old answer beats a false "nothing exists".
  if (cachePath && existsSync(cachePath)) {
    try {
      const c = JSON.parse(readFileSync(cachePath, "utf8"));
      if (isAgntuxMarketplace(c?.index)) {
        return { ok: true, index: c.index, source: "cache-stale", fetched_at: c.fetched_at || null, stale: true };
      }
    } catch {
      /* unreadable cache */
    }
  }

  return { ok: false, error_kind: "network", detail: net.detail || "could not fetch the marketplace index" };
}

/**
 * Stage-1 anti-duplicate gate. Fetches the index past the CDN and matches
 * server-side, returning only the matched entries + a bounded slug list. NEVER
 * throws. A fetch failure returns ok:false (UNKNOWN) — the orchestrator must NOT
 * read that as "no plugin exists".
 */
async function handleMarketplaceLookup(args) {
  const slug = str(args.slug);
  const query = args.query ? str(args.query) : "";
  const agntuxRoot = args.agntux_root ? str(args.agntux_root) : "";
  const canonical = canonicalPluginSlug(slug);
  if (!slug) {
    return {
      ok: false,
      error_kind: "usage",
      blocking: false,
      detail: "slug is required",
      summary: "Cannot check the marketplace without a slug.",
    };
  }

  const fetched = await fetchMarketplaceIndex({ agntuxRoot });
  if (!fetched.ok) {
    return {
      ok: false,
      error_kind: fetched.error_kind || "network",
      blocking: false,
      detail: fetched.detail,
      summary:
        `Couldn't verify the AgntUX marketplace right now (${fetched.detail}). Do NOT assume ` +
        `${canonical} is new — tell the user and confirm before building a new plugin.`,
    };
  }

  const { total_plugins, exact_match, keyword_matches } = matchMarketplace(fetched.index, { slug, query });
  const allSlugs = Object.keys(fetched.index.plugins).sort();
  const slugs = allSlugs.slice(0, MARKETPLACE_SLUGS_CAP);

  const summary = exact_match
    ? `${exact_match.slug} already exists in the marketplace — route to install/update, do NOT build a duplicate.`
    : keyword_matches.length
      ? `No exact match for ${canonical}; ${keyword_matches.length} related plugin(s) found — confirm same-or-different with the user before building.`
      : `No marketplace match for ${canonical} (${total_plugins} plugin(s) checked, source: ${fetched.source}). Safe to build new.`;

  return {
    ok: true,
    source: fetched.source,
    fetched_at: fetched.fetched_at,
    stale: fetched.stale === true,
    total_plugins,
    query: { slug: canonical, text: query || null },
    exact_match,
    keyword_matches,
    slugs,
    slugs_truncated: allSlugs.length > slugs.length,
    summary,
  };
}

// ── fetch a published plugin's source (update-mode fix base) ──────────────────
//
// A fix to an EXISTING published plugin must be authored against the LATEST
// public source, not a possibly-stale local build (the original author's sandbox
// may be behind later public fixes; a different contributor has no sandbox at
// all). This fetches plugins/agntux-{slug}/ from the public marketplace repo into
// the standard build sandbox so every downstream tool works unchanged. Reads
// unauthenticated (AUX-plugins is public); a single tarball request per fix is
// well within the 60/hr unauth limit. The /tarball/{ref} endpoint 302-redirects
// to codeload.github.com — `fetch` follows it; if a host ever enforces a strict
// egress allowlist, codeload must be allowed alongside api.github.com.

// A repo tarball is far larger than index.json, so it gets its own (looser)
// timeout + size cap. The cap guards a hostile/runaway endpoint from OOMing the
// server; the real repo tarball is a few tens of MB.
const PLUGIN_TARBALL_FETCH_TIMEOUT_MS = 60_000;
const PLUGIN_TARBALL_MAX_BYTES = 300 * 1024 * 1024;
// `tar -tzf` output for a large multi-plugin repo can be many thousands of lines;
// give spawnSync headroom over its 1 MB default stdout buffer.
const TAR_LISTING_MAX_BUFFER = 256 * 1024 * 1024;
// A git ref we interpolate raw into the tarball URL path (it is NOT passed to
// tar — only `prefix` + `canonical` reach tar's arg list). Restrict to the
// characters real branch/tag names use AND forbid `..` / a leading `-`: `fetch`
// normalizes `../` in a path, so an unconstrained ref like `../../../user/repos`
// would redirect the GET to a DIFFERENT api.github.com endpoint. `main` and a
// `agntux-{slug}@{semver}` tag both pass.
const SAFE_REF_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._@/-]+$/;
// A session id is a path segment (YYYY-MM-DD-HHmmss); reject `/`, `..`, etc. so
// it can't traverse out of the builds dir when path.join'd.
const SAFE_SESSION_RE = /^[A-Za-z0-9._-]+$/;
// The CANONICAL slug is the untrusted value that reaches BOTH path.join (→ the
// destructive rmSync of buildPath) and tar's member arg. canonicalPluginSlug
// only lowercases/prefixes — it does NOT strip `/` or `..` — so guard the result
// against a real marketplace slug shape before any fs mutation. This is the
// load-bearing check that keeps a crafted slug from deleting an arbitrary dir.
const SAFE_SLUG_RE = /^agntux-[a-z0-9][a-z0-9-]*$/;

/** GitHub repo-tarball URL at a ref (redirects to codeload). */
function pluginTarballUrl(ref) {
  return `https://api.github.com/repos/${MARKETPLACE_OWNER_REPO}/tarball/${ref}`;
}

/**
 * Given the lines of `tar -tzf` output for a GitHub repo tarball (every member
 * lives under a single `{owner}-{repo}-{sha}/` top dir) and a canonical plugin
 * slug, return { prefix, members } where `members` are the member paths under
 * `plugins/{canonical}/`. `members` is [] when that dir is absent (the plugin is
 * not published at this ref). Matches on a path boundary so `agntux-linear` does
 * NOT pick up `agntux-linear-foo`. Pure — exported for unit tests.
 *
 * The prefix is derived from the first line that actually contains a `/`, NOT
 * blindly from line 0: GNU tar (Linux) lists a leading `pax_global_header`
 * pseudo-entry (the git-archive commit header) that has no `/`, which would
 * otherwise be mistaken for the top dir and yield zero members (a false
 * not_found on every Linux host). BSD tar (macOS) omits it; this handles both.
 */
export function selectPluginTarballMembers(listingLines, canonical) {
  const lines = (Array.isArray(listingLines)
    ? listingLines
    : String(listingLines || "").split("\n"))
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length || !canonical) return { prefix: "", members: [] };
  const rootLine = lines.find((l) => l.includes("/"));
  if (!rootLine) return { prefix: "", members: [] };
  const prefix = rootLine.split("/")[0];
  if (!prefix) return { prefix: "", members: [] };
  const dirPath = `${prefix}/plugins/${canonical}`;
  const members = lines.filter(
    (p) => p === dirPath || p === `${dirPath}/` || p.startsWith(`${dirPath}/`),
  );
  return { prefix, members };
}

/** Count files (not dirs) under a tree. Best-effort; returns 0 on read error. */
function countFilesRecursive(dir) {
  let n = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) n += countFilesRecursive(full);
    else if (e.isFile()) n += 1;
  }
  return n;
}

/**
 * Download a URL to a file, STREAMING the body to disk with a hard timeout and a
 * running byte cap. Never throws. Streaming (not res.arrayBuffer()) is load-
 * bearing here: codeload.github.com serves the git-archive tarball CHUNKED with
 * NO content-length, so a pre-read declared-size check can't fire and arrayBuffer
 * would buffer the entire (capped at 300 MB) body in memory before any size check
 * runs. We abort the moment the running total exceeds the cap, bounding memory to
 * one chunk regardless of what the server streams.
 */
async function downloadToFile(url, headers, destFile) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLUGIN_TARBALL_FETCH_TIMEOUT_MS);
  let out = null;
  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    if (!res.ok) return { ok: false, status: res.status, detail: `HTTP ${res.status} from ${url}` };
    if (!res.body) return { ok: false, detail: `empty response body from ${url}` };
    // Honor a declared content-length when present (cheap early reject).
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > PLUGIN_TARBALL_MAX_BYTES) {
      return { ok: false, detail: `tarball too large (${declared} bytes)` };
    }
    out = createWriteStream(destFile);
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > PLUGIN_TARBALL_MAX_BYTES) {
        controller.abort();
        return { ok: false, detail: `tarball exceeded ${PLUGIN_TARBALL_MAX_BYTES} bytes` };
      }
      if (!out.write(chunk)) {
        await new Promise((resolve) => out.once("drain", resolve));
      }
    }
    await new Promise((resolve, reject) =>
      out.end((err) => (err ? reject(err) : resolve())),
    );
    out = null; // ended cleanly; don't destroy in finally
    return { ok: true, bytes: total };
  } catch (e) {
    return { ok: false, detail: errStr(e) };
  } finally {
    clearTimeout(timer);
    if (out) {
      try {
        out.destroy();
      } catch {
        /* best-effort: the partial file is discarded by the caller */
      }
    }
  }
}

/**
 * Fetch the latest published source of an existing plugin into the build sandbox.
 * Fail-closed: build_path is only populated after a verified extraction (a real
 * .claude-plugin/plugin.json). NEVER throws.
 */
async function handleFetchPublishedPlugin(args) {
  const slug = str(args.slug);
  const agntuxRoot = str(args.agntux_root);
  const session = str(args.session);
  const ref = args.ref ? str(args.ref) : MARKETPLACE_BRANCH;
  const canonical = canonicalPluginSlug(slug);

  if (!slug || !agntuxRoot || !session) {
    return {
      ok: false, error_kind: "usage", blocking: false,
      detail: "slug, agntux_root, and session are required",
      summary: "Cannot fetch the published plugin without slug, agntux_root, and session.",
    };
  }
  if (!path.isAbsolute(agntuxRoot)) {
    return {
      ok: false, error_kind: "usage", blocking: false,
      detail: `agntux_root must be an absolute path (got ${agntuxRoot})`,
      summary: "agntux_root must be an absolute path.",
    };
  }
  if (!SAFE_SESSION_RE.test(session)) {
    return {
      ok: false, error_kind: "usage", blocking: false,
      detail: `invalid session id: ${session}`,
      summary: "The session id contains characters that aren't allowed in a path segment.",
    };
  }
  if (!SAFE_REF_RE.test(ref)) {
    return {
      ok: false, error_kind: "usage", blocking: false,
      detail: `invalid ref: ${ref}`,
      summary: "The git ref contains characters that aren't allowed.",
    };
  }
  // The canonical slug reaches a destructive rmSync (of buildPath) and tar's
  // member arg. Validate it BEFORE any fs mutation — canonicalPluginSlug does not
  // strip `/` or `..`, so without this an `agntux-../../x` slug would make
  // buildPath escape the builds dir and rmSync could delete an arbitrary tree.
  if (!SAFE_SLUG_RE.test(canonical)) {
    return {
      ok: false, error_kind: "usage", blocking: false,
      detail: `invalid plugin slug: ${slug}`,
      summary: "The plugin slug isn't a valid marketplace slug (lowercase, hyphenated, agntux- prefixed).",
    };
  }

  const sessionDir = path.join(agntuxRoot, ".agntux-build", "builds", session);
  const buildPath = path.join(sessionDir, canonical);
  // Defense-in-depth: even with the regex guards above, refuse to operate on a
  // buildPath that isn't strictly inside sessionDir (guards a future regex
  // loosening from re-introducing the arbitrary-delete hazard).
  const rel = path.relative(sessionDir, buildPath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      ok: false, error_kind: "usage", blocking: false,
      detail: `resolved build path escapes the session dir: ${buildPath}`,
      summary: "The resolved plugin directory isn't inside the build sandbox.",
    };
  }

  // Work in a temp dir so a failed/partial download never leaves a half-tree at
  // buildPath. We only touch buildPath once we have a verified extraction.
  let tmpDir;
  try {
    mkdirSync(sessionDir, { recursive: true });
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "agntux-fetch-"));
  } catch (e) {
    return {
      ok: false, error_kind: "internal", blocking: false,
      detail: `could not create a work directory: ${errStr(e)}`,
      summary: "Couldn't prepare a work directory for the fetch.",
    };
  }

  const tarFile = path.join(tmpDir, "repo.tar.gz");
  try {
    // 1) Download the repo tarball at `ref` (one request; redirects to codeload).
    const dl = await downloadToFile(
      pluginTarballUrl(ref),
      {
        Accept: "application/vnd.github+json",
        "User-Agent": "agntux-build",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      tarFile,
    );
    if (!dl.ok) {
      const rateLimited = dl.status === 403 || dl.status === 429;
      const notFoundRef = dl.status === 404;
      return {
        ok: false,
        error_kind: rateLimited ? "rate_limited" : notFoundRef ? "not_found" : "network",
        blocking: false,
        detail: dl.detail,
        summary: rateLimited
          ? `GitHub rate-limited the source fetch for ${canonical}. Wait a few minutes and retry, or fix from a local build if one exists.`
          : notFoundRef
            ? `No ref '${ref}' in ${MARKETPLACE_OWNER_REPO} (the ref doesn't exist or the repo is unavailable). If ${canonical} was never merged, fix from the local build instead.`
            : `Couldn't fetch ${canonical} source from GitHub (${dl.detail}). Check the connection and retry.`,
      };
    }
    const downloadedBytes = dl.bytes;

    // 2) List members → derive the top-dir prefix + detect the plugin subtree.
    const listing = spawnSync("tar", ["-tzf", tarFile], {
      encoding: "utf8",
      maxBuffer: TAR_LISTING_MAX_BUFFER,
    });
    if (listing.error || listing.status !== 0) {
      const why = listing.error
        ? errStr(listing.error)
        : (listing.stderr || "").trim() || `status ${listing.status}`;
      return {
        ok: false, error_kind: "internal", blocking: false,
        detail: `tar listing failed: ${why}`,
        summary: "Couldn't read the downloaded source archive (is `tar` available?).",
      };
    }
    const { prefix, members } = selectPluginTarballMembers(listing.stdout.split("\n"), canonical);
    if (!prefix) {
      // No member line carried a top-level dir — an empty/truncated/corrupt
      // download (e.g. a proxy returned a 200 with an empty body). This is a
      // transient condition, not an internal bug: classify it network so the
      // orchestrator retries rather than logging an agntux-build defect.
      return {
        ok: false, error_kind: "network", blocking: false,
        detail: `downloaded archive had no usable entries (${downloadedBytes} bytes) — likely a truncated/empty response`,
        summary: `The downloaded source archive for ${canonical} was empty or truncated. Retry in a moment.`,
      };
    }
    if (!members.length) {
      return {
        ok: false, error_kind: "not_found", blocking: false,
        detail: `plugins/${canonical}/ is not present in ${MARKETPLACE_OWNER_REPO}@${ref}`,
        summary:
          `${canonical} isn't published in the marketplace repo at ${ref}. If you're addressing ` +
          `review feedback on a not-yet-merged submission, fix the local build instead.`,
      };
    }

    // 3) Extract ONLY the plugin subtree into a STAGING dir, verify it there, and
    //    only then swap it into buildPath. Fail-closed: a download/extract failure
    //    must never destroy a pre-existing buildPath (the user's in-progress fix)
    //    and leave nothing in its place. The stage dir is created under sessionDir
    //    (same filesystem as buildPath) so the final swap is an atomic renameSync,
    //    not a cross-device copy (os.tmpdir() may be a different device → EXDEV).
    //    Portable across GNU and BSD tar: naming the directory member recurses;
    //    --strip-components=3 drops {prefix}/plugins/{canonical} so files land at
    //    the stage root. No --wildcards (BSD tar lacks it).
    let stageDir;
    try {
      stageDir = mkdtempSync(path.join(sessionDir, ".fetch-stage-"));
    } catch (e) {
      return {
        ok: false, error_kind: "internal", blocking: false,
        detail: `could not create a staging dir: ${errStr(e)}`,
        summary: "Couldn't prepare a staging directory for the fetched source.",
      };
    }
    try {
      const ex = spawnSync(
        "tar",
        ["-xzf", tarFile, "-C", stageDir, "--strip-components=3", `${prefix}/plugins/${canonical}`],
        { encoding: "utf8" },
      );
      if (ex.error || ex.status !== 0) {
        const why = ex.error ? errStr(ex.error) : (ex.stderr || "").trim() || `status ${ex.status}`;
        return {
          ok: false, error_kind: "internal", blocking: false,
          detail: `tar extract failed: ${why}`,
          summary: "Couldn't extract the plugin source from the archive.",
        };
      }

      // 4) Verify the staged tree is real (fail-closed) BEFORE touching buildPath.
      const stagedManifest = path.join(stageDir, ".claude-plugin", "plugin.json");
      if (!existsSync(stagedManifest)) {
        return {
          ok: false, error_kind: "internal", blocking: false,
          detail: "extracted tree is missing .claude-plugin/plugin.json",
          summary: "The fetched plugin tree was incomplete (no plugin.json).",
        };
      }
      let version = null;
      try {
        version = str(JSON.parse(readFileSync(stagedManifest, "utf8")).version) || null;
      } catch {
        version = null;
      }

      // 5) Swap the verified tree into place. Only now is a prior buildPath
      //    replaced — on the success path exclusively.
      rmSync(buildPath, { recursive: true, force: true });
      renameSync(stageDir, buildPath);
      stageDir = null; // consumed by the rename; nothing to clean up

      const filesWritten = countFilesRecursive(buildPath);
      return {
        ok: true,
        build_path: buildPath,
        slug: canonical,
        version,
        source_ref: ref,
        source_repo: MARKETPLACE_OWNER_REPO,
        bytes: downloadedBytes,
        files_written: filesWritten,
        summary:
          `Fetched ${canonical}${version ? ` v${version}` : ""} from ${MARKETPLACE_OWNER_REPO}@${ref} ` +
          `into the build sandbox (${filesWritten} files). Use build_path as the authoring base ` +
          `for the fix and bump from the returned version.`,
      };
    } finally {
      if (stageDir) {
        try {
          rmSync(stageDir, { recursive: true, force: true });
        } catch {
          /* best-effort: a failed extract leaves only the staging dir, never buildPath */
        }
      }
    }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
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
      // Thread the client's progressToken (MCP `_meta.progressToken`) onto args
      // so the long-running validate handlers can emit `notifications/progress`
      // ONLY when the client opted in. `__progressToken` is an internal carrier
      // key, never part of any tool's public input schema.
      const progressToken = params && params._meta && params._meta.progressToken;
      if (progressToken !== undefined && progressToken !== null) args.__progressToken = progressToken;
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
        else if (name === "agntux_marketplace_lookup") payload = await handleMarketplaceLookup(args);
        else if (name === "agntux_fetch_published_plugin") payload = await handleFetchPublishedPlugin(args);
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
    // Structured build provenance (schema-additive; the marketplace submission
    // handler's validateMarker accepts it as OPTIONAL). Records WHICH agntux-build
    // produced this submission so the builder-feedback loop can attribute a defect
    // to a generator version instead of assuming "latest". `version` is always
    // available; `commit` / `canonical_sha` are reserved for exact differential
    // reproduction and may be added later (both optional). `agntux_build_version`
    // is retained above for back-compat with consumers that read the flat field.
    builder: { version: agntuxBuildVersion },
    contributor: {
      // `name` is published only when the contributor opted into credit;
      // it is absent for an anonymous submission. No email is ever
      // collected or emitted.
      ...(contrib.name ? { name: contrib.name } : {}),
      ...(contrib.socials ? { socials: contrib.socials } : {}),
    },
    dco: {
      version: contrib.dco_text_version,
      agreed_at: contrib.dco_agreed_at,
      // Name-only sign-off when one was provided; omitted otherwise.
      // Never an email — the public DCO sign-off on merge uses the org
      // identity (Signed-off-by: AgntUX <noreply@agntux.ai>).
      ...(contrib.name ? { signed_off_by: contrib.name } : {}),
    },
    validation,
    submitted_at: new Date().toISOString(),
    tree_sha256: treeSha,
    files,
  };
}

/**
 * contributor.json must carry the DCO agreement fields. `name` is optional
 * (present only when the contributor opted into public credit) and no email is
 * ever collected, so neither is required here.
 */
export function isValidContributor(contrib) {
  return (
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
  // If the host tears down the read end of our stdout mid-run, the next
  // process.stdout.write (a response, a ping reply, or the recurring progress
  // ticker) would throw EPIPE → uncaught → crash, orphaning an in-flight worker.
  // Swallow it: the host has gone away, so there's nothing left to deliver.
  process.stdout.on("error", () => {});
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
        // Keepalive + handshake/list methods must be answered IMMEDIATELY, never
        // queued behind an in-flight multi-minute tools/call. Only tools/call
        // goes through the serialization `chain` (it must serialize the
        // SUBMISSION.json build/write). WITHOUT this bypass, a `ping` arriving
        // during a validate sits behind it on the chain and is answered minutes
        // late → Cowork declares the server dead and closes the connection
        // (-32000). These instant methods don't touch shared state, so running
        // them off-chain is safe; they're not counted in `pending` because the
        // stdin-end drain only needs to wait on in-flight tools/call work.
        if (!r || r.method !== "tools/call") {
          Promise.resolve()
            .then(() => handle(r))
            .then((res) => {
              if (res) send(res);
            })
            .catch((e) => log("handler err", errStr(e)));
          continue;
        }
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
