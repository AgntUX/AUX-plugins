// build-envelope.ts — hand-built connector envelope for the reply handler.
//
// Called from the reply iframe's Send button handler. Constructs a
// natural-language instruction the host's LLM executes via the PostHog
// Connector tool for comment-create.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper per canonical/prompts/ui/connector-envelopes.md.
//
// The envelope addresses the connector by display name ("PostHog Connector")
// so the host LLM resolves the tool regardless of UUID prefix or host type.
// Never embed a hard-coded mcp__<uuid>__<tool> literal in envelope prose —
// that throws MCP error -32602 on any host other than the one it was authored on.
//
// Args passed to comment-create:
//   scope: string     — the scope context for the comment (e.g. "error_tracking")
//   item_id: string   — the identifier of the item being commented on
//   content: string   — the comment body text (guillemet-delimited in the envelope)

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any native PostHog Connector UI for this call — " +
  "the user has already confirmed the action via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX reply UI; the action is complete.";

export interface ReplyEnvelopeArgs {
  /** Scope context for the PostHog comment (e.g. "error_tracking") */
  scope: string;
  /** Identifier of the item being commented on */
  item_id: string;
  /** The reply body text */
  content: string;
  /** Source action_id for reference */
  action_id: string;
}

/**
 * Escape guillemet delimiters inside user-authored body text.
 * The content field is enclosed in guillemets; literal ones are doubled.
 */
function escapeBody(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

/**
 * buildEnvelope — returns the connector-targeted envelope string.
 *
 * Shape:
 *   Use the PostHog Connector to post a comment on {scope} item "{item_id}".
 *   scope: "{scope}", item_id: "{item_id}".
 *   Body: «{content}». (action_id: {action_id})
 */
export function buildEnvelope(args: ReplyEnvelopeArgs): string {
  const { scope, item_id, content, action_id } = args;
  const escapedContent = escapeBody(content);

  return (
    `Use the PostHog Connector to post a comment on ${scope} item "${item_id}".\n` +
    `scope: "${scope}", item_id: "${item_id}".\n` +
    `Body: «${escapedContent}». (action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
