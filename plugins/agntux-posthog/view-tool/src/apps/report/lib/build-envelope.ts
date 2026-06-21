// build-envelope.ts — hand-built connector envelope for the report handler.
//
// Called from the report iframe's Send button handler. Constructs a
// natural-language instruction the host's LLM executes via the PostHog
// Connector tool for inbox-reports-set-state.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper per canonical/prompts/ui/connector-envelopes.md.
//
// The envelope addresses the connector by display name ("PostHog Connector")
// so the host LLM resolves the tool regardless of UUID prefix or host type.
// Never embed a hard-coded mcp__<uuid>__<tool> literal in envelope prose —
// that throws MCP error -32602 on any host other than the one it was authored on.
//
// Args passed to inbox-reports-set-state:
//   report_id: string  — the PostHog inbox report identifier
//   state: string      — "resolved" | "archived"

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native PostHog Connector UI for this call — " +
  "the user has already confirmed the action via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX report UI; the action is complete.";

export interface ReportEnvelopeArgs {
  /** The PostHog inbox report identifier */
  report_id: string;
  /** New state: "resolved" | "archived" */
  state: string;
  /** Source action_id for reference */
  action_id: string;
}

/**
 * buildEnvelope — returns the connector-targeted envelope string.
 *
 * Shape:
 *   Use the PostHog Connector to mark inbox report "{report_id}" as "{state}".
 *   report_id: "{report_id}", state: "{state}". (action_id: {action_id})
 */
export function buildEnvelope(args: ReportEnvelopeArgs): string {
  const { report_id, state, action_id } = args;

  return (
    `Use the PostHog Connector to mark inbox report "${report_id}" as "${state}".\n` +
    `report_id: "${report_id}", state: "${state}". (action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
