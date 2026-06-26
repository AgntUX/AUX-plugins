/**
 * build-envelope.ts — connector envelope builder for the comment handler.
 *
 * Returns a natural-language connector-targeted envelope string for
 * client.sendFollowUpMessage(). The host's LLM resolves the Asana
 * Connector tool (add_comment) from its installed connector — never
 * call client.callTool("add_comment", …) directly; connector tool names
 * are host-specific (UUID-prefixed in local agent mode) and a hard-coded
 * literal throws MCP error -32602 at click time (E32).
 *
 * The body is delimited by Unicode guillemets («»). Literal « or » in
 * the user-authored body are escaped by doubling (« → ««, » → »»).
 *
 * There is no shared buildConnectorEnvelope export — this is hand-built
 * per handler per the agent definition.
 */

const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. Do NOT render any Asana MCP App UI for this call — the user already submitted the form in the AgntUX iframe and the data is final. Do NOT re-render the AgntUX compose UI.";

function escapeGuillemetBody(body: string): string {
  return body.replace(/«/g, "««").replace(/»/g, "»»");
}

export interface CommentEnvelopeArgs {
  task_gid: string;
  body: string;
}

/**
 * Returns the connector-targeted envelope string to pass to
 * client.sendFollowUpMessage(). The Asana Connector's add_comment tool
 * requires task_gid and text.
 */
export function buildCommentEnvelope(args: CommentEnvelopeArgs): string {
  const escapedBody = escapeGuillemetBody(args.body);
  return (
    `Use the Asana Connector to add a comment to an Asana task.\n` +
    `task_gid: ${args.task_gid}.\n` +
    `Body: «${escapedBody}».\n` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
