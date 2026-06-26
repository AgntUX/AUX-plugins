// build-envelope.ts — hand-built connector envelope for the save-doc handler.
//
// Called from the save-doc iframe's Send button handler. Constructs a
// natural-language instruction the host's LLM executes via the Zoom
// Connector tool `mcp__c2e9cd40-685c-4dfa-8894-b463c96d7886__create_new_file_with_markdown`.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper, assembled by hand per the shape in
// canonical/prompts/ui/connector-envelopes.md.
//
// Args passed to create_new_file_with_markdown:
//   content: string     — the full markdown body of the Zoom Doc (required)
//   file_name: string   — the document title (required)
//   parent_id?: string  — optional folder/parent ID

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any Zoom Connector native UI for this call — " +
  "the user has already reviewed and confirmed the document via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX save-doc composer either; the action is complete.";

export interface SaveDocEnvelopeArgs {
  /** The edited document title (from the Doc title input) */
  file_name: string;
  /** The full markdown body of the document (from the Doc content textarea) */
  content: string;
  /** The source action id, for reference */
  action_id: string;
  /** Optional parent folder ID */
  parent_id?: string;
}

/**
 * Escape guillemet delimiters inside user-authored text.
 * «...» delimit the body field; literal « and » are doubled.
 */
function escapeBody(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

/**
 * buildEnvelope — returns the connector-targeted envelope string.
 *
 * Shape:
 *   Use the Zoom Connector to save a new Zoom Doc with the meeting summary.
 *   Use create_new_file_with_markdown.
 *   file_name: {file_name}
 *   content: «{content}» (action_id: {action_id})
 *
 * The host's LLM resolves the connector tool by display name.
 * Do NOT hard-code the UUID-prefixed tool name here — it is host- and
 * user-specific and will throw MCP error -32602 (Tool not found) on any
 * host where the UUID differs.
 */
export function buildEnvelope(args: SaveDocEnvelopeArgs): string {
  const { file_name, content, action_id, parent_id } = args;
  const escapedContent = escapeBody(content);
  const safeFileName = file_name.replace(/\n/g, " ").trim();
  const parentLine = parent_id
    ? `parent_id: ${parent_id.replace(/\n/g, " ").trim()}\n`
    : "";

  return (
    `Use the Zoom Connector to save a new Zoom Doc with the meeting summary.\n` +
    `Use create_new_file_with_markdown.\n` +
    `file_name: ${safeFileName}\n` +
    `${parentLine}` +
    `content: «${escapedContent}» (action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
