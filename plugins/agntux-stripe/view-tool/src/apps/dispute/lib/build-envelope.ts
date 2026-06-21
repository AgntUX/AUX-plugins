// build-envelope.ts — connector envelope for the Stripe dispute handler.
//
// Called from the dispute iframe's Submit Evidence button. Constructs a
// natural-language instruction the host's LLM executes via the Stripe
// Connector tool stripe_api_write targeting PostDisputesDispute.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper per canonical/prompts/ui/connector-envelopes.md.

const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native Stripe Connector UI for this call — " +
  "the user has already reviewed and confirmed the evidence via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX dispute composer either; the action is complete.";

export interface DisputeEnvelopeArgs {
  /** The Stripe dispute id (dp_xxx) */
  dispute_id: string;
  /** The evidence text the user has authored */
  evidence: string;
  /** Whether to submit immediately (true) or just save as draft (false) */
  submit: boolean;
  /** The source action id, for reference */
  action_id: string;
}

/** Escape guillemet delimiters inside user-authored text. */
function escapeBody(text: string): string {
  return text.replace(/«/g, '««').replace(/»/g, '»»');
}

/**
 * buildEnvelope — returns the connector-targeted envelope string for dispute evidence.
 *
 * The host resolves the Stripe Connector tool by display name and calls
 * stripe_api_write with operation_id PostDisputesDispute.
 */
export function buildEnvelope(args: DisputeEnvelopeArgs): string {
  const { dispute_id, evidence, submit, action_id } = args;
  const escapedEvidence = escapeBody(evidence);

  return (
    `Use the Stripe Connector to submit evidence for a Stripe dispute.\n` +
    `dispute_id: ${dispute_id}, submit: ${submit ? 'true' : 'false'}.\n` +
    `Call stripe_api_write with operation_id PostDisputesDispute, parameters: ` +
    `{ dispute: "${dispute_id}", evidence: { uncategorized_text: «${escapedEvidence}» }, submit: ${submit ? 'true' : 'false'} }. ` +
    `(action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
