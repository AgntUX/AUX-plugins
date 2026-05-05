import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { handleUIResource, UI_RESOURCE_LIST } from "./ui-resources.js";
import { snoozeTool } from "./tools/snooze.js";
import { dismissTool } from "./tools/dismiss.js";
import { setStatusTool } from "./tools/set-status.js";
import { triageViewTool, handleTriageView } from "./tools/triage-view.js";

const server = new Server(
  { name: "agntux-core", version: "5.0.0" },
  { capabilities: { resources: {}, tools: {} } },
);

// Tools surface:
//   - snooze, dismiss, set_status — invoked by the triage component via
//     useAppsClient().callTool() for inline mutations. NOT routed through
//     the LLM, so their args are component-supplied and effectively free.
//   - triage_view — invoked by the host's agent loop in response to
//     `/agntux-triage` (or any of the routed verb phrases). Returns the
//     structuredContent payload for ui://triage.
const TOOLS = {
  snooze: { ...snoozeTool, handler: snoozeTool.handler },
  dismiss: { ...dismissTool, handler: dismissTool.handler },
  set_status: { ...setStatusTool, handler: setStatusTool.handler },
  triage_view: {
    description: triageViewTool.description,
    inputSchema: triageViewTool.inputSchema,
    _meta: triageViewTool._meta,
    handler: handleTriageView,
  },
} as const;

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: UI_RESOURCE_LIST,
}));

// Per P2a §4 — resources/read returns either a successful ReadResourceResult
// OR a structured error (`{ isError: true, contents: [...] }`) when the bundle
// has not been embedded or fails to decode. The SDK's ReadResourceResultSchema
// does not currently expose `isError` in its inferred TS type, so the union
// we return is wider than the schema's inferred output type. The SDK runtime
// forwards our envelope unchanged. Until upstream adds `isError`, keep the
// cast scoped to this single line.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
  (await handleUIResource(request.params.uri)) as any,
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: t.inputSchema,
    // Surface optional `_meta` (e.g., `_meta.ui.resourceUri` for MCP Apps
    // hosts like MCPJam Inspector that key UI rendering off the tool
    // descriptor, not the tool result).
    ...(("_meta" in t && (t as { _meta?: unknown })._meta)
      ? { _meta: (t as { _meta: unknown })._meta }
      : {}),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS[request.params.name as keyof typeof TOOLS];
  if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);
  return tool.handler(request.params.arguments ?? {});
});

// Default transport is stdio (host-spawned). HTTP_MODE=1 + PORT=<n> swaps
// in StreamableHTTPServerTransport so plugin-toolkit-test can connect a
// Chromium-driven MCPJam Inspector to this server.
//
// We use STATEFUL mode (sessionIdGenerator returns a UUID) because MCPJam's
// StreamableHTTPClientTransport opens a GET stream after initialize to
// receive server-initiated notifications. The SDK's stateless mode rejects
// that GET with HTTP 500, which forces MCPJam to fall back to SSE — and
// SSE on the same /mcp endpoint isn't implemented here. Stateful mode is
// fine for local UI testing.
if (process.env.HTTP_MODE === "1") {
  const port = Number.parseInt(process.env.PORT ?? "5170", 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`HTTP_MODE: invalid PORT '${process.env.PORT}'`);
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);

  const httpServer = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/healthz")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    if (req.url?.startsWith("/mcp")) {
      // Buffer the body before handing to the SDK's handleRequest so it can
      // parse JSON-RPC messages.
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: unknown;
        try { body = raw ? JSON.parse(raw) : undefined; }
        catch { body = undefined; }
        void transport.handleRequest(req, res, body);
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end('{"error":"not found"}');
  });

  httpServer.listen(port, "127.0.0.1", () => {
    process.stderr.write(
      `[agntux-core mcp] HTTP_MODE listening on http://127.0.0.1:${port} (mcp at /mcp, health at /health)\n`,
    );
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
