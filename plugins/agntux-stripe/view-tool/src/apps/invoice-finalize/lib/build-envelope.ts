// build-envelope.ts — connector envelope for the Stripe invoice-finalize handler.
//
// Called from the invoice-finalize iframe's Confirm button. Constructs a
// natural-language instruction the host's LLM executes via the Stripe
// Connector tool stripe_api_write targeting PostInvoicesInvoiceFinalize.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper per canonical/prompts/ui/connector-envelopes.md.

const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native Stripe Connector UI for this call — " +
  "the user has already reviewed and confirmed the finalization via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX invoice composer either; the action is complete.";

export interface InvoiceFinalizeEnvelopeArgs {
  /** The Stripe invoice id (in_xxx) */
  invoice_id: string;
  /** Human-readable invoice number for confirmation */
  invoice_number: string;
  /** The source action id, for reference */
  action_id: string;
}

/**
 * buildEnvelope — returns the connector-targeted envelope string for invoice finalization.
 *
 * The host resolves the Stripe Connector tool by display name and calls
 * stripe_api_write with operation_id PostInvoicesInvoiceFinalize.
 */
export function buildEnvelope(args: InvoiceFinalizeEnvelopeArgs): string {
  const { invoice_id, invoice_number, action_id } = args;

  return (
    `Use the Stripe Connector to finalize a Stripe invoice.\n` +
    `invoice_id: ${invoice_id}${invoice_number ? ` (${invoice_number})` : ''}.\n` +
    `Call stripe_api_write with operation_id PostInvoicesInvoiceFinalize, parameters: { invoice: "${invoice_id}" }. ` +
    `(action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
