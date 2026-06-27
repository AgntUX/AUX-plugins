// =============================================================================
// build-envelope.ts — hand-built connector envelope for notion-create-comment.
//
// Assembles the natural-language instruction the host's LLM executes verbatim.
// Per connector-envelopes.md: address "Notion Connector", never callTool directly.
// Body delimited by Unicode guillemets « » with doubling-escape for literal
// « or » in the body text.
//
// Native-UI suppression directive: the Notion Connector ships its own MCP App
// UI. Appending NO_NATIVE_UI_DIRECTIVE to every envelope tells the host to
// execute the connector tool programmatically and NOT render any Notion
// Connector MCP App UI — the user already filled the form in the AgntUX iframe.
// =============================================================================

/** Escape literal « and » in user-authored body text. */
function escapeBody(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

// Native-UI suppression directive. The Notion Connector ships its own MCP App
// UI; without this directive the host stacks it on top of the AgntUX iframe
// after the user clicks "Post comment", duplicating the form they just used.
const NO_NATIVE_UI_DIRECTIVE =
  " Execute the Notion Connector tool programmatically and return its" +
  " success/error to chat as plain text — do NOT render any Notion" +
  " Connector MCP App UI for this call (the user has already used the" +
  " AgntUX compose UI and the data is final), and do NOT re-render the" +
  " AgntUX compose UI either; the action is complete.";

export interface CommentEnvelopeArgs {
  pageId: string;
  discussionId: string;
  body: string;
  actionId: string;
}

/**
 * Build the connector envelope for posting a reply to a Notion comment thread.
 * Targets notion-create-comment via the Notion Connector.
 */
export function buildEnvelope(args: CommentEnvelopeArgs): string {
  const { pageId, discussionId, body, actionId } = args;
  const escaped = escapeBody(body);
  return (
    `Use the Notion Connector to post a comment reply on a Notion page.\n` +
    `page_id: ${pageId}, discussion_id: ${discussionId}.\n` +
    `Comment on the page; reply to the existing discussion thread.\n` +
    `Body: «${escaped}». (action_id: ${actionId})` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
