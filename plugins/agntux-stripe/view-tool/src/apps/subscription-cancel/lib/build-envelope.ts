// build-envelope.ts — connector envelope for the Stripe subscription-cancel handler.
//
// Called from the subscription-cancel iframe's Cancel Subscription button. Constructs a
// natural-language instruction the host's LLM executes via the Stripe
// Connector tool stripe_api_write.
//
// Two cancellation modes:
//   period_end  → PostSubscriptionsSubscriptionExposedId with cancel_at_period_end=true
//   immediately → DeleteSubscriptionsSubscriptionExposedId
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper per canonical/prompts/ui/connector-envelopes.md.

const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native Stripe Connector UI for this call — " +
  "the user has already reviewed and confirmed the cancellation via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX subscription composer either; the action is complete.";

export type CancelTiming = 'period_end' | 'immediately';

export interface SubscriptionCancelEnvelopeArgs {
  /** The Stripe subscription id (sub_xxx) */
  subscription_id: string;
  /** When to cancel: at end of billing period, or immediately */
  timing: CancelTiming;
  /** The source action id, for reference */
  action_id: string;
}

/**
 * buildEnvelope — returns the connector-targeted envelope string for subscription cancellation.
 *
 * period_end:  calls stripe_api_write with operation_id PostSubscriptionsSubscriptionExposedId
 *              and sets cancel_at_period_end=true.
 * immediately: calls stripe_api_write with operation_id DeleteSubscriptionsSubscriptionExposedId.
 */
export function buildEnvelope(args: SubscriptionCancelEnvelopeArgs): string {
  const { subscription_id, timing, action_id } = args;

  if (timing === 'period_end') {
    return (
      `Use the Stripe Connector to schedule a Stripe subscription cancellation at period end.\n` +
      `subscription_id: ${subscription_id}.\n` +
      `Call stripe_api_write with operation_id PostSubscriptionsSubscriptionExposedId, parameters: ` +
      `{ subscription: "${subscription_id}", cancel_at_period_end: true }. ` +
      `(action_id: ${action_id})\n` +
      `${NO_NATIVE_UI_DIRECTIVE}`
    );
  }

  return (
    `Use the Stripe Connector to cancel a Stripe subscription immediately. This action is irreversible.\n` +
    `subscription_id: ${subscription_id}.\n` +
    `Call stripe_api_write with operation_id DeleteSubscriptionsSubscriptionExposedId, parameters: ` +
    `{ subscription: "${subscription_id}" }. ` +
    `(action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
