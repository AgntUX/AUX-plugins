// build-envelope.ts — hand-built connector envelope for the resolve handler.
//
// Called from the resolve iframe's Send button handler. Constructs a
// natural-language instruction the host's LLM executes via the PostHog
// Connector tool for error-tracking-issues-partial-update.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper per canonical/prompts/ui/connector-envelopes.md.
//
// The envelope addresses the connector by display name ("PostHog Connector")
// so the host LLM resolves the tool regardless of UUID prefix or host type.
// Never embed a hard-coded mcp__<uuid>__<tool> literal in envelope prose —
// that throws MCP error -32602 on any host other than the one it was authored on.
//
// Args passed to error-tracking-issues-partial-update:
//   issue_id: string      — the PostHog issue identifier
//   status: string        — "resolved" | "active" | "suppressed"
//   assignee_id: string   — the assignee user identifier (omitted when empty)

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native PostHog Connector UI for this call — " +
  "the user has already confirmed the action via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX resolve UI; the action is complete.";

export interface ResolveEnvelopeArgs {
  /** The PostHog error issue identifier */
  issue_id: string;
  /** New status: "resolved" | "active" | "suppressed" */
  status: string;
  /** Assignee user identifier (may be empty to leave unchanged) */
  assignee_id: string;
  /** Source action_id for reference */
  action_id: string;
}

/**
 * buildEnvelope — returns the connector-targeted envelope string.
 *
 * Shape:
 *   Use the PostHog Connector to update error tracking issue "{issue_id}".
 *   issue_id: "{issue_id}", status: "{status}"[, assignee_id: "{assignee_id}"].
 *   (action_id: {action_id})
 */
export function buildEnvelope(args: ResolveEnvelopeArgs): string {
  const { issue_id, status, assignee_id, action_id } = args;

  const assigneeClause =
    assignee_id.trim().length > 0
      ? `, assignee_id: "${assignee_id.trim()}"`
      : "";

  return (
    `Use the PostHog Connector to update error tracking issue "${issue_id}".\n` +
    `issue_id: "${issue_id}", status: "${status}"${assigneeClause}. (action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
