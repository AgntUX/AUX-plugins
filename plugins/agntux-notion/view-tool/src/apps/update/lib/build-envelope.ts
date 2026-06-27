// =============================================================================
// build-envelope.ts — hand-built connector envelope for notion-update-page.
//
// Assembles the natural-language instruction the host's LLM executes verbatim.
// Per connector-envelopes.md: address "Notion Connector", never callTool directly.
//
// Native-UI suppression directive: the Notion Connector ships its own MCP App
// UI. Appending NO_NATIVE_UI_DIRECTIVE to every envelope tells the host to
// execute the connector tool programmatically and NOT render any Notion
// Connector MCP App UI — the user already filled the form in the AgntUX iframe.
// =============================================================================

// Native-UI suppression directive. The Notion Connector ships its own MCP App
// UI; without this directive the host stacks it on top of the AgntUX iframe
// after the user clicks "Save changes", duplicating the form they just used.
const NO_NATIVE_UI_DIRECTIVE =
  " Execute the Notion Connector tool programmatically and return its" +
  " success/error to chat as plain text — do NOT render any Notion" +
  " Connector MCP App UI for this call (the user has already used the" +
  " AgntUX compose UI and the data is final), and do NOT re-render the" +
  " AgntUX compose UI either; the action is complete.";

export interface UpdateEnvelopeArgs {
  pageId: string;
  properties: Record<string, unknown>;
  actionId: string;
}

/**
 * Build the connector envelope for updating properties on a Notion page.
 * Targets notion-update-page via the Notion Connector.
 */
export function buildEnvelope(args: UpdateEnvelopeArgs): string {
  const { pageId, properties, actionId } = args;
  const propsJson = JSON.stringify(properties);
  return (
    `Use the Notion Connector to update properties on a Notion page.\n` +
    `page_id: ${pageId}.\n` +
    `Apply the following property changes: ${propsJson}.\n` +
    `(action_id: ${actionId})` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
