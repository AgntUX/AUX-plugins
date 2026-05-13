import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const PLUGIN_NAME = "agntux-teams";
const PLUGIN_VERSION = "0.1.0";

// Per the P3 v2 no-escalation-no-tools policy, agntux-teams ships ZERO MCP
// tools. All team-coordination work runs in the /agntux-teams skill body
// (skills/agntux-teams/SKILL.md + reference/*.md), audited by the PreToolUse
// `validate-team-write-lane` hook and the PostToolUse `maintain-team-index`
// hook.
//
// This minimal server exists so the plugin manifest's mcp_server entry is
// honored (Cowork hosts may expect at least an initialize-handshake
// surface) and so the plugin compiles + bundles uniformly with the rest of
// the ecosystem. The empty `tools: {}` capability is intentional and the
// ListTools handler returns the empty array.

const server = new Server(
  { name: PLUGIN_NAME, version: PLUGIN_VERSION },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [],
}));

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [],
}));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("agntux-teams MCP server failed to start:", err);
  process.exit(1);
});
