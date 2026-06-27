// build-envelope.ts — hand-built connector envelope for the file-request handler.
//
// Called from the file-request iframe's Send button handler. Constructs a
// natural-language instruction the host's LLM executes via the Dropbox
// Connector tool `create_file_request`.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper, assembled by hand per the shape in
// canonical/prompts/ui/connector-envelopes.md.
//
// Args passed to create_file_request:
//   title:       string              — the request title shown to uploaders
//   destination: string              — the Dropbox folder path where uploads land
//   deadline:    string (optional)   — ISO-8601 date for the upload deadline

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any of the Dropbox Connector's own native UI for this call — " +
  "the user has already filled in the form via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX file-request compose UI either; the action is complete.";

export interface FileRequestEnvelopeArgs {
  /** The Dropbox path of the destination folder for uploads */
  destination_path: string;
  /** The destination folder's display name */
  destination_name: string;
  /** The title shown to people who receive the file request link */
  title: string;
  /** Optional deadline as an ISO-8601 date string (YYYY-MM-DD), or empty */
  deadline: string;
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
 *   Use the Dropbox Connector to create a file request.
 *   title: {title}, destination: {destination_path}[, deadline: {deadline}]. (action_id: {action_id})
 */
export function buildEnvelope(args: FileRequestEnvelopeArgs): string {
  const { destination_path, destination_name, title, deadline, action_id } =
    args;

  const deadlineClause =
    deadline.trim().length > 0
      ? `, deadline: ${escapeField(deadline.trim())}`
      : "";

  return (
    `Use the Dropbox Connector to create a file request.\n` +
    `title: «${escapeField(title)}», destination: «${escapeField(destination_name)}» (${escapeField(destination_path)})${deadlineClause}. ` +
    `(action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
