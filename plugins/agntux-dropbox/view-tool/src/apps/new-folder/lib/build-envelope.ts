// build-envelope.ts — hand-built connector envelope for the new-folder handler.
//
// Called from the new-folder iframe's Send button handler. Constructs a
// natural-language instruction the host's LLM executes via the Dropbox
// Connector tool `create_folder`.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper, assembled by hand per the shape in
// canonical/prompts/ui/connector-envelopes.md.
//
// Args passed to create_folder:
//   path: string  — the full Dropbox path for the new folder (parent + name)

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any of the Dropbox Connector's own native UI for this call — " +
  "the user has already filled in the form via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX new-folder compose UI either; the action is complete.";

export interface NewFolderEnvelopeArgs {
  /** The Dropbox path of the parent directory */
  parent_path: string;
  /** The parent directory's display name */
  parent_name: string;
  /** The name for the new folder (not a full path — combined with parent_path) */
  folder_name: string;
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
 * Shape:
 *   Use the Dropbox Connector to create a folder.
 *   parent: {parent_name} ({parent_path}), new folder name: {folder_name}. (action_id: {action_id})
 */
export function buildEnvelope(args: NewFolderEnvelopeArgs): string {
  const { parent_path, parent_name, folder_name, action_id } = args;

  // Build the full path: ensure parent_path ends with / then append folder name.
  const parentNorm = parent_path.endsWith("/") ? parent_path : `${parent_path}/`;
  const fullPath = `${parentNorm}${folder_name.trim()}`;

  return (
    `Use the Dropbox Connector to create a folder.\n` +
    `parent: «${escapeField(parent_name)}» (${escapeField(parent_path)}), ` +
    `new folder name: «${escapeField(folder_name.trim())}», full path: ${escapeField(fullPath)}. ` +
    `(action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
