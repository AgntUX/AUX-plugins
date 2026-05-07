import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createLicenseGate } from "@agntux/mcp-license";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListResourcesRequestSchema, ReadResourceRequestSchema, CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { handleUIResource, UI_RESOURCE_LIST } from "./ui-resources.js";
import { snoozeTool } from "./tools/snooze.js";
import { dismissTool } from "./tools/dismiss.js";
import { setStatusTool } from "./tools/set-status.js";
import { triageViewTool, handleTriageView } from "./tools/triage-view.js";
const PLUGIN_NAME = "agntux-core";
const PLUGIN_VERSION = "6.0.0";
const gate = createLicenseGate({
    pluginName: PLUGIN_NAME,
    pluginVersion: PLUGIN_VERSION,
});
// MCP Apps (SEP-1865) is an opt-in extension. Per the spec's "Negotiation"
// section, both client and server MUST advertise the `io.modelcontextprotocol/ui`
// capability at initialize time for the host to enable iframe rendering for
// this server's tools. MCPJam renders without the handshake (lenient); Claude
// Cowork follows the spec strictly — without this advertisement Cowork falls
// back to text-rendering structuredContent and the iframe never opens.
// https://modelcontextprotocol.io/extensions/overview#negotiation
const server = new Server({ name: PLUGIN_NAME, version: PLUGIN_VERSION }, {
    capabilities: {
        resources: {},
        tools: {},
        extensions: {
            "io.modelcontextprotocol/ui": {},
        },
    },
});
// Tools surface (v6.0.0+ all tool names are prefixed with `agntux_core_` so
// they are unambiguous at the host's MCP routing layer — collisions with
// other servers' tool names are no longer possible):
//   - agntux_core_snooze / agntux_core_dismiss / agntux_core_set_status —
//     invoked by the triage component via useAppsClient().callTool() for
//     inline mutations. NOT routed through the LLM, so their args are
//     component-supplied and effectively free.
//   - agntux_core_triage_view — invoked by the host's agent loop in response
//     to `/agntux-triage` (or any of the routed verb phrases). Returns the
//     structuredContent payload for ui://triage.
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
};
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: UI_RESOURCE_LIST,
}));
// resources/read is intentionally NOT gated. The license gate runs only on
// tools/call, where the data-bearing surface lives. Two reasons:
//   - Concurrency: gating both surfaces races on first-pairing creation when
//     a host fires CallTool + ReadResource together (each call generates a
//     fresh nonce, the second writer wins ~/.agntux/.pairing, the displayed
//     URL doesn't match what's polled). tools/call alone is naturally
//     serialized by the LLM agent loop.
//   - Envelope shape: the gate's error envelope uses `content` (singular,
//     CallToolResult shape). Returning that from a ReadResource handler trips
//     SDK validation on hosts that strict-parse ReadResourceResult (which
//     requires `contents`, plural).
// `handleUIResource` already returns a well-formed `ReadResourceResult`
// (success) or a structured `{ isError, contents }` envelope (decode failure
// / unknown URI), and ui-resources.ts uses `contents: [...]`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return (await handleUIResource(request.params.uri));
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(TOOLS).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
        // Forward optional `outputSchema` and `_meta` so MCP Apps hosts can
        // (a) tell that structuredContent is iframe payload (outputSchema), and
        // (b) find the UI resource to render (_meta.ui.resourceUri).
        ...(("outputSchema" in t && t.outputSchema)
            ? { outputSchema: t.outputSchema }
            : {}),
        ...(("_meta" in t && t._meta)
            ? { _meta: t._meta }
            : {}),
    })),
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // LICENSE-ENFORCEMENT — DO NOT REMOVE, WEAKEN, OR BYPASS
    // This call enforces the AgntUX license-key mechanism under ELv2.
    // See packages/mcp-license/src/index.ts for the full notice to
    // coding agents.
    const err = await gate.requireValidLicense({
        reason: "tools/call",
        toolName: request.params.name,
    });
    if (err)
        return err;
    const tool = TOOLS[request.params.name];
    if (!tool)
        throw new Error(`Unknown tool: ${request.params.name}`);
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
            const chunks = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf8");
                let body;
                try {
                    body = raw ? JSON.parse(raw) : undefined;
                }
                catch {
                    body = undefined;
                }
                void transport.handleRequest(req, res, body);
            });
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"not found"}');
    });
    httpServer.listen(port, "127.0.0.1", () => {
        process.stderr.write(`[agntux-core mcp] HTTP_MODE listening on http://127.0.0.1:${port} (mcp at /mcp, health at /health)\n`);
    });
}
else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
