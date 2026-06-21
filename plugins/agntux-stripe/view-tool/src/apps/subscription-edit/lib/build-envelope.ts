// build-envelope.ts — connector envelope for the Stripe subscription-edit handler.
//
// Called from the subscription-edit iframe's Confirm button. Constructs a
// natural-language instruction the host's LLM executes via the Stripe
// Connector tool stripe_api_write targeting PostSubscriptionsSubscriptionExposedId.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper per canonical/prompts/ui/connector-envelopes.md.

const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native Stripe Connector UI for this call — " +
  "the user has already reviewed and confirmed the subscription change via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX subscription composer either; the action is complete.";

export type SubscriptionEditMode = 'pause' | 'update';

export interface SubscriptionEditEnvelopeArgs {
  /** The Stripe subscription id (sub_xxx) */
  subscription_id: string;
  /** Edit mode: pause collection or update plan/quantity */
  mode: SubscriptionEditMode;
  /** New quantity (update mode only; omit for pause) */
  new_quantity?: number;
  /** New price id (update mode only; omit for pause) */
  new_price_id?: string;
  /**
   * Pause mode only: ISO-8601 date (YYYY-MM-DD) on which billing should resume.
   * Converted to a Unix epoch and passed as pause_collection.resumes_at.
   * Omit to pause indefinitely.
   */
  resume_at_date?: string;
  /** The source action id, for reference */
  action_id: string;
}

/**
 * buildEnvelope — returns the connector-targeted envelope string for subscription edit.
 *
 * Pause mode sets pause_collection.behavior = mark_uncollectible and optionally
 * resumes_at if resume_at_date is provided.
 * Update mode changes quantity and/or plan (price id).
 */
export function buildEnvelope(args: SubscriptionEditEnvelopeArgs): string {
  const { subscription_id, mode, new_quantity, new_price_id, resume_at_date, action_id } = args;

  let paramStr: string;
  if (mode === 'pause') {
    const pauseParts: string[] = [`behavior: "mark_uncollectible"`];
    if (resume_at_date) {
      // Convert YYYY-MM-DD to Unix epoch (midnight UTC)
      const epoch = Math.floor(new Date(resume_at_date + 'T00:00:00Z').getTime() / 1000);
      if (!isNaN(epoch)) {
        pauseParts.push(`resumes_at: ${epoch}`);
      }
    }
    paramStr =
      `{ subscription: "${subscription_id}", pause_collection: { ${pauseParts.join(', ')} } }`;
  } else {
    const parts: string[] = [`subscription: "${subscription_id}"`];
    if (new_quantity !== undefined && new_quantity > 0) {
      parts.push(`quantity: ${new_quantity}`);
    }
    if (new_price_id) {
      parts.push(`items: [{ price: "${new_price_id}" }]`);
    }
    paramStr = `{ ${parts.join(', ')} }`;
  }

  const modeLabel = mode === 'pause' ? 'pause collection on' : 'update';

  return (
    `Use the Stripe Connector to ${modeLabel} a Stripe subscription.\n` +
    `subscription_id: ${subscription_id}.\n` +
    `Call stripe_api_write with operation_id PostSubscriptionsSubscriptionExposedId, parameters: ${paramStr}. ` +
    `(action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
