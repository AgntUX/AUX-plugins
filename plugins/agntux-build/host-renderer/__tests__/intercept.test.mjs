// Integration test for the /api/intercept-tool-call endpoint and the
// /api/intercepts/stream SSE channel. Boots the real Express server
// pointed at agntux-slack, fires an intercept POST, and asserts the
// SSE subscriber sees it.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startServer } from "../src/server.mjs";

const PLUGIN_ROOT = join(import.meta.dirname, "..", "..", "..", "agntux-slack");
const BUNDLE = join(PLUGIN_ROOT, "view-tool", "dist", "agntux-slack-view.js");
const skip = !existsSync(BUNDLE);

describe.skipIf(skip)("intercept endpoint", () => {
  it("logs + stubs + replays via SSE", async () => {
    const server = await startServer({ pluginRoot: PLUGIN_ROOT });
    try {
      const base = `http://127.0.0.1:${server.port}`;

      // 1. Fire an intercept POST — the iframe equivalent of
      // `useAppsClient().callTool({name, arguments})`.
      const fired = await fetch(`${base}/api/intercept-tool-call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "slack_send_message",
          args: { channel: "#general", text: "hi" },
        }),
      });
      expect(fired.ok).toBe(true);
      const envelope = await fired.json();
      // The stubbed envelope is what the iframe sees — it MUST be a
      // CallToolResult shape (content[] + isError) so the iframe's
      // happy-path code doesn't crash.
      expect(Array.isArray(envelope.content)).toBe(true);
      expect(envelope.isError).toBe(false);
      expect(envelope.content[0].text).toMatch(/\[stub\]/);

      // 2. The intercept must have been recorded.
      const ring = server.getIntercepts();
      expect(ring.length).toBe(1);
      expect(ring[0].tool).toBe("slack_send_message");
      expect(ring[0].args.channel).toBe("#general");

      // 3. Subscribe to the SSE stream and read the replay frame.
      // SSE in Node 20+ via fetch returns a streaming body we can
      // read incrementally.
      const stream = await fetch(`${base}/api/intercepts/stream`);
      expect(stream.ok).toBe(true);
      expect(stream.headers.get("content-type")).toMatch(/text\/event-stream/);

      const reader = stream.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const deadline = Date.now() + 2000;
      let sawIntercept = false;
      while (Date.now() < deadline && !sawIntercept) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes('"slack_send_message"')) sawIntercept = true;
      }
      reader.cancel().catch(() => {});
      expect(sawIntercept, "SSE replayed the intercepted call").toBe(true);
    } finally {
      await server.shutdown();
    }
  });

  it("rejects POSTs without a tool name", async () => {
    const server = await startServer({ pluginRoot: PLUGIN_ROOT });
    try {
      const r = await fetch(`http://127.0.0.1:${server.port}/api/intercept-tool-call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ args: {} }),
      });
      expect(r.status).toBe(400);
    } finally {
      await server.shutdown();
    }
  });
});
