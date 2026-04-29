import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { handleUIResource } from "./ui-resources.js";
import { snoozeTool } from "./tools/snooze.js";
import { dismissTool } from "./tools/dismiss.js";
import { setStatusTool } from "./tools/set-status.js";
import { pivotTool } from "./tools/pivot.js";

const server = new Server(
  { name: "agntux-core", version: "1.0.0" },
  { capabilities: { resources: {}, tools: {} } }
);

const TOOLS = {
  snooze: snoozeTool,
  dismiss: dismissTool,
  set_status: setStatusTool,
  pivot: pivotTool,
};

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "ui://triage",
      name: "Action item triage view",
      mimeType: "text/html",
    },
    {
      uri: "ui://entity-browser",
      name: "Entity browser",
      mimeType: "text/html",
    },
  ],
}));

// Per P2a §4 — resources/read must return either a successful
// ReadResourceResult OR a structured error (`{ isError: true, contents: [...] }`)
// when the license cache is missing/malformed or the bundle fetch fails.
// The SDK's ReadResourceResultSchema does not currently expose `isError` in
// its inferred TS type, so the union we return is wider than the schema's
// inferred output type. The SDK runtime forwards our envelope unchanged
// (verified end-to-end by Phase 3 QA Layer 2 — see
// langgraph/plan-execution/qa/phase-3/layer-2-report.json). The cast below
// is a type-system workaround for that SDK schema gap; it does NOT widen
// runtime behavior. Track upstream: file an issue against
// @modelcontextprotocol/sdk to add `isError` to ReadResourceResultSchema
// (or document a separate channel for resource-fetch errors). Until then,
// keep the cast scoped to this single line and documented.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
  (await handleUIResource(request.params.uri)) as any,
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS[request.params.name as keyof typeof TOOLS];
  if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);
  return tool.handler(request.params.arguments ?? {});
});

const transport = new StdioServerTransport();
await server.connect(transport);
