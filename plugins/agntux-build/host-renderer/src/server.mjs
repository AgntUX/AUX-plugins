// Express server. Two ports' worth of logic, fused into one app since
// we run inside a single plugin process — the host page and the
// sandbox iframe are served from the same origin pair via path
// routing rather than separate ports.
//
// Routes:
//   GET  /host.html         — host shell (foreground/dev only; 404 in --headless)
//   GET  /host-bridge.mjs   — client-side bridge module
//   GET  /sandbox.html      — sandbox-proxy with CSP from ?csp= query param
//   GET  /api/tool/:name    — read tool descriptor (incl. _meta.ui)
//   POST /api/tool-call     — proxy a tool call to the plugin's MCP
//   GET  /api/ui-resource   — fetch the UI resource HTML for a tool
//   POST /__test/render     — headless: drive a Playwright render and return artifacts
//
// All static files live under ../public/ relative to this file.

import express from "express";
import cors from "cors";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCspHeader } from "./csp.mjs";
import { spawnPluginMcp, connectClient, callToolWithUi } from "./mcp-bridge.mjs";
import { runHeadlessRender } from "./playwright-driver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

export async function startServer({
  pluginRoot,
  port = 0,
  headless = false,
}) {
  // Hoisted at the top because `/__test/render` reads it inside its
  // closure. The closure is only invoked after `app.listen()` resolves
  // and assigns the real port, but declaring up-front makes the data
  // flow obvious on read.
  let listenedPort = port;

  // Spawn the plugin MCP up-front so the foreground host page can call
  // tools immediately. In headless mode we do the same so /__test/render
  // is fast on the first call.
  const mcp = await spawnPluginMcp(pluginRoot);
  const client = await connectClient(mcp.url);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  // ---------- static (always served — Playwright also loads host.html in headless) ----------
  app.get("/host.html", (_req, res) => {
    res.sendFile(join(PUBLIC_DIR, "host.html"));
  });
  app.get("/host-bridge.mjs", (_req, res) => {
    res.type("application/javascript");
    res.sendFile(join(PUBLIC_DIR, "host-bridge.mjs"));
  });

  // ---------- sandbox (always served — even in headless, Playwright loads it) ----------
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
      res.status(500).json({ error: String(e) });
    }
  });

  app.post("/api/tool-call", async (req, res) => {
    const { name, args } = req.body ?? {};
    if (typeof name !== "string") {
      return res.status(400).json({ error: "name required" });
    }
    try {
      const out = await callToolWithUi(client, name, args ?? {});
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // ---------- headless render (test harness drives this) ----------
  app.post("/__test/render", async (req, res) => {
    const {
      toolName,
      args = {},
      argsExplicit = false,
      timeoutMs = 60_000,
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
    pluginMcpUrl: mcp.url,
    shutdown: async () => {
      try {
        await client.close();
      } catch {
        // ignore
      }
      mcp.kill();
    },
  };
}
