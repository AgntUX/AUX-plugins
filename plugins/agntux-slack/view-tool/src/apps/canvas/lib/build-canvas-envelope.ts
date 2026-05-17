// =============================================================================
// build-canvas-envelope.ts — pure function that produces the committed
// host_prompt string for the canvas card's "Create canvas + post link" action.
//
// 3.0.0 contract change. Previously this envelope said "Use the agntux-slack
// plugin to commit the drafted canvas…", which the host routed through a now-
// removed local skill that re-read the action file from disk to recover the
// channel/thread context. The new envelope carries every Slack Connector
// argument inline and instructs the host to call the Slack Connector
// directly: (1) create the canvas via slack_create_canvas, (2) post a link to
// it as a thread reply via slack_send_message. Two MCP calls, no LLM-side
// disk reads.
//
// Encoding contract (still used for scalar fields and for list fields, since
// canvas content is user-editable and may contain arbitrary punctuation):
//
//   Delimiter: Unicode guillemets «» surround each field value.
//
//   Scalar fields (action_id, title, tldr, followup_message): each value's
//   literal `«` is doubled to `««`, literal `»` to `»»`, before wrapping in
//   the outer `«…»`. Decode: extract content between the outermost `«` and
//   `»`, then replace `««`→`«` and `»»`→`»`.
//
//   List fields (decisions, open_questions): the array is JSON-stringified
//   into the value slot. The `«…»` outer wrapper still applies, but the
//   inner contents are a valid JSON array literal — no custom escape rules.
//
// Slack canvas linking. The Slack Connector's slack_create_canvas tool
// returns a canvas URL of the form
// `https://{workspace}.slack.com/docs/{team}/{file_id}`. Slack auto-unfurls
// these URLs to a canvas-preview card when posted in a channel; pasting the
// URL plain works, and Slack mrkdwn `<URL|label>` format is also fine. We
// instruct the host to use the mrkdwn form so the link reads as the canvas
// title, not as a raw URL. The iframe cannot precompute the URL — the host
// must do create-canvas → take URL → post-message in two steps.
// =============================================================================

export interface CanvasChannel {
  id: string;
  name: string;
}

export interface CanvasThread {
  parent_ts: string;
}

/**
 * Escape guillemets in a single string value by doubling them.
 * Used for scalar text fields only.
 */
function escapeGuillemets(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

/**
 * Encode a string list for embedding between guillemets.
 * Uses JSON.stringify so the inner contents are unambiguous regardless of
 * the characters in each item — there is no reserved item-level character
 * to escape, and `JSON.parse` is the inverse.
 */
function encodeList(items: string[]): string {
  return JSON.stringify(items);
}

/**
 * Build the committed host_prompt envelope for a canvas creation action.
 *
 * @param action_id                 - The action slug (no .md suffix). Carried as a
 *                                    trailing reference so the host can correlate the
 *                                    click to the originating action item.
 * @param title                     - Canvas title (may contain «»; will be escaped).
 * @param tldr                      - Canvas TL;DR (may contain «»; will be escaped).
 * @param decisions                 - Array of decision strings (JSON-encoded).
 * @param open_questions            - Array of open question strings (JSON-encoded).
 * @param proposed_followup_message - The follow-up reply body (may contain «»; escaped).
 * @param channel                   - Channel id/name captured from the iframe payload.
 * @param thread                    - Thread parent_ts captured from the iframe payload.
 */
export function buildCanvasEnvelope(
  action_id: string,
  title: string,
  tldr: string,
  decisions: string[],
  open_questions: string[],
  proposed_followup_message: string,
  channel: CanvasChannel,
  thread: CanvasThread,
): string {
  const escapedTitle = escapeGuillemets(title);
  const escapedTldr = escapeGuillemets(tldr);
  const escapedFollowup = escapeGuillemets(proposed_followup_message);
  const channelStr = channel.name
    ? `${channel.id} (#${channel.name})`
    : channel.id;
  const threadTs = thread.parent_ts;
  const trailer = ` (action_id: ${action_id})`;

  // Note on the link label: we use a literal `{canvas_title}` placeholder
  // (not the escaped title) so the host substitutes the unescaped title
  // text — embedding the escaped form (with doubled guillemets) would
  // leak the doubling into the actual Slack message label.
  return (
    `Use the Slack Connector in two steps:\n` +
    `1. Create a Slack canvas titled «${escapedTitle}» with body assembled ` +
    `from TL;DR «${escapedTldr}», decisions «${encodeList(decisions)}», ` +
    `open_questions «${encodeList(open_questions)}». Use slack_create_canvas.\n` +
    `2. Take the canvas URL returned by step 1 and post it as a thread ` +
    `reply in channel_id: ${channelStr}, thread_ts: ${threadTs}, with body ` +
    `«${escapedFollowup}» followed by the canvas URL formatted as a Slack ` +
    `mrkdwn link \`<{canvas_url}|{canvas_title}>\` — substitute {canvas_url} ` +
    `with the URL returned by step 1 and {canvas_title} with the unescaped ` +
    `canvas title (the same text passed to slack_create_canvas, with any ` +
    `«« or »» pairs collapsed back to single « or »). Reply in-thread; if no ` +
    `thread exists yet on the parent message, this reply will start one. ` +
    `Use slack_send_message.${trailer}`
  );
}
