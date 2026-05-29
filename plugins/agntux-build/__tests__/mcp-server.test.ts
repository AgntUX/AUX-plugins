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
import { existsSync } from "node:fs";
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

describe("agntux-build MCP server", () => {
  it("ships a built dist/index.js artifact", () => {
    expect(existsSync(SERVER)).toBe(true);
  });

  it("handshakes and lists exactly the three pipeline tools", async () => {
    const got = await rpc(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ],
      [1, 2],
    );
    expect(got.get(1)?.result?.serverInfo?.name).toBe("agntux-build");
    const names = (got.get(2)?.result?.tools ?? []).map((t: any) => t.name).sort();
    expect(names).toEqual(["agntux_confirm_submission", "agntux_validate", "agntux_write_submission"]);
  });

  it("agntux_validate returns a structured usage verdict (NOT a JSON-RPC error) for a missing tree", async () => {
    const got = await rpc(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
        {
          jsonrpc: "2.0", id: 2, method: "tools/call",
          params: { name: "agntux_validate", arguments: { slug: "agntux-nope", plugin_dir: "/tmp/nope-does-not-exist-xyz" } },
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
  });

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
});
