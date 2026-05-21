// Express server. Hosts the plugin's compiled view-tool ESM module
// in-process and serves it to Playwright (headed by default for
// interactive iteration; headless for the final regression
// screenshot).
//
// Routes:
//   GET  /host.html                  — host shell
//   GET  /host-bridge.mjs            — client-side bridge module
//   GET  /sandbox.html               — sandbox-proxy with CSP from ?csp= query param
//   GET  /api/tools                  — listTools (for diagnostics)
//   POST /api/tool-call              — invoke the read-only view-tool handler
//                                       (this is what produces structuredContent
//                                       for the *initial* iframe render)
//   POST /api/intercept-tool-call    — iframe-originated mutation calls land here.
//                                       Logs the payload + emits to SSE + returns a
//                                       stubbed success envelope. Never executes
//                                       the mutation against a real connector.
//   GET  /api/intercepts/stream      — server-sent-events stream of intercepted calls
//   POST /__test/render              — headless: drive a Playwright render and
//                                       return artifacts (used by the test harness
//                                       and stage 8's regression pass)
//
// All static files live under ../public/ relative to this file.

import express from "express";
import cors from "cors";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCspHeader } from "./csp.mjs";
import { loadViewToolModule, callToolWithUi } from "./mcp-bridge.mjs";
import { runHeadlessRender } from "./playwright-driver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const INTERCEPT_RING_CAP = 200;

export async function startServer({
  pluginRoot,
  port = 0,
  fixturesDir = undefined,
}) {
  let listenedPort = port;

  // Load the plugin's view-tool module in-process. Replaces the legacy
  // spawn-MCP-server-in-HTTP-mode path; remote-view-only plugins have
  // no local MCP server to spawn.
  const client = await loadViewToolModule(pluginRoot, { fixturesDir });

  // Ring buffer + SSE subscribers for intercepted mutation tool calls.
  const intercepts = [];
  const sseSubscribers = new Set();

  function recordIntercept(entry) {
    intercepts.push(entry);
    if (intercepts.length > INTERCEPT_RING_CAP) {
      intercepts.splice(0, intercepts.length - INTERCEPT_RING_CAP);
    }
    const payload = `event: intercept\ndata: ${JSON.stringify(entry)}\n\n`;
    for (const res of sseSubscribers) {
      try {
        res.write(payload);
      } catch {
        // dead subscriber — `close` handler will clean it up
      }
    }
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  // ---------- static ----------
  app.get("/host.html", (_req, res) => {
    res.sendFile(join(PUBLIC_DIR, "host.html"));
  });
  app.get("/host-bridge.mjs", (_req, res) => {
    res.type("application/javascript");
    res.sendFile(join(PUBLIC_DIR, "host-bridge.mjs"));
  });

  // ---------- sandbox ----------
  app.get(["/sandbox.html"], (req, res) => {
    let cspConfig;
    if (typeof req.query.csp === "string") {
      try {
        cspConfig = JSON.parse(req.query.csp);
      } catch {
        // ignore — render with default CSP
      }
    }
    res.setHeader("Content-Security-Policy", buildCspHeader(cspConfig));
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(join(PUBLIC_DIR, "sandbox.html"));
  });

  // ---------- API ----------
  app.get("/api/tools", async (_req, res) => {
    try {
      const list = await client.listTools();
      res.json({ tools: list.tools });
    } catch (e) {
      res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
    }
  });

  // Initial view-tool render. The handler is read-only — it produces the
  // structuredContent the iframe materializes. Safe to invoke directly.
  app.post("/api/tool-call", async (req, res) => {
    const { name, args } = req.body ?? {};
    if (typeof name !== "string") {
      return res.status(400).json({ error: "name required" });
    }
    try {
      const out = await callToolWithUi(client, name, args ?? {});
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
    }
  });

  // Mutation interception. Every `useAppsClient().callTool()` invocation
  // from inside the iframe lands here so we can confirm the *shape* of
  // the call (right tool, right args) without firing it against a real
  // connector. Source plugins can't be installed locally during
  // iteration (Claude Cowork's local-stdio path is broken for view
  // tools), so this is the only place mutation iteration happens.
  app.post("/api/intercept-tool-call", (req, res) => {
    const { name, args } = req.body ?? {};
    if (typeof name !== "string") {
      return res.status(400).json({ error: "name required" });
    }
    const entry = {
      tool: name,
      args: args ?? {},
      ts: new Date().toISOString(),
    };
    recordIntercept(entry);
    process.stdout.write(`[intercept] ${name} ${JSON.stringify(entry.args)}\n`);
    res.json({
      content: [
        {
          type: "text",
          text: `[stub] ${name} call captured — not executed locally. The remote MCP server will run it once the plugin is deployed.`,
        },
      ],
      isError: false,
    });
  });

  // Server-sent-events stream of intercepted calls. The host page's
  // sidebar subscribes via EventSource; the build skill can subscribe
  // via fetch to surface payloads back to chat. Replays the ring buffer
  // to new subscribers so the sidebar shows history on tab reload.
  //
  // SUBSCRIBE BEFORE REPLAYING — otherwise a `recordIntercept` call
  // that fires between the snapshot iteration and `add(res)` would
  // miss this subscriber. Snapshot the ring inline (cheap) and write
  // it after we're in the subscriber set; any live events that arrive
  // during the replay window are double-delivered (subscriber sees
  // them via both the snapshot and the live push), but every entry
  // carries a unique `ts`, so the UI dedupes naturally.
  app.get("/api/intercepts/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    sseSubscribers.add(res);
    req.on("close", () => {
      sseSubscribers.delete(res);
    });

    const snapshot = intercepts.slice();
    for (const entry of snapshot) {
      res.write(`event: intercept\ndata: ${JSON.stringify(entry)}\n\n`);
    }
  });

  // ---------- headless render (regression smoke + test harness) ----------
  app.post("/__test/render", async (req, res) => {
    const {
      toolName,
      args = {},
      argsExplicit = false,
      timeoutMs = 60_000,
      headless = true,
    } = req.body ?? {};
    if (typeof toolName !== "string") {
      return res.status(400).json({ error: "toolName required" });
    }
    try {
      const result = await runHeadlessRender({
        hostBaseUrl: `http://localhost:${listenedPort}`,
        toolName,
        args,
        argsExplicit,
        timeoutMs,
        headless,
      });
      res.json(result);
    } catch (e) {
      res
        .status(500)
        .json({ error: String(e instanceof Error ? e.message : e) });
    }
  });

  // ---------- listen ----------
  await new Promise((resolve, reject) => {
    const httpServer = app.listen(port, (err) => {
      if (err) return reject(err);
      const addr = httpServer.address();
      if (typeof addr === "object" && addr) listenedPort = addr.port;
      resolve();
    });
  });

  return {
    port: listenedPort,
    pluginSlug: client.pluginSlug,
    fixturesRoot: client.fixturesRoot,
    getIntercepts: () => intercepts.slice(),
    shutdown: async () => {
      for (const res of sseSubscribers) {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
      sseSubscribers.clear();
      try {
        client.close();
      } catch {
        // ignore
      }
    },
  };
}
