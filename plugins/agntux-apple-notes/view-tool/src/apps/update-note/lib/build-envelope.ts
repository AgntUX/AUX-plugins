// build-envelope.ts — hand-built connector envelope for the update-note handler.
//
// Called from the update-note iframe's Send button handler. Constructs a
// natural-language instruction the host's LLM executes via the Apple Notes
// Connector tool `mcp__Read_and_Write_Apple_Notes__update_note_content`.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper, assembled by hand per the shape in
// canonical/prompts/ui/connector-envelopes.md.
//
// Args passed to update_note_content:
//   note_name: string  — the existing note title (connector key)
//   new_content: string — the updated note body
//   folder?: string    — optional: where the note lives
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
  "Do NOT re-render the AgntUX update-note compose UI either; the action is complete.";

export type EditorMode = "checklist" | "freetext";

export interface ChecklistItem {
  text: string;
  checked: boolean;
}

export interface UpdateNoteEnvelopeArgs {
  /** The note name / title — the connector key */
  note_name: string;
  /** Optional folder where the note lives */
  folder: string;
  /** Which editor mode produced the content */
  mode: EditorMode;
  /** Free-text body — used when mode === 'freetext' */
  draft_body: string;
  /** Checklist items — used when mode === 'checklist' */
  checklist_items: ChecklistItem[];
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
 * Serialize checklist items back to Apple Notes markdown-style checklist text.
 * Checked items use `- [x]`, unchecked use `- [ ]`.
 */
function serializeChecklist(items: ChecklistItem[]): string {
  return items
    .map((item) => {
      const marker = item.checked ? "- [x]" : "- [ ]";
      return `${marker} ${item.text}`;
    })
    .join("\n");
}

/**
 * buildEnvelope — returns the connector-targeted envelope string.
 *
 * Shape:
 *   Use the Apple Notes Connector to update an existing Apple Notes note.
 *   note_name: {note_name}[, folder: {folder}].
 *   Body: «{new_content}». (action_id: {action_id})
 */
export function buildEnvelope(args: UpdateNoteEnvelopeArgs): string {
  const { note_name, folder, mode, draft_body, checklist_items, action_id } =
    args;

  const newContent =
    mode === "checklist"
      ? serializeChecklist(checklist_items)
      : draft_body;

  const escapedContent = escapeBody(newContent);
  const escapedName = note_name.replace(/\n/g, " ").trim();

  const folderClause =
    folder.trim().length > 0 ? `, folder: ${folder.trim()}` : "";

  return (
    `Use the Apple Notes Connector to update an existing Apple Notes note.\n` +
    `note_name: ${escapedName}${folderClause}.\n` +
    `Body: «${escapedContent}». (action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
