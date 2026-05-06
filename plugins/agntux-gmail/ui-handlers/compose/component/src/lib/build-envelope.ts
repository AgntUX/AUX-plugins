// =============================================================================
// build-envelope.ts — pure function that produces the committed host_prompt
// string for the gmail compose card's Save action.
//
// 1.0.0 contract. The Gmail MCP server has NO send-email tool — the strongest
// write surface is `create_draft`. So the envelope is a TWO-STEP instruction:
//
//   1. Call create_draft with all fields inline.
//   2. Reply in chat with a clickable link to the resulting draft so the
//      user can open it in Gmail, review, and click Send themselves.
//
// We carry every argument the Gmail Connector needs (to, cc, bcc, subject,
// body, replyToMessageId) and point the host at the connector by name. No
// skill round-trip, no disk read.
//
// Encoding contract:
//
//   Delimiter: Unicode left/right guillemets «» surround the body and subject
//   fields. These characters (U+00AB, U+00BB) are extremely rare in email
//   bodies and subjects, making them safe as delimiters.
//
//   Escaping: if a string contains a literal « or », it is doubled before
//   embedding (« → ««, » → »»). A downstream parser reverses the doubling
//   AFTER extracting the content between the outermost «».
//
//   Recipient arrays are emitted as comma-separated lists without delimiters
//   (email addresses don't contain commas).
//
// Shape:
//
//   Use the Gmail Connector in two steps:
//   1. Call create_draft with replyToMessageId: <id>, to: [a@b.com, c@d.com],
//      cc: [...], bcc: [...], subject: «...», body: «...».
//   2. After the draft is created, reply in chat with a clickable link of
//      the form https://mail.google.com/mail/?authuser=<user_email>#drafts/<draft_id>
//      labeled "Open draft in Gmail to review and send →" so the user can
//      open it in Gmail, review, and click Send themselves.
//   (action_id: <id>)
// =============================================================================

export interface ComposeEnvelopeRecipients {
  to: string[];
  cc: string[];
  bcc: string[];
}

function escapeGuillemets(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

function emailList(addresses: string[]): string {
  return `[${addresses.join(", ")}]`;
}

/**
 * Build the committed host_prompt envelope for a gmail compose Save action.
 *
 * @param action_id           - The action slug (no .md suffix).
 * @param edited_subject      - The user-edited subject (may contain «»; will be escaped).
 * @param edited_body         - The user-edited draft body (may contain «»; will be escaped).
 * @param recipients          - {to, cc, bcc} arrays of email addresses.
 * @param reply_to_message_id - Gmail message id we're replying to (optional; empty string skips).
 * @param user_email          - The user's primary Gmail address; null if unknown.
 *                              When non-null, the Step 2 link template uses
 *                              `?authuser=<user_email>` so the browser opens
 *                              the right account; when null, falls back to
 *                              `mail/u/0/` which works for the default account.
 */
export function buildEnvelope(
  action_id: string,
  edited_subject: string,
  edited_body: string,
  recipients: ComposeEnvelopeRecipients,
  reply_to_message_id: string,
  user_email: string | null,
): string {
  const escapedSubject = escapeGuillemets(edited_subject);
  const escapedBody = escapeGuillemets(edited_body);
  const trailer = ` (action_id: ${action_id})`;

  const replyClause = reply_to_message_id
    ? `replyToMessageId: ${reply_to_message_id}, `
    : "";

  const ccClause =
    recipients.cc.length > 0 ? `cc: ${emailList(recipients.cc)}, ` : "";
  const bccClause =
    recipients.bcc.length > 0 ? `bcc: ${emailList(recipients.bcc)}, ` : "";

  const step1 =
    `1. Call create_draft with ${replyClause}to: ${emailList(recipients.to)}, ` +
    `${ccClause}${bccClause}` +
    `subject: «${escapedSubject}», body: «${escapedBody}».`;

  const linkTemplate = user_email
    ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(user_email)}#drafts/<draft_id>`
    : `https://mail.google.com/mail/u/0/#drafts/<draft_id>`;

  const step2 =
    `2. After the draft is created, reply in chat with a clickable link of ` +
    `the form ${linkTemplate} (substituting the actual draftId returned by ` +
    `create_draft) labeled "Open draft in Gmail to review and send →" so ` +
    `the user can open it in Gmail, review, and click Send themselves. The ` +
    `Gmail Connector has no send-email tool; the user finishes the Send ` +
    `action from Gmail's own UI.`;

  return `Use the Gmail Connector in two steps:\n${step1}\n${step2}${trailer}`;
}
