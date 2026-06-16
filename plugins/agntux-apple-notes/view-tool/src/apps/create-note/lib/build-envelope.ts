// build-envelope.ts — hand-built connector envelope for the create-note handler.
//
// Called from the create-note iframe's Send button handler. Constructs a
// natural-language instruction the host's LLM executes via the Apple Notes
// Connector tool `mcp__Read_and_Write_Apple_Notes__add_note`.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper, assembled by hand per the shape in
// canonical/prompts/ui/connector-envelopes.md.
//
// Args passed to add_note:
//   name: string     — the note title
//   content: string  — the note body
//   folder: string   — the folder to save into
//
// NATIVE-UI SUPPRESSION DIRECTIVE (required — see draft-flow-author.md §2a):
// The Apple Notes MCP server ships its own native UI. Without the directive
// the host stacks the connector's form on top of the AgntUX iframe. Every
// envelope emitted here must carry the suppression instruction verbatim.

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any of the Apple Notes Connector's own native UI for this call — " +
  "the user has already filled in the form via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX create-note compose UI either; the action is complete.";

export interface CreateNoteEnvelopeArgs {
  /** The note title (from the Title input) */
  name: string;
  /** The note body (from the Note textarea) */
  content: string;
  /** The selected folder */
  folder: string;
  /** The source action id, for reference */
  action_id: string;
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
 *   Use the Apple Notes Connector to create a new Apple Notes note.
 *   name: {name}, folder: {folder}.
 *   Body: «{content}». (action_id: {action_id})
 */
export function buildEnvelope(args: CreateNoteEnvelopeArgs): string {
  const { name, content, folder, action_id } = args;
  const escapedContent = escapeBody(content);
  const escapedName = name.replace(/\n/g, " ").trim();
  const escapedFolder = folder.replace(/\n/g, " ").trim() || "Notes";

  return (
    `Use the Apple Notes Connector to create a new Apple Notes note.\n` +
    `name: ${escapedName}, folder: ${escapedFolder}.\n` +
    `Body: «${escapedContent}». (action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
