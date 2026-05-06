import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createLicenseGate } from "@agntux/mcp-license";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListResourcesRequestSchema, ReadResourceRequestSchema, CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { handleUIResource, UI_RESOURCE_LIST } from "./ui-resources.js";
import { composeViewTool, handleComposeView } from "./tools/compose-view.js";
import { canvasViewTool, handleCanvasView } from "./tools/canvas-view.js";
const PLUGIN_NAME = "agntux-slack";
const PLUGIN_VERSION = "4.0.0";
const gate = createLicenseGate({
    pluginName: PLUGIN_NAME,
    pluginVersion: PLUGIN_VERSION,
});
const server = new Server({ name: PLUGIN_NAME, version: PLUGIN_VERSION }, { capabilities: { resources: {}, tools: {} } });
// Tools surface (v4.0.0+ all tool names are prefixed with `agntux_slack_`
// so they are unambiguous at the host's MCP routing layer — collisions
// with other servers' tool names are no longer possible):
//   - agntux_slack_compose_view — invoked by the draft skill after composing
//     a Slack reply draft. Returns structuredContent for ui://slack-compose.
//   - agntux_slack_canvas_view — invoked by the draft skill after composing
//     canvas sections. Returns structuredContent for ui://slack-canvas.
const TOOLS = {
    agntux_slack_compose_view: {
        description: composeViewTool.description,
        inputSchema: composeViewTool.inputSchema,
        _meta: composeViewTool._meta,
        handler: handleComposeView,
    },
    agntux_slack_canvas_view: {
        description: canvasViewTool.description,
        inputSchema: canvasViewTool.inputSchema,
        _meta: canvasViewTool._meta,
        handler: handleCanvasView,
    },
};
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: UI_RESOURCE_LIST,
}));
// resources/read is intentionally NOT gated; license enforcement runs only on
// tools/call. See agntux-core's index.ts for the rationale (concurrency race
// on first-pair creation + ReadResourceResult vs CallToolResult envelope
// shape mismatch).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return (await handleUIResource(request.params.uri));
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(TOOLS).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(("_meta" in t && t._meta)
            ? { _meta: t._meta }
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
    if (err)
        return err;
    const tool = TOOLS[request.params.name];
    if (!tool)
        throw new Error(`Unknown tool: ${request.params.name}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await tool.handler(request.params.arguments ?? {}));
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
        process.stderr.write(`[agntux-slack mcp] HTTP_MODE listening on http://127.0.0.1:${port} (mcp at /mcp, health at /health)\n`);
    });
}
else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
//# sourceMappingURL=index.js.map