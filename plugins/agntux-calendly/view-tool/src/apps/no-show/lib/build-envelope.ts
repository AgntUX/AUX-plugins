// =============================================================================
// build-envelope.ts — connector-targeted envelope builder for the no-show handler.
//
// One call to meetings-create_invitee_no_show per selected invitee.
// The envelope instructs the host to mark each invitee in sequence.
// =============================================================================

/**
 * Escape guillemet delimiters inside a user-authored string.
 */
function escapeBody(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native Calendly Connector UI for this call — " +
  "the user has already reviewed and confirmed the no-show selection via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX no-show marker either; the action is complete.";

export interface NoShowEnvelopeParams {
  invitee_uris: string[];
  meeting_name: string;
}

/**
 * buildEnvelope — returns the connector-targeted prose string to pass to
 * client.sendFollowUpMessage(). When multiple invitees are selected the host
 * is instructed to call create_invitee_no_show once per invitee.
 */
export function buildEnvelope({ invitee_uris, meeting_name }: NoShowEnvelopeParams): string {
  if (invitee_uris.length === 0) return "";

  const escapedMeeting = escapeBody(meeting_name.trim());

  if (invitee_uris.length === 1) {
    return (
      "Use the Calendly Connector to mark an invitee as a no-show.\n" +
      `invitee: ${invitee_uris[0]}.\n` +
      `Meeting: «${escapedMeeting}».\n` +
      NO_NATIVE_UI_DIRECTIVE
    );
  }

  const lines = invitee_uris
    .map((uri, i) => `${i + 1}. Call create_invitee_no_show with invitee: ${uri}.`)
    .join("\n");

  return (
    "Use the Calendly Connector to mark the following invitees as no-shows " +
    `for «${escapedMeeting}». Call create_invitee_no_show once per invitee:\n` +
    lines + "\n" +
    NO_NATIVE_UI_DIRECTIVE
  );
}
