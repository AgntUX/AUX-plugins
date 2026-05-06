import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createLicenseGate } from "@agntux/mcp-license";
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

const PLUGIN_NAME = "agntux-gmail";
const PLUGIN_VERSION = "1.0.0";

const gate = createLicenseGate({
  pluginName: PLUGIN_NAME,
  pluginVersion: PLUGIN_VERSION,
});

const server = new Server(
  { name: PLUGIN_NAME, version: PLUGIN_VERSION },
  { capabilities: { resources: {}, tools: {} } },
);

// Tools surface (1.0.0+ tool name is prefixed with `agntux_gmail_` so it is
// unambiguous at the host's MCP routing layer):
//   - agntux_gmail_compose_view — invoked at click time. The host routes
//     `ux: ...open the email composer for action {id}` directly here. The
//     view tool reads the action file's `## Compose payload` body section
//     (pre-composed at ingest by skills/sync) and returns structuredContent
//     for ui://gmail-compose.
const TOOLS = {
  agntux_gmail_compose_view: {
    description: composeViewTool.description,
    inputSchema: composeViewTool.inputSchema,
    outputSchema: composeViewTool.outputSchema,
    _meta: composeViewTool._meta,
    handler: handleComposeView,
  },
} as const;

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: UI_RESOURCE_LIST,
}));

// resources/read is intentionally NOT gated; license enforcement runs only on
// tools/call. See agntux-core's index.ts for the rationale (concurrency race
// on first-pair creation + ReadResourceResult vs CallToolResult envelope
// shape mismatch).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  return (await handleUIResource(request.params.uri)) as any;
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: t.inputSchema,
    // Forward optional `outputSchema` and `_meta` so MCP Apps hosts can
    // (a) tell that structuredContent is iframe payload (outputSchema), and
    // (b) find the UI resource to render (_meta.ui.resourceUri).
    ...(("outputSchema" in t && (t as { outputSchema?: unknown }).outputSchema)
      ? { outputSchema: (t as { outputSchema: unknown }).outputSchema }
      : {}),
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
  const err = await gate.requireValidLicense({
    reason: "tools/call",
    toolName: request.params.name,
  });
  if (err) return err;
  const tool = TOOLS[request.params.name as keyof typeof TOOLS];
  if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await tool.handler(request.params.arguments ?? {})) as any;
});

// Default transport is stdio (host-spawned). HTTP_MODE=1 + PORT=<n> swaps
// in StreamableHTTPServerTransport so plugin-toolkit-test can connect a
// Chromium-driven MCPJam Inspector to this server.
if (process.env.HTTP_MODE === "1") {
  const port = Number.parseInt(process.env.PORT ?? "5190", 10);
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
      `[agntux-gmail mcp] HTTP_MODE listening on http://127.0.0.1:${port} (mcp at /mcp, health at /health)\n`,
    );
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
