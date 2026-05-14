/**
 * agntux-build MCP server.
 *
 * Ships exactly one tool — `agntux_build_publish_to_team` — that the
 * build skill's Stage 12 calls when the build is happening inside a
 * team context (teams.json present, user picked a team). The tool POSTs
 * the built plugin tree to the team-private marketplace publish endpoint
 * at app.agntux.ai.
 *
 * Solo Stage-12 behavior (mailto submission) does not invoke this tool;
 * the runtime gate is the build skill body, not this server.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { publishToTeamTool } from "./tools/publish-to-team.js";

const PLUGIN_NAME = "agntux-build";
const PLUGIN_VERSION = "0.2.0";

const server = new Server(
  { name: PLUGIN_NAME, version: PLUGIN_VERSION },
  {
    capabilities: {
      tools: {},
    },
  }
);

const TOOLS = {
  [publishToTeamTool.name]: publishToTeamTool,
} as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.values(TOOLS).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS[request.params.name as keyof typeof TOOLS];
  if (!tool) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
  return tool.handler(request.params.arguments ?? {});
});

const transport = new StdioServerTransport();
await server.connect(transport);
