// =============================================================================
// build-envelope.ts — constructs the connector-targeted envelope for the
// DocuSign void view.
//
// Target connector tool: updateEnvelope
// Args:  { accountId, envelopeId, envelopeUpdate: { status: "voided", voidedReason: <reason> } }
//
// Wire shape (sendFollowUpMessage argument):
//   "Use the DocuSign Connector to void the envelope.
//   accountId: {accountId}, envelopeId: {envelopeId}.
//   Use updateEnvelope with envelopeUpdate status: voided,
//   voidedReason: «{reason}». ({meta})
//   {NO_NATIVE_UI_DIRECTIVE}"
// =============================================================================

/**
 * Native-UI suppression directive — appended to every connector-targeted
 * envelope. Instructs the host to:
 *   1. Execute the connector tool programmatically and return its
 *      success/error to chat as plain text.
 *   2. NOT render any of the connector's own MCP App UI for this call —
 *      the user already filled in the form via the AgntUX iframe and the
 *      data is final.
 *   3. NOT re-render the AgntUX void UI either; the action is complete.
 */
const NO_NATIVE_UI_DIRECTIVE =
  `Execute the connector tool programmatically and return the result as plain text. ` +
  `Do NOT render the DocuSign Connector's native MCP App UI for this call — ` +
  `the user already confirmed the action via the AgntUX iframe. ` +
  `Do NOT re-render the AgntUX void UI; the action is complete.`;

/** Escape guillemet delimiters in user-authored body content. */
function escapeBody(text: string): string {
  return text.replace(/«/g, '««').replace(/»/g, '»»');
}

export interface VoidEnvelopeArgs {
  accountId: string;
  envelopeId: string;
  /** The required void reason — recipients will see this. */
  voidedReason: string;
}

/**
 * buildEnvelope — builds the connector-targeted prose envelope for updateEnvelope (void).
 *
 * Passed verbatim to client.sendFollowUpMessage(). The host's LLM resolves
 * the DocuSign Connector and calls updateEnvelope with the inline args.
 *
 * voidedReason is REQUIRED; callers must guard that it is non-empty before
 * calling this function (the UI disables the Send button when the field is empty).
 */
export function buildEnvelope({ accountId, envelopeId, voidedReason }: VoidEnvelopeArgs): string {
  const escaped = escapeBody(voidedReason.trim());
  const meta = `accountId: ${accountId}, envelopeId: ${envelopeId}`;

  return (
    `Use the DocuSign Connector to void the envelope.\n` +
    `accountId: ${accountId}, envelopeId: ${envelopeId}.\n` +
    `Use updateEnvelope with envelopeUpdate status: voided, ` +
    `voidedReason: «${escaped}». ` +
    `All recipients will be notified with the void reason. (${meta})\n` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
