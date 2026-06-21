// build-envelope.ts — hand-built connector envelope for the experiment handler.
//
// Called from the experiment iframe's Send button handler. Constructs a
// natural-language instruction the host's LLM executes via the PostHog
// Connector tool for experiment-ship-variant.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper per canonical/prompts/ui/connector-envelopes.md.
//
// The envelope addresses the connector by display name ("PostHog Connector")
// so the host LLM resolves the tool regardless of UUID prefix or host type.
// Never embed a hard-coded mcp__<uuid>__<tool> literal in envelope prose —
// that throws MCP error -32602 on any host other than the one it was authored on.
//
// Args passed to experiment-ship-variant:
//   experiment_id: string  — the PostHog experiment identifier
//   variant_key: string    — the variant key to ship/roll out

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native PostHog Connector UI for this call — " +
  "the user has already confirmed the action via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX experiment UI; the action is complete.";

export interface ExperimentEnvelopeArgs {
  /** The PostHog experiment identifier */
  experiment_id: string;
  /** The variant key to ship as the winner */
  variant_key: string;
  /** Source action_id for reference */
  action_id: string;
}

/**
 * buildEnvelope — returns the connector-targeted envelope string.
 *
 * Shape:
 *   Use the PostHog Connector to ship the winning variant for experiment "{experiment_id}".
 *   experiment_id: "{experiment_id}", variant_key: "{variant_key}". (action_id: {action_id})
 */
export function buildEnvelope(args: ExperimentEnvelopeArgs): string {
  const { experiment_id, variant_key, action_id } = args;

  return (
    `Use the PostHog Connector to ship the winning variant for experiment "${experiment_id}".\n` +
    `experiment_id: "${experiment_id}", variant_key: "${variant_key}". (action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
