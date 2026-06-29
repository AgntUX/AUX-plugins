/**
 * MCP server contract tests — agntux-build's stdio JSON-RPC server.
 *
 * The load-bearing property (failure semantics): a tool handler NEVER throws a
 * JSON-RPC protocol error — a thrown error reads to the model as "tool broken,
 * I'll do it myself," which is the fabrication path this whole change closes.
 * Every outcome (including usage errors) comes back as a tools/call RESULT
 * whose text is a structured `{ ok:false, error_kind, ... }` payload.
 *
 * We drive the COMMITTED dist/index.js (the artifact the host launches) over a
 * real stdio pipe. AGNTUX_BUILD_SKIP_RENDER keeps the render path inert so no
 * browser is installed during the test. All assertions hit fast paths (handshake
 * + usage errors) that return before any build/spawn.
 */
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "..", "mcp-server", "dist", "index.js");

/**
 * Send a batch of JSON-RPC requests, collect responses until we've seen the
 * expected ids (or time out), then shut the server down. We do NOT rely on
 * stdin-end-exit (the server keeps stdin open like a real MCP host), so we
 * close it ourselves after collecting.
 */
function rpc(requests: object[], wantIds: number[], timeoutMs = 20_000): Promise<Map<number, any>> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, AGNTUX_BUILD_SKIP_RENDER: "1" },
    });
    const got = new Map<number, any>();
    let buf = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      reject(new Error(`timeout; got ids ${[...got.keys()].join(",")}`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg && typeof msg.id === "number") got.set(msg.id, msg);
        if (wantIds.every((id) => got.has(id))) {
          clearTimeout(timer);
          try { child.kill("SIGTERM"); } catch { /* already dead */ }
          resolve(got);
        }
      }
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}

function toolPayload(resp: any): any {
  const text = resp?.result?.content?.[0]?.text;
  return JSON.parse(text);
}

/**
 * Spawn the server, write `requests`, and capture EVERY raw stdout line until we
 * have responses for `wantIds` (then SIGTERM). Returns the verbatim lines so a
 * caller can assert each one is JSON-RPC (the stdout→stderr hardening guard) —
 * unlike `rpc`, which silently drops non-JSON lines.
 */
function rpcRawStdout(
  requests: object[],
  wantIds: number[],
  timeoutMs = 20_000,
  env: Record<string, string> = {},
): Promise<{ lines: string[]; byId: Map<number, any> }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, AGNTUX_BUILD_SKIP_RENDER: "1", ...env },
    });
    const lines: string[] = [];
    const byId = new Map<number, any>();
    let buf = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      reject(new Error(`timeout; got ids ${[...byId.keys()].join(",")}`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim() === "") continue;
        lines.push(line);
        try {
          const msg = JSON.parse(line);
          if (msg && typeof msg.id === "number") byId.set(msg.id, msg);
        } catch { /* a non-JSON line is the bug under test — keep it in lines */ }
        if (wantIds.every((id) => byId.has(id))) {
          clearTimeout(timer);
          try { child.kill("SIGTERM"); } catch { /* already dead */ }
          resolve({ lines, byId });
        }
      }
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}

/**
 * Like rpc(), but injects extra env and returns the ARRIVAL ORDER of response
 * ids (not just a by-id map) so a caller can assert that a `ping` sent during an
 * in-flight slow tools/call is answered FIRST — the keepalive-responsiveness
 * property that prevents Cowork's `-32000` connection close.
 */
function rpcOrdered(
  requests: object[],
  wantIds: number[],
  env: Record<string, string>,
  timeoutMs = 20_000,
): Promise<{ order: number[]; byId: Map<number, any> }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, AGNTUX_BUILD_SKIP_RENDER: "1", ...env },
    });
    const order: number[] = [];
    const byId = new Map<number, any>();
    let buf = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      reject(new Error(`timeout; got ids ${[...byId.keys()].join(",")}`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg && typeof msg.id === "number" && !byId.has(msg.id)) {
          byId.set(msg.id, msg);
          order.push(msg.id);
        }
        if (wantIds.every((id) => byId.has(id))) {
          clearTimeout(timer);
          try { child.kill("SIGTERM"); } catch { /* already dead */ }
          resolve({ order, byId });
        }
      }
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}

