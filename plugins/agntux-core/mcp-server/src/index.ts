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

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return handleUIResource(request.params.uri) as any;
});

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
