// =============================================================================
// build-envelope.ts — pure function that produces the committed host_prompt
// string for the compose card's Send / Schedule / Save-as-draft actions.
//
// 3.0.0 contract change. The envelope no longer says "Use the agntux-slack
// plugin to commit the drafted reply…" — that shape forced the host to find a
// local agntux-slack skill (now removed) which then re-read the action file
// from disk to recover the channel_id + thread_ts. Two failure modes:
//
//   1. Hosts often couldn't find the skill (the same failure mode that
//      CHANGELOG 2.0.0 documented for the *open* prompts).
//   2. The wording mis-directed the host to a plugin that has no Slack write
//      tools — Slack write tools live on the user's Slack Connector.
//
// The new shape carries every argument the Slack Connector needs (channel_id,
// thread_ts, body, mode, send_at) and points the host at the connector by
// name. No skill, no disk read, no second hop.
//
// Encoding contract (still used for the body, since users can paste arbitrary
// text containing punctuation that confuses naive parsers):
//
//   Delimiter: Unicode left/right guillemets «» surround the body field.
//   These characters (U+00AB, U+00BB) are extremely rare in Slack message
//   bodies, making them safe as delimiters.
//
//   Escaping: if the body contains a literal « or », it is doubled before
//   embedding (« → ««, » → »»). A downstream parser reverses the doubling
//   AFTER extracting the content between the outermost «».
//
//   Shape (send / save_draft):
//     Use the Slack Connector to {action verb}. channel_id: {C…} (#{name}),
//     thread_ts: {ts}. {threading note}. Body: «{escaped body}».
//
//   Shape (schedule):
//     Same with an additional `send_at: {RFC3339}` clause inside the
//     instruction line.
//
// Threading note. For all three modes we tell the host that the reply goes
// in-thread; if no thread exists yet on the parent message, the reply will
// start one. This matches Slack's actual API behaviour: posting with
// thread_ts=<parent_ts> creates the thread on the parent if none existed.
// =============================================================================

export type CommitMode = "send" | "schedule" | "save_draft";

export interface ComposeChannel {
  id: string;
  name: string;
  is_dm: boolean;
}

export interface ComposeThread {
  parent_ts: string;
}

/**
 * Escape «» delimiters within body text by doubling them.
 * Reversal: replace «« → « and »» → » AFTER slicing between outermost «».
 */
function escapeGuillemets(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

function channelLabel(channel: ComposeChannel): string {
  const prefix = channel.is_dm ? "" : "#";
  return channel.name ? `${channel.id} (${prefix}${channel.name})` : channel.id;
}

const THREADING_NOTE =
  "Reply in-thread; if no thread exists yet on the parent message, this " +
  "reply will start one when posted.";

// Native-UI suppression directive. The AgntUX compose iframe has already
// collected every field the user cared about, so the host should call the
// Slack Connector tool programmatically and return its result as plain
// chat text — NOT render the Slack Connector's own MCP App UI (which
// would duplicate the form the user just used). Appended verbatim to
// every envelope (send / schedule / save_draft).
const NO_NATIVE_UI_DIRECTIVE =
  " Execute the Slack Connector tool programmatically and return its " +
  "success/error to chat as plain text — do NOT render any Slack " +
  "Connector MCP App UI for this call (the user has already used the " +
  "AgntUX compose UI and the data is final), and do NOT re-render the " +
  "AgntUX compose UI either; the action is complete.";

/**
 * Build the committed host_prompt envelope for a compose action.
 *
 * @param action_id   - The action slug (no .md suffix). Carried in the
 *                      envelope as a trailing reference so the host can
 *                      correlate the click to the originating action item.
 * @param mode        - "send" | "schedule" | "save_draft".
 * @param edited_body - The user-edited draft body (may contain «»; will be escaped).
 * @param channel     - Channel id/name/is_dm captured from the iframe payload.
 * @param thread      - Thread parent_ts captured from the iframe payload.
 * @param send_at     - RFC 3339 string; required when mode === "schedule", otherwise ignored.
 */
export function buildEnvelope(
  action_id: string,
  mode: CommitMode,
  edited_body: string,
  channel: ComposeChannel,
  thread: ComposeThread,
  send_at?: string,
): string {
  const escapedBody = escapeGuillemets(edited_body);
  const channelStr = channelLabel(channel);
  const threadTs = thread.parent_ts;
  const trailer = ` (action_id: ${action_id})`;

  if (mode === "save_draft") {
    return (
      `Use the Slack Connector to save a Slack draft (do NOT send) of a ` +
      `thread reply. channel_id: ${channelStr}, thread_ts: ${threadTs}. ` +
      `${THREADING_NOTE} Save as draft only — do not send. ` +
      `Body: «${escapedBody}».${trailer}` +
      NO_NATIVE_UI_DIRECTIVE
    );
  }

  if (mode === "schedule" && send_at) {
    return (
      `Use the Slack Connector to schedule a Slack message as a thread ` +
      `reply. channel_id: ${channelStr}, thread_ts: ${threadTs}, ` +
      `send_at: ${send_at}. ${THREADING_NOTE} ` +
      `Body: «${escapedBody}».${trailer}` +
      NO_NATIVE_UI_DIRECTIVE
    );
  }

  // Default: send (treats schedule-without-send_at as send too — the UI
  // already enforces send_at presence in schedule mode, but we don't want
  // to crash on an upstream regression).
  return (
    `Use the Slack Connector to send a Slack message as a thread reply. ` +
    `channel_id: ${channelStr}, thread_ts: ${threadTs}. ${THREADING_NOTE} ` +
    `Body: «${escapedBody}».${trailer}` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
