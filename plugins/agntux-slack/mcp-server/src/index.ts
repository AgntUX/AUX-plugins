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
import { composeViewTool, handleComposeView } from "./tools/compose-view.js";
import { canvasViewTool, handleCanvasView } from "./tools/canvas-view.js";

const server = new Server(
  { name: "agntux-slack", version: "0.1.0" },
  { capabilities: { resources: {}, tools: {} } },
);

// Tools surface:
//   - compose_view — invoked by the draft skill after composing a Slack reply
//     draft. Returns structuredContent for ui://slack-compose.
//   - canvas_view  — invoked by the draft skill after composing canvas sections.
//     Returns structuredContent for ui://slack-canvas.
const TOOLS = {
  compose_view: {
    description: composeViewTool.description,
    inputSchema: composeViewTool.inputSchema,
    _meta: composeViewTool._meta,
    handler: handleComposeView,
  },
  canvas_view: {
    description: canvasViewTool.description,
    inputSchema: canvasViewTool.inputSchema,
    _meta: canvasViewTool._meta,
    handler: handleCanvasView,
  },
} as const;

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: UI_RESOURCE_LIST,
}));

// Per P2a §4 — resources/read returns either a successful ReadResourceResult
// OR a structured error (`{ isError: true, contents: [...] }`) when the bundle
// has not been embedded or fails to decode. Cast is scoped to this line only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
  (await handleUIResource(request.params.uri)) as any,
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: t.inputSchema,
    ...(("_meta" in t && (t as { _meta?: unknown })._meta)
      ? { _meta: (t as { _meta: unknown })._meta }
      : {}),
  })),
}));

// Our view-tool result type is structurally compatible with the SDK's
// ServerResult but TypeScript can't verify the intersection because the SDK's
// task field is a required discriminant in one union member that our type
// doesn't declare. Same cast pattern as the ReadResource handler above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS[request.params.name as keyof typeof TOOLS];
  if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await tool.handler(request.params.arguments ?? {})) as any;
});

// Default transport is stdio (host-spawned). HTTP_MODE=1 + PORT=<n> swaps
// in StreamableHTTPServerTransport so plugin-toolkit-test can connect a
// Chromium-driven MCPJam Inspector to this server.
if (process.env.HTTP_MODE === "1") {
  const port = Number.parseInt(process.env.PORT ?? "5180", 10);
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
      `[agntux-slack mcp] HTTP_MODE listening on http://127.0.0.1:${port} (mcp at /mcp, health at /health)\n`,
    );
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
