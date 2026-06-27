// =============================================================================
// build-envelope.ts — hand-built connector envelope for notion-create-pages.
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
// after the user clicks "Create page", duplicating the form they just used.
const NO_NATIVE_UI_DIRECTIVE =
  " Execute the Notion Connector tool programmatically and return its" +
  " success/error to chat as plain text — do NOT render any Notion" +
  " Connector MCP App UI for this call (the user has already used the" +
  " AgntUX compose UI and the data is final), and do NOT re-render the" +
  " AgntUX compose UI either; the action is complete.";

export interface CreateEnvelopeArgs {
  parentId: string;
  parentLabel: string;
  title: string;
  body: string;
  actionId: string;
}

/**
 * Build the connector envelope for creating a new page in Notion.
 * Targets notion-create-pages via the Notion Connector.
 */
export function buildEnvelope(args: CreateEnvelopeArgs): string {
  const { parentId, parentLabel, title, body, actionId } = args;
  const escapedTitle = escapeBody(title);
  const escapedBody = escapeBody(body);
  return (
    `Use the Notion Connector to create a new Notion page.\n` +
    `parent_id: ${parentId} (${parentLabel}), title: «${escapedTitle}».\n` +
    `Create the page under the specified parent with the given title.\n` +
    `Body: «${escapedBody}». (action_id: ${actionId})` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
