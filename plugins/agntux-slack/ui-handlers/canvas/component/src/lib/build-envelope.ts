// =============================================================================
// build-envelope.ts — pure function that produces the committed host_prompt
// string for the compose card's Send / Schedule / Save-as-draft actions.
//
// Encoding contract (load-bearing — draft-flow-author must implement the
// matching parser):
//
//   Delimiter: Unicode left/right guillemets «» surround the body field.
//   These characters (U+00AB, U+00BB) are extremely rare in Slack message
//   bodies, making them safe as delimiters.
//
//   Escaping: if the body contains a literal « or », it is doubled before
//   embedding (« → ««, » → »»). The parser reverses the doubling AFTER
//   extracting the content between the outermost «».
//
//   Shape:
//     ux: Use the agntux-slack plugin to commit the drafted reply for action
//     {action_id} with body «{edited_body}» (mode: {send|schedule|save_draft}
//     {, send_at: {RFC3339}}).
//
//   The send_at clause is included only when mode === "schedule" and send_at
//   is a non-empty string.
// =============================================================================

export type CommitMode = "send" | "schedule" | "save_draft";

/**
 * Escape «» delimiters within body text by doubling them.
 * Reversal: replace «« → « and »» → » AFTER slicing between outermost «».
 */
function escapeGuillemets(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

/**
 * Build the committed host_prompt envelope for a compose action.
 *
 * @param action_id   - The action slug (no .md suffix).
 * @param mode        - "send" | "schedule" | "save_draft".
 * @param edited_body - The user-edited draft body (may contain «»; will be escaped).
 * @param send_at     - RFC 3339 string; required when mode === "schedule", otherwise ignored.
 */
export function buildEnvelope(
  action_id: string,
  mode: CommitMode,
  edited_body: string,
  send_at?: string,
): string {
  const escapedBody = escapeGuillemets(edited_body);
  const modeClause =
    mode === "schedule" && send_at
      ? `mode: schedule, send_at: ${send_at}`
      : `mode: ${mode}`;
  return `ux: Use the agntux-slack plugin to commit the drafted reply for action ${action_id} with body «${escapedBody}» (${modeClause}).`;
}
