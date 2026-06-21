// build-envelope.ts — hand-built connector envelope for the imessage reply handler.
//
// Called from the reply iframe's Send button handler. Constructs a
// natural-language instruction the host's LLM executes via the iMessage
// Connector tool `mcp__Read_and_Send_iMessages__send_imessage`.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper, assembled by hand per the shape in
// canonical/prompts/ui/connector-envelopes.md.
//
// Args passed to send_imessage:
//   recipient: string  — phone number or email handle
//   message: string    — the reply body

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native iMessage Connector UI for this call — " +
  "the user has already reviewed and confirmed the reply via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX reply composer either; the action is complete.";

export interface ReplyEnvelopeArgs {
  /** The recipient handle (phone or email) from contact_handle */
  recipient: string;
  /** The edited reply body */
  message: string;
  /** The source action id, for reference */
  action_id: string;
}

/**
 * Escape guillemet delimiters inside user-authored text.
 * The message body is enclosed in guillemets; literal ones are doubled.
 */
function escapeBody(text: string): string {
  return text.replace(/«/g, '««').replace(/»/g, '»»');
}

/**
 * buildEnvelope — returns the connector-targeted envelope string.
 *
 * Shape:
 *   Use the iMessage Connector to send an iMessage reply.
 *   recipient: {recipient}
 *   message: «{message}» (action_id: {action_id})
 */
export function buildEnvelope(args: ReplyEnvelopeArgs): string {
  const { recipient, message, action_id } = args;
  const escapedMessage = escapeBody(message);
  const safeRecipient = recipient.replace(/\n/g, ' ').trim();

  return (
    `Use the iMessage Connector to send an iMessage reply.\n` +
    `recipient: ${safeRecipient}\n` +
    `message: «${escapedMessage}» (action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
