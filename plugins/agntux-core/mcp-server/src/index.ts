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
import { syncInstalledPluginsTool } from "./tools/sync-installed-plugins.js";

const PLUGIN_NAME = "agntux-core";
const PLUGIN_VERSION = "10.0.0";

// MCP Apps (SEP-1865) is an opt-in extension. Per the spec's "Negotiation"
// section, both client and server MUST advertise the `io.modelcontextprotocol/ui`
// capability at initialize time for the host to enable iframe rendering for
// this server's tools. MCPJam renders without the handshake (lenient); Claude
// Cowork follows the spec strictly — without this advertisement Cowork falls
// back to text-rendering structuredContent and the iframe never opens.
// https://modelcontextprotocol.io/extensions/overview#negotiation
const server = new Server(
  { name: PLUGIN_NAME, version: PLUGIN_VERSION },
  {
    capabilities: {
      resources: {},
      tools: {},
      extensions: {
        "io.modelcontextprotocol/ui": {},
      },
    },
  },
);

// Tools surface — 10.0.0:
//
//   The view-tool / triage mutation tools (`agntux_core_snooze`,
//   `agntux_core_dismiss`, `agntux_core_set_status`,
//   `agntux_core_save_triage_prefs`, `agntux_core_set_triage_pref`) have
//   MOVED to `view-tool/dist/agntux-core-view.js` under the new
//   manifest `mutation_tools[]` shape. The remote MCP server in
//   agntux/app registers them on `tools/list`, dispatches via the
//   same handler map as `agntux_core_triage_view`, and writes through
//   `ctx.fs.update()` (CAS-guarded via `team_sync_push_entry`). An
//   SSE event fans out to the user's agntux-teams daemons so the
//   resulting on-disk change lands within ~1s.
//
//   This local stdio server retains exactly ONE tool —
//   `agntux_core_sync_installed_plugins`. It's HOME-scoped (writes
//   `~/.agntux/installed-plugins.json`, not project data), and the
//   agntux-teams daemon watches that file via chokidar.
const TOOLS = {
  agntux_core_sync_installed_plugins: {
    ...syncInstalledPluginsTool,
    handler: syncInstalledPluginsTool.handler,
  },
} as const;

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: UI_RESOURCE_LIST,
}));

// `handleUIResource` returns a well-formed `ReadResourceResult` (success) or
// a structured `{ isError, contents }` envelope (decode failure / unknown
// URI). ui-resources.ts uses `contents: [...]`.
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
