// FAILING FIXTURE — contains a disallowed Gmail MCP reference
//
// This view tool incorrectly calls mcp__gmail__send_email directly.
// Pass 7 must flag this as E13.

export function violatingGmailViewTool(args: Record<string, unknown>) {
  // VIOLATION: calling a third-party Gmail MCP tool directly.
  const disallowedCall = "mcp__gmail__send_email";
  return { result: disallowedCall, args };
}
