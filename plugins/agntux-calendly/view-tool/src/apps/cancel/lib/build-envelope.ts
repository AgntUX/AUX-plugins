// =============================================================================
// build-envelope.ts — connector-targeted envelope builder for the cancel handler.
//
// Assembles the natural-language instruction the host's LLM executes to call
// the Calendly Connector's meetings-cancel_event tool. No package exports this
// function — it is hand-built per handler per the connector-envelopes.md spec.
// =============================================================================

/**
 * Escape guillemet delimiters inside a user-authored string.
 * «  → ««
 * »  → »»
 */
function escapeBody(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native Calendly Connector UI for this call — " +
  "the user has already reviewed and confirmed the cancellation via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX cancel composer either; the action is complete.";

export interface CancelEnvelopeParams {
  event_uri: string;
  reason: string;
}

/**
 * buildEnvelope — returns the connector-targeted prose string to pass to
 * client.sendFollowUpMessage(). The host's LLM reads and executes it.
 */
export function buildEnvelope({ event_uri, reason }: CancelEnvelopeParams): string {
  const escapedReason = escapeBody(reason.trim());
  return (
    "Use the Calendly Connector to cancel a scheduled Calendly event.\n" +
    `event_uri: ${event_uri}.\n` +
    `Cancellation reason: «${escapedReason}».\n` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
