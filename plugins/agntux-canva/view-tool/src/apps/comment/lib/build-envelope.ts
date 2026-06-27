/**
 * build-envelope.ts — connector envelope builder for the comment handler.
 *
 * Returns a natural-language connector-targeted envelope string for
 * client.sendFollowUpMessage(). The host's LLM resolves the Canva
 * Connector tool (comment-on-design) from its installed connector — never
 * call client.callTool("comment-on-design", …) directly; connector tool
 * names are host-specific (UUID-prefixed in local agent mode) and a
 * hard-coded literal throws MCP error -32602 at click time (E32).
 *
 * The message body is delimited by Unicode guillemets («»). Literal « or »
 * in the user-authored body are escaped by doubling (« → ««, » → »»).
 *
 * There is no shared buildConnectorEnvelope export — this is hand-built
 * per handler per the agent definition.
 *
 * Connector write tool: comment-on-design
 * Args: design_id (string), message_plaintext (string, maxLength 1000)
 */

const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any Canva MCP App UI for this call — " +
  "the user has already reviewed and confirmed the comment via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX comment composer either; the action is complete.";

function escapeGuillemetBody(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

export interface CommentEnvelopeArgs {
  /** Canva design ID */
  design_id: string;
  /** The edited comment text (max 1000 chars) */
  message_plaintext: string;
}

/**
 * buildCommentEnvelope — returns the connector-targeted envelope string.
 *
 * Shape (connector tool: comment-on-design):
 *   Use the Canva Connector to add a comment to a design.
 *   design_id: {design_id}
 *   message_plaintext: «{message_plaintext}»
 */
export function buildCommentEnvelope(args: CommentEnvelopeArgs): string {
  const { design_id, message_plaintext } = args;
  const escapedMessage = escapeGuillemetBody(message_plaintext);
  return (
    `Use the Canva Connector to add a comment to a design.\n` +
    `design_id: ${design_id}\n` +
    `message_plaintext: «${escapedMessage}»\n` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
