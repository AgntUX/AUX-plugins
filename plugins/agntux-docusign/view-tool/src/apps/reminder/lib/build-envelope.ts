// =============================================================================
// build-envelope.ts — constructs the connector-targeted envelope for the
// DocuSign reminder view.
//
// Target connector tool: sendReminder
// Args:  { accountId, envelopeId, emailSubject?, emailBlurb? }
//   emailBlurb = the optional reminder message from the user.
//   emailSubject and emailBlurb are only included when the user provided them.
//
// Wire shape (sendFollowUpMessage argument):
//   "Use the DocuSign Connector to send a reminder to pending signers.
//   accountId: {accountId}, envelopeId: {envelopeId}.
//   Use sendReminder. ({meta})
//   {NO_NATIVE_UI_DIRECTIVE}"
//
// With optional message:
//   "Use the DocuSign Connector to send a reminder to pending signers.
//   accountId: {accountId}, envelopeId: {envelopeId}.
//   Use sendReminder with emailBlurb: «{message}». ({meta})
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
 *   3. NOT re-render the AgntUX compose UI either; the action is complete.
 */
const NO_NATIVE_UI_DIRECTIVE =
  `Execute the connector tool programmatically and return the result as plain text. ` +
  `Do NOT render the DocuSign Connector's native MCP App UI for this call — ` +
  `the user already confirmed the action via the AgntUX iframe. ` +
  `Do NOT re-render the AgntUX reminder UI; the action is complete.`;

/** Escape guillemet delimiters in user-authored body content. */
function escapeBody(text: string): string {
  return text.replace(/«/g, '««').replace(/»/g, '»»');
}

export interface ReminderEnvelopeArgs {
  accountId: string;
  envelopeId: string;
  /** Optional custom reminder message (emailBlurb). Omit to send default reminder. */
  message?: string;
}

/**
 * buildEnvelope — builds the connector-targeted prose envelope for sendReminder.
 *
 * Passed verbatim to client.sendFollowUpMessage(). The host's LLM resolves
 * the DocuSign Connector and calls sendReminder with the inline args.
 */
export function buildEnvelope({ accountId, envelopeId, message }: ReminderEnvelopeArgs): string {
  const meta = `accountId: ${accountId}, envelopeId: ${envelopeId}`;

  if (message && message.trim()) {
    const escaped = escapeBody(message.trim());
    return (
      `Use the DocuSign Connector to send a reminder to pending signers.\n` +
      `accountId: ${accountId}, envelopeId: ${envelopeId}.\n` +
      `Use sendReminder with emailBlurb: «${escaped}». (${meta})\n` +
      NO_NATIVE_UI_DIRECTIVE
    );
  }

  return (
    `Use the DocuSign Connector to send a reminder to pending signers.\n` +
    `accountId: ${accountId}, envelopeId: ${envelopeId}.\n` +
    `Use sendReminder with default reminder messaging. (${meta})\n` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