describe("agntux-build MCP server", () => {
  it("ships a built dist/index.js artifact", () => {
    expect(existsSync(SERVER)).toBe(true);
  });

  it("handshakes and lists exactly the seven pipeline tools", async () => {
    const got = await rpc(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ],
      [1, 2],
    );
    expect(got.get(1)?.result?.serverInfo?.name).toBe("agntux-build");
    const names = (got.get(2)?.result?.tools ?? []).map((t: any) => t.name).sort();
    expect(names).toEqual([
      "agntux_confirm_submission",
      "agntux_fetch_published_plugin",
      "agntux_marketplace_lookup",
      "agntux_report_defect",
      "agntux_scaffold",
      "agntux_validate",
      "agntux_write_submission",
    ]);
  });

  it("agntux_scaffold CREATES a missing plugin_dir (A1) instead of erroring — no JSON-RPC error", async () => {
    // A1: the build-sandbox plugin dir is the tool's to create; a missing dir is
    // no longer a "plugin dir not found" usage error (which forced a Bash mkdir
    // detour + a misleading 'compile error' envelope). Use a path that does NOT
    // exist yet and clean it up afterward.
    const parent = mkdtempSync(join(tmpdir(), "agntux-scaffold-a1-"));
    const pluginDir = join(parent, "agntux-nope"); // not yet created
    try {
      const got = await rpc(
        [
          { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
          {
            jsonrpc: "2.0", id: 2, method: "tools/call",
            params: { name: "agntux_scaffold", arguments: { slug: "agntux-nope", plugin_dir: pluginDir } },
          },
        ],
        [2],
      );
      const resp = got.get(2);
      expect(resp.error).toBeUndefined(); // never a protocol error
      const v = toolPayload(resp);
      expect(existsSync(pluginDir), "scaffold must create the missing dir").toBe(true);
      // The A1 mislabel symptom is gone: a missing dir no longer produces the
      // "scaffold failed in the build stage: compile error" envelope.
      expect(String(v.summary ?? "")).not.toContain("compile error");
      expect(v.ok).toBe(true);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("agntux_scaffold returns a structured usage verdict (NOT a JSON-RPC error) for missing args", async () => {
    const got = await rpc(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
        {
          jsonrpc: "2.0", id: 2, method: "tools/call",
          params: { name: "agntux_scaffold", arguments: { slug: "agntux-nope" } }, // plugin_dir omitted
        },
      ],
      [2],
    );
    const resp = got.get(2);
    expect(resp.error).toBeUndefined(); // never a protocol error
    const v = toolPayload(resp);
    expect(v.ok).toBe(false);
    expect(v.error_kind).toBe("usage");
    expect(v.blocking).toBe(false);
  });

  it("agntux_validate returns a structured usage verdict (NOT a JSON-RPC error) for a missing tree", async () => {
    // A guaranteed-absent path under a fresh tmp parent (NOT shared with the
    // scaffold test, which now creates its target). runValidation guards a
    // missing tree as `usage` before any build.
    const parent = mkdtempSync(join(tmpdir(), "agntux-validate-absent-"));
    const absent = join(parent, "agntux-nope"); // never created
    try {
      const got = await rpc(
        [
          { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
          {
            jsonrpc: "2.0", id: 2, method: "tools/call",
            params: { name: "agntux_validate", arguments: { slug: "agntux-nope", plugin_dir: absent } },
          },
        ],
        [2],
      );
      const resp = got.get(2);
      expect(resp.error).toBeUndefined(); // never a protocol error
      const v = toolPayload(resp);
      expect(v.ok).toBe(false);
      expect(v.error_kind).toBe("usage");
      expect(v.blocking).toBe(false);
      expect(v.renderer?.status).toBe("disabled"); // AGNTUX_BUILD_SKIP_RENDER honored
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("answers ping while a slow validate is in flight (event loop stays responsive)", async () => {
    // Regression guard for the `-32000 Connection closed` bug: a long validate
    // must NOT starve the keepalive. Make the validate worker deterministically
    // slow (~3s) without a real build, then fire a ping mid-flight — it MUST come
    // back before the validate result. This exercises BOTH halves of the fix:
    // (1) validation runs in a child process so the loop isn't spawnSync-blocked,
    // and (2) `ping` is dispatched off the request serialization chain so it
    // isn't queued behind the in-flight tools/call.
    const parent = mkdtempSync(join(tmpdir(), "agntux-validate-slow-"));
    const absent = join(parent, "agntux-nope"); // runValidation returns fast AFTER the worker delay
    try {
      const { order, byId } = await rpcOrdered(
        [
          { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
          {
            jsonrpc: "2.0", id: 2, method: "tools/call",
            params: { name: "agntux_validate", arguments: { slug: "agntux-nope", plugin_dir: absent } },
          },
          { jsonrpc: "2.0", id: 3, method: "ping" },
        ],
        [2, 3],
        { AGNTUX_VALIDATE_WORKER_TEST_DELAY_MS: "3000" },
      );
      // The ping (3) is answered before the slow validate (2) completes.
      expect(byId.get(3)?.result).toEqual({});
      expect(order.indexOf(3)).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(3)).toBeLessThan(order.indexOf(2));
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 15_000);

  it("emits notifications/progress DURING a validate and never after the result (progressToken opt-in)", async () => {
    // Delay the worker > one 5s ticker interval so at least one progress fires,
    // then assert: (a) progress is emitted, and (b) every progress line precedes
    // the tools/call result — the ticker is cleared before the verdict is sent.
    const parent = mkdtempSync(join(tmpdir(), "agntux-validate-progress-"));
    const absent = join(parent, "agntux-nope");
    try {
      const { lines } = await rpcRawStdout(
        [
          { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
          {
            jsonrpc: "2.0", id: 2, method: "tools/call",
            params: {
              name: "agntux_validate",
              arguments: { slug: "agntux-nope", plugin_dir: absent },
              _meta: { progressToken: "tok-1" },
            },
          },
        ],
        [2],
        20_000,
        { AGNTUX_VALIDATE_WORKER_TEST_DELAY_MS: "6000" },
      );
      const parsed = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } });
      const resultIdx = parsed.findIndex((m) => m && m.id === 2);
      const progressIdxs = parsed
        .map((m, i) => (m && m.method === "notifications/progress" && m.params?.progressToken === "tok-1" ? i : -1))
        .filter((i) => i >= 0);
      expect(resultIdx).toBeGreaterThanOrEqual(0);
      expect(progressIdxs.length).toBeGreaterThanOrEqual(1); // emitted during the run
      expect(Math.max(...progressIdxs)).toBeLessThan(resultIdx); // never after the result
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 20_000);

  it("does NOT emit progress when the client supplies no progressToken", async () => {
    const parent = mkdtempSync(join(tmpdir(), "agntux-validate-noprog-"));
    const absent = join(parent, "agntux-nope");
    try {
      const { lines } = await rpcRawStdout(
        [
          { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
          {
            jsonrpc: "2.0", id: 2, method: "tools/call",
            params: { name: "agntux_validate", arguments: { slug: "agntux-nope", plugin_dir: absent } },
          },
        ],
        [2],
        20_000,
        { AGNTUX_VALIDATE_WORKER_TEST_DELAY_MS: "6000" },
      );
      const sawProgress = lines.some((l) => { try { return JSON.parse(l).method === "notifications/progress"; } catch { return false; } });
      expect(sawProgress).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 20_000);

  it("reports an honest crash verdict (signal + stderr tail) when the worker dies without writing one", async () => {
    // The agntux-canva failure class: the validate worker aborts NATIVELY (an
    // Electron-as-node V8 assertion → SIGABRT/SIGTRAP, exit 133) and writes no
    // verdict. The parent MUST surface the signal + the worker's own stderr tail,
    // NOT the old opaque `could not read worker verdict: ENOENT`. A native abort
    // is uncatchable from the worker's JS, so this parent-side capture is the
    // ONLY thing that can report it. We simulate it with the worker's
    // TEST_ABORT hook (writes a marker to stderr, then SIGABRTs itself).
    const parent = mkdtempSync(join(tmpdir(), "agntux-validate-abort-"));
    const absent = join(parent, "agntux-nope");
    try {
      const { byId } = await rpcRawStdout(
        [
          { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
          {
            jsonrpc: "2.0", id: 2, method: "tools/call",
            params: { name: "agntux_validate", arguments: { slug: "agntux-nope", plugin_dir: absent } },
          },
        ],
        [2],
        20_000,
        { AGNTUX_VALIDATE_WORKER_TEST_ABORT: "1" },
      );
      const resp = byId.get(2);
      expect(resp.error).toBeUndefined(); // never a protocol error
      const v = toolPayload(resp);
      expect(v.ok).toBe(false);
      expect(v.error_kind).toBe("internal");
      expect(v.blocking).toBe(false);
      // The real cause is surfaced — not the bare ENOENT that stranded the build.
      expect(v.detail).not.toMatch(/could not read worker verdict: ENOENT/);
      expect(v.detail).toMatch(/killed by SIG|exited with code/);
      expect(v.detail).toContain("AGNTUX_VALIDATE_WORKER_TEST_ABORT_MARKER");
      // The bounded tail keeps the END of the stream (where a real crash stack
      // prints) and truncates the head: the marker (written LAST) survives; the
      // head sentinel (written first, before >TAIL_CAP of filler) is dropped.
      expect(v.detail).not.toContain("AGNTUX_VALIDATE_WORKER_TEST_HEAD_SENTINEL");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 20_000);

  it("turns a JS-level worker fault into a structured internal verdict (uncaught guard)", async () => {
    // Distinct from the native-abort case above: a thrown error / rejected
    // promise inside the worker IS catchable, so the worker's own guard writes a
    // structured verdict carrying the error (exit 0 → the parent trusts it).
    const parent = mkdtempSync(join(tmpdir(), "agntux-validate-throw-"));
    const absent = join(parent, "agntux-nope");
    try {
      const { byId } = await rpcRawStdout(
        [
          { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
          {
            jsonrpc: "2.0", id: 2, method: "tools/call",
            params: { name: "agntux_validate", arguments: { slug: "agntux-nope", plugin_dir: absent } },
          },
        ],
        [2],
        20_000,
        { AGNTUX_VALIDATE_WORKER_TEST_THROW: "1" },
      );
      const resp = byId.get(2);
      expect(resp.error).toBeUndefined();
      const v = toolPayload(resp);
      expect(v.ok).toBe(false);
      expect(v.error_kind).toBe("internal");
      expect(v.blocking).toBe(false);
      expect(v.detail).toContain("AGNTUX_VALIDATE_WORKER_TEST_THROW_MARKER");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 20_000);

  it("agntux_write_submission refuses (no throw) when the plugin tree is absent", async () => {
    const got = await rpc(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
        {
          jsonrpc: "2.0", id: 2, method: "tools/call",
          params: {
            name: "agntux_write_submission",
            arguments: { slug: "agntux-nope", session: "2026-01-01-000000", agntux_root: "/tmp/no-agntux-root-xyz", plugin_version: "0.1.0", mode: "create" },
          },
        },
      ],
      [2],
    );
    const resp = got.get(2);
    expect(resp.error).toBeUndefined();
    const v = toolPayload(resp);
    expect(v.ok).toBe(false);
    expect(typeof v.detail).toBe("string");
  });

  it("an unknown tool returns a structured result, not a protocol error", async () => {
    const got = await rpc(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "agntux_bogus", arguments: {} } },
      ],
      [2],
    );
    const resp = got.get(2);
    expect(resp.error).toBeUndefined();
    const v = toolPayload(resp);
    expect(v.ok).toBe(false);
    expect(v.error_kind).toBe("usage");
  });

  it("agntux_report_defect returns a structured usage verdict (NOT a JSON-RPC error) for a missing session dir", async () => {
    const got = await rpc(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
        {
          jsonrpc: "2.0", id: 2, method: "tools/call",
          params: { name: "agntux_report_defect", arguments: { session_dir: "/tmp/no-session-dir-xyz-does-not-exist" } },
        },
      ],
      [2],
    );
    const resp = got.get(2);
    expect(resp.error).toBeUndefined();
    const v = toolPayload(resp);
    expect(v.ok).toBe(false);
    expect(v.error_kind).toBe("usage");
    expect(v.blocking).toBe(false);
  });

  // Protocol cleanliness — the regression guard for the stdout→stderr hardening.
  // The load-bearing invariant: stdout carries ONLY newline-delimited JSON-RPC
  // (one message per line); ALL human/log/subprocess text goes to stderr. A
  // single non-JSON line on stdout corrupts the framing and the host drops the
  // session.
  //
  // We deliberately do NOT drive a real build here: a full build → tsc/vite/
  // vitest is multi-minute and needs npm install + a plugin tree, which makes
  // for a slow, flaky unit test. Instead we exercise the SAME stdout/stderr
  // discipline through a deterministic handshake + a usage-error tools/call (the
  // unknown-tool path) — every line the server emits still routes through send()
  // (stdout, JSON) vs log() (stderr, text), so a hardening regression that lets
  // log output leak to stdout would still surface here.
  it("emits ONLY JSON-RPC on stdout (no log/build text leaks); failure stays structured", async () => {
    const { lines, byId } = await rpcRawStdout(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "agntux_bogus", arguments: {} } },
      ],
      [2],
    );
    // Every emitted stdout line MUST parse as JSON-RPC 2.0.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      let parsed: any;
      expect(() => { parsed = JSON.parse(line); }, `non-JSON line on stdout: ${line}`).not.toThrow();
      expect(parsed.jsonrpc, `missing jsonrpc on: ${line}`).toBe("2.0");
    }
    // And the tool failure still came back as a structured result, not a thrown
    // protocol error.
    const resp = byId.get(2);
    expect(resp.error).toBeUndefined();
    const v = toolPayload(resp);
    expect(v.ok).toBe(false);
    expect(typeof v.summary).toBe("string"); // withFeedback synthesized a summary
  });
});
