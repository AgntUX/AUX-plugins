// build-envelope.ts — hand-built connector envelope for the organize handler.
//
// Called from the organize-file iframe's Send button handler. Constructs a
// natural-language instruction the host's LLM executes via the Dropbox
// Connector tool `move` or `copy` depending on the selected mode.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper, assembled by hand per the shape in
// canonical/prompts/ui/connector-envelopes.md.
//
// Tool used:
//   move — moves the item to a new path in Dropbox
//   copy — copies the item to a new path in Dropbox
//
// Args for both tools:
//   from_path: string  — the current Dropbox path of the item
//   to_path:   string  — the destination Dropbox path (including filename)

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any of the Dropbox Connector's own native UI for this call — " +
  "the user has already filled in the form via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX organize compose UI either; the action is complete.";

export interface OrganizeEnvelopeArgs {
  /** The current Dropbox path of the file or folder */
  item_path: string;
  /** The file/folder's display name */
  item_name: string;
  /** "file" or "folder" */
  item_type: string;
  /** The destination Dropbox path (must include the full target path + name) */
  destination_path: string;
  /** "move" or "copy" — determines which connector tool is called */
  mode: string;
  /** Source action id for reference */
  action_id: string;
}

/**
 * Escape guillemet delimiters inside user-authored text.
 */
function escapeField(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

/**
 * buildEnvelope — returns the connector-targeted envelope string.
 *
 * Shape (mode="move"):
 *   Use the Dropbox Connector to move the {item_type}.
 *   item: {item_name}, from: {item_path}, to: {destination_path}. (action_id: {action_id})
 *
 * Shape (mode="copy"):
 *   Use the Dropbox Connector to copy the {item_type}.
 *   item: {item_name}, from: {item_path}, to: {destination_path}. (action_id: {action_id})
 */
export function buildEnvelope(args: OrganizeEnvelopeArgs): string {
  const { item_path, item_name, item_type, destination_path, mode, action_id } =
    args;

  const verb = mode === "copy" ? "copy" : "move";
  const typeLabel = item_type === "folder" ? "folder" : "file";

  return (
    `Use the Dropbox Connector to ${verb} the ${typeLabel}.\n` +
    `item: «${escapeField(item_name)}», from: ${escapeField(item_path)}, to: ${escapeField(destination_path)}. ` +
    `(action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
