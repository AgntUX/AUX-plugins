// =============================================================================
// build-envelope.ts — connector-targeted envelope builder for the
// scheduling-link handler.
//
// Instructs the host to call Calendly's scheduling_links-create_single_use_scheduling_link
// with max_event_count: 1 and the selected event type URI.
// =============================================================================

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native Calendly Connector UI for this call — " +
  "the user has already reviewed and confirmed the event type selection via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX scheduling-link composer either; the action is complete.";

export interface SchedulingLinkEnvelopeParams {
  event_type_uri: string;
  event_type_name: string;
}

/**
 * buildEnvelope — returns the connector-targeted prose string to pass to
 * client.sendFollowUpMessage(). The host's LLM reads and executes it via the
 * Calendly Connector.
 *
 * This is a two-step envelope: step 1 calls
 * scheduling_links-create_single_use_scheduling_link; step 2 shares the
 * booking_url returned by step 1. The host threads the return value between
 * steps — the component cannot precompute the URL.
 */
export function buildEnvelope({
  event_type_uri,
  event_type_name,
}: SchedulingLinkEnvelopeParams): string {
  return (
    "Use the Calendly Connector in two steps:\n" +
    `1. Call scheduling_links-create_single_use_scheduling_link with max_event_count: 1, owner: ${event_type_uri}, owner_type: EventType. Event type: ${event_type_name}.\n` +
    "2. Take the booking_url from the response returned in step 1 and share it with the user in chat as the single-use booking link. Substitute {booking_url} with the actual URL from step 1's response.\n" +
    NO_NATIVE_UI_DIRECTIVE
  );
}
