// build-envelope.ts — connector envelope for the Stripe refund handler.
//
// Called from the refund iframe's Confirm button. Constructs a
// natural-language instruction the host's LLM executes via the Stripe
// Connector tool mcp__8e4b8d3c-987a-4d48-a040-55e9abaf4aed__create_refund.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper per canonical/prompts/ui/connector-envelopes.md.

const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native Stripe Connector UI for this call — " +
  "the user has already reviewed and confirmed the refund via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX refund composer either; the action is complete.";

export interface RefundEnvelopeArgs {
  /** The payment intent id to refund against */
  payment_intent_id: string;
  /** Amount to refund, in minor units (e.g. cents) */
  amount: number;
  /** ISO 4217 currency code */
  currency: string;
  /** Refund reason: duplicate | fraudulent | requested_by_customer */
  reason: string;
  /** The source action id, for reference */
  action_id: string;
}

/**
 * buildEnvelope — returns the connector-targeted envelope string for a refund.
 *
 * The host resolves the Stripe Connector tool by display name and executes
 * create_refund with the supplied arguments.
 */
export function buildEnvelope(args: RefundEnvelopeArgs): string {
  const { payment_intent_id, amount, currency, reason, action_id } = args;

  return (
    `Use the Stripe Connector to issue a refund on a Stripe payment.\n` +
    `payment_intent: ${payment_intent_id}, amount: ${amount}, currency: ${currency.toUpperCase()}, reason: ${reason}.\n` +
    `Call create_refund with those arguments exactly. (action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
