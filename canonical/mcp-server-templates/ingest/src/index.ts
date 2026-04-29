import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { handleUIResource, UI_RESOURCE_URIS } from "./ui-resources.js";
import { viewToolDescriptor, handleViewTool } from "./tools/_view-tool-template.js";

// {{plugin-slug}}-ui — the plugin's local stdio MCP server.
// Serves ui:// resources via resources/read and exposes stateless view tools
// per P9 §4–§6. The generator (P6) substitutes {{plugin-slug}} from the manifest.
//
// Per P9 D2: this server has NO send tools, NO transition tools, NO comment tools.
// All state-mutating actions flow through the component's sendFollowUpMessage →
// host main loop → source MCP (P9 §8). The only plugin-side custom tools are
// view tools (one per UI component).
const server = new Server(
  { name: "{{plugin-slug}}-ui", version: "{{plugin-version}}" },
  { capabilities: { resources: {}, tools: {} } }
);

// View tools — one per UI component this plugin ships.
// The generator adds additional entries here, one per UI component.
// Naming convention: {verb_root}_view per P9 D2; ^[a-z][a-z0-9_]*_view$ enforced by linter T23.
const VIEW_TOOLS = {
  // {{ui-name}}_view is the template placeholder; the generator substitutes
  // concrete names (e.g., thread_view, channel_summary_view).
  [viewToolDescriptor.name]: {
    description: viewToolDescriptor.description,
    inputSchema: viewToolDescriptor.inputSchema,
    handler: handleViewTool,
  },
};

// resources/list — enumerate every ui:// resource this server serves.
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: UI_RESOURCE_URIS.map((uri) => ({
    uri,
    name: uri.replace("ui://", ""),
    mimeType: "text/html;profile=mcp-app",
  })),
}));

// resources/read — fetch and return the HTML bundle for a ui:// URI.
// Returns a structured error (never throws) when the URI is unknown or the
// S3 fetch fails, per P2a §4 / T17 pattern.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<any> => {
  return handleUIResource(request.params.uri);
});

// tools/list — enumerate all view tools.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(VIEW_TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

// tools/call — dispatch to the matching view tool.
// Unknown tool name → structured error (never throws).
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = (VIEW_TOOLS as Record<string, typeof VIEW_TOOLS[keyof typeof VIEW_TOOLS]>)[request.params.name];
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
    };
  }
  return tool.handler(request.params.arguments ?? {});
});

const transport = new StdioServerTransport();
await server.connect(transport);
