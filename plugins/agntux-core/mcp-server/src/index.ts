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
import { triagePrefsTool, setTriagePrefTool } from "./tools/triage-prefs.js";

const PLUGIN_NAME = "agntux-core";
const PLUGIN_VERSION = "9.3.0";

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

// Tools surface (v6.0.0+ all tool names are prefixed with `agntux_core_` so
// they are unambiguous at the host's MCP routing layer — collisions with
// other servers' tool names are no longer possible):
//   - agntux_core_snooze / agntux_core_dismiss / agntux_core_set_status —
//     invoked by the triage component via useAppsClient().callTool() for
//     inline mutations. NOT routed through the LLM, so their args are
//     component-supplied and effectively free. Team-mode (P3 v2) callers
//     pass an optional `team_slug` or `view_slug` to route the mutation
//     to the matching team / leader-view actions/ directory.
//   - agntux_core_triage_view — invoked by the host's agent loop in response
//     to `/agntux triage-digest` (or any of the routed verb phrases). Returns the
//     structuredContent payload for ui://triage. Solo output is byte-identical
//     to the prior release when `<root>/.agntux/teams.json` is absent.
//   - agntux_core_save_triage_prefs — invoked by the triage component when
//     the user toggles a team / leader-view filter chip, a relevance-class
//     chip, the sort dropdown, or the show-done/snoozed/dismissed toggles.
//     Persists state to `<root>/.agntux/triage-prefs.json` (v2 schema as
//     of 9.3.0 / P9). MERGES patch fields into the existing file — the
//     UI can patch a single key without re-sending the whole state. NOT
//     user-facing.
//   - agntux_core_set_triage_pref — P9 (9.3.0). Invoked by the triage
//     component when the user snoozes or dismisses a specific action
//     row. Writes the entry to `triage_state[<relative_path>]` in
//     triage-prefs.json. Personal: the action file itself is untouched
//     so the team's view of the item is unchanged. NOT user-facing.
const TOOLS = {
  agntux_core_snooze: { ...snoozeTool, handler: snoozeTool.handler },
  agntux_core_dismiss: { ...dismissTool, handler: dismissTool.handler },
  agntux_core_set_status: { ...setStatusTool, handler: setStatusTool.handler },
  agntux_core_triage_view: {
    description: triageViewTool.description,
    inputSchema: triageViewTool.inputSchema,
    outputSchema: triageViewTool.outputSchema,
    _meta: triageViewTool._meta,
    handler: handleTriageView,
  },
  agntux_core_save_triage_prefs: {
    ...triagePrefsTool,
    handler: triagePrefsTool.handler,
  },
  agntux_core_set_triage_pref: {
    ...setTriagePrefTool,
    handler: setTriagePrefTool.handler,
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
