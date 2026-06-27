// build-envelope.ts — hand-built connector envelope for the share handler.
//
// Called from the share-file iframe's Send button handler. Constructs a
// natural-language instruction the host's LLM executes via the Dropbox
// Connector tool `create_shared_link`.
//
// NOTE: There is NO shared `buildConnectorEnvelope` export anywhere —
// this is a plugin-local helper, assembled by hand per the shape in
// canonical/prompts/ui/connector-envelopes.md.
//
// Args passed to create_shared_link:
//   path: string            — the Dropbox file path
//   settings.access_type:   — "public" (anyone with link) or "team" (team only)
//   settings.expires:       — optional ISO-8601 expiry date

/** Verbatim native-UI suppression directive appended to every envelope. */
const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any of the Dropbox Connector's own native UI for this call — " +
  "the user has already filled in the form via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX share compose UI either; the action is complete.";

export interface ShareEnvelopeArgs {
  /** The Dropbox path of the file to share */
  file_path: string;
  /** The file's display name */
  file_name: string;
  /** Access level: "anyone" | "invited" */
  access: string;
  /** Optional expiry date (ISO-8601 date string, or empty) */
  expiry: string;
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
 *   Use the Dropbox Connector to create a shareable link.
 *   path: {file_path}, access: {access}[, expires: {expiry}]. (action_id: {action_id})
 */
export function buildEnvelope(args: ShareEnvelopeArgs): string {
  const { file_path, file_name, access, expiry, action_id } = args;

  const accessType = access === "invited" ? "team" : "public";
  const expiryClause =
    expiry.trim().length > 0 ? `, expires: ${escapeField(expiry.trim())}` : "";

  return (
    `Use the Dropbox Connector to create a shareable link for the file.\n` +
    `file: «${escapeField(file_name)}», path: ${escapeField(file_path)}, access: ${accessType}${expiryClause}. ` +
    `(action_id: ${action_id})\n` +
    `${NO_NATIVE_UI_DIRECTIVE}`
  );
}
