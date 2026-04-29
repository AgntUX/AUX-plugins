// PASSING FIXTURE — own-plugin references only
//
// This file contains only references to the test-plugin's own MCP namespace.
// Pass 7 should accept these and produce zero E13 findings.

export const viewToolDescriptor = {
  name: "test_item_view",
  description: "Stateless view tool. No third-party MCP calls.",
};

// The plugin's own view tool — allowed.
// mcp__test-plugin__test_item_view is the own-plugin namespace.
export function handleTestItemView(args: Record<string, unknown>) {
  // This references own-plugin tools only — allowed by Pass 7.
  const ownRef = "mcp__test-plugin__test_item_view";
  const ownUiRef = "mcp__test-plugin-ui__test_item_view";
  return {
    structuredContent: { item_id: args["item_id"] ?? "" },
    ownRef,
    ownUiRef,
  };
}
