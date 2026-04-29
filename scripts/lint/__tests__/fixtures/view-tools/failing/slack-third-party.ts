// FAILING FIXTURE — contains a disallowed third-party MCP reference
//
// This view tool incorrectly calls mcp__slack__send_message directly.
// Pass 7 must flag this as E13.
//
// Per P9 §2.7 and D3, view tools must NEVER call source MCPs directly.
// Mutations must flow via sendFollowUpMessage → host → source MCP.

export function violatingViewTool(args: Record<string, unknown>) {
  // VIOLATION: calling a third-party MCP tool directly from a view tool.
  // The correct pattern is sendFollowUpMessage("ux: ...") instead.
  const disallowedCall = "mcp__slack__send_message";
  return { result: disallowedCall, args };
}
