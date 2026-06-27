/**
 * build-envelope.ts — connector envelope builder for the reply handler.
 *
 * Returns a natural-language connector-targeted envelope string for
 * client.sendFollowUpMessage(). The host's LLM resolves the Canva
 * Connector tool (reply-to-comment) from its installed connector — never
 * call client.callTool("reply-to-comment", …) directly; connector tool names
 * are host-specific (UUID-prefixed in local agent mode) and a hard-coded
 * literal throws MCP error -32602 at click time (E32).
 *
 * The message body is delimited by Unicode guillemets («»). Literal « or »
 * in the user-authored body are escaped by doubling (« → ««, » → »»).
 *
 * There is no shared buildConnectorEnvelope export — this is hand-built
 * per handler per the agent definition.
 *
 * Connector write tool: reply-to-comment
 * Args: design_id (string), comment_id (string), message_plaintext (string, maxLength 2048)
 */

const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any Canva MCP App UI for this call — " +
  "the user has already reviewed and confirmed the reply via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX reply composer either; the action is complete.";

function escapeGuillemetBody(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

export interface ReplyEnvelopeArgs {
  /** Canva design ID */
  design_id: string;
  /** ID of the comment being replied to */
  comment_id: string;
  /** The edited reply text (max 2048 chars) */
  message_plaintext: string;
}

/**
 * buildReplyEnvelope — returns the connector-targeted envelope string.
 *
 * Shape (connector tool: reply-to-comment):
 *   Use the Canva Connector to reply to a comment on a design.
 *   design_id: {design_id}
 *   comment_id: {comment_id}
 *   message_plaintext: «{message_plaintext}»
 */
export function buildReplyEnvelope(args: ReplyEnvelopeArgs): string {
  const { design_id, comment_id, message_plaintext } = args;
  const escapedMessage = escapeGuillemetBody(message_plaintext);
  return (
    `Use the Canva Connector to reply to a comment on a design.\n` +
    `design_id: ${design_id}\n` +
    `comment_id: ${comment_id}\n` +
    `message_plaintext: «${escapedMessage}»\n` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
