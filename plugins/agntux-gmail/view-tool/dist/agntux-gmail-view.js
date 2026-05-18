// src/agntux-gmail-view.ts
import {
  ViewToolFsError,
  parseActionFile
} from "@agntux/plugin-runtime";
var COMPOSE_RESOURCE_URI = "ui://agntux-gmail/compose";
var MAX_DRAFTED_BODY_CHARS = 4e3;
var MAX_PERSONALIZATION_SIGNALS = 4;
var MAX_SIGNAL_CHARS = 120;
var MAX_PARTICIPANTS = 12;
var MAX_RECIPIENTS_PER_FIELD = 50;
var MAX_EXCERPT_CHARS = 300;
var MAX_EMAIL_CONTEXT_CHARS = 1e3;
var MAX_SUBJECT_CHARS = 200;
function truncate(s, max) {
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + "\u2026";
}
function asString(v, fallback = "") {
  return typeof v === "string" ? v : fallback;
}
function isActionAlreadyHandled(status, snoozedUntil) {
  if (status === "done" || status === "dismissed") return true;
  if (status === "snoozed" && snoozedUntil) {
    const until = new Date(snoozedUntil).getTime();
    if (Number.isFinite(until) && until > Date.now()) return true;
  }
  return false;
}
function deriveUserEmailFromUrl(url) {
  if (!url) return null;
  const m = /[?&]authuser=([^&#]+)/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}
async function handleCompose(args, ctx) {
  const actionId = asString(args.action_id);
  if (!actionId || !/^[a-zA-Z0-9_-]+$/.test(actionId)) {
    return { structuredContent: { error: "action_not_found" } };
  }
  const path = `actions/${actionId}.md`;
  let buf;
  try {
    buf = await ctx.fs.readFile(path);
  } catch (err) {
    if (err instanceof ViewToolFsError && err.code === "not-found") {
      return { structuredContent: { error: "action_not_found" } };
    }
    throw err;
  }
  let parsed;
  try {
    parsed = parseActionFile(buf.toString("utf8"));
  } catch {
    return { structuredContent: { error: "action_not_found" } };
  }
  const fm = parsed.frontmatter;
  if (isActionAlreadyHandled(fm.status, fm.snoozed_until)) {
    return { structuredContent: { error: "action_already_handled" } };
  }
  const onDisk = parsed.compose_payload;
  if (!onDisk) {
    return { structuredContent: { error: "compose_payload_missing" } };
  }
  const personalizationSignals = onDisk.personalization_signals.slice(0, MAX_PERSONALIZATION_SIGNALS).map((s) => truncate(s, MAX_SIGNAL_CHARS));
  const userEmail = deriveUserEmailFromUrl(onDisk.gmail_thread_url);
  const payload = {
    action_id: actionId,
    thread: {
      thread_id: onDisk.thread_context.thread_id,
      subject: truncate(onDisk.thread_context.subject, MAX_SUBJECT_CHARS),
      parent_message_id: onDisk.thread_context.parent_message_id,
      parent_author_real_name: onDisk.thread_context.parent_author_real_name,
      parent_author_email: onDisk.thread_context.parent_author_email,
      parent_excerpt: truncate(
        onDisk.thread_context.parent_excerpt,
        MAX_EXCERPT_CHARS
      ),
      last_message_id: onDisk.thread_context.last_message_id,
      last_author_real_name: onDisk.thread_context.last_author_real_name,
      last_author_email: onDisk.thread_context.last_author_email,
      last_excerpt: truncate(
        onDisk.thread_context.last_excerpt,
        MAX_EXCERPT_CHARS
      ),
      total_messages: onDisk.thread_context.total_messages,
      participants: onDisk.thread_context.participants.slice(0, MAX_PARTICIPANTS)
    },
    recipients: {
      to: onDisk.recipients.to.slice(0, MAX_RECIPIENTS_PER_FIELD),
      cc: onDisk.recipients.cc.slice(0, MAX_RECIPIENTS_PER_FIELD),
      bcc: onDisk.recipients.bcc.slice(0, MAX_RECIPIENTS_PER_FIELD)
    },
    reply_to_message_id: onDisk.reply_to_message_id,
    drafted_body: truncate(onDisk.drafted_body, MAX_DRAFTED_BODY_CHARS),
    personalization_signals: personalizationSignals,
    email_context: truncate(parsed.email_context, MAX_EMAIL_CONTEXT_CHARS),
    gmail_thread_url: onDisk.gmail_thread_url,
    user_email: userEmail,
    account_index: onDisk.account_index
  };
  return { structuredContent: payload };
}
var composeView = {
  descriptor: {
    name: "agntux_gmail_compose_view",
    description: "Open the Gmail reply composer for an action. Pass action_id; the handler reads the action file's `## Compose payload` body section. Trigger phrases (host's tool selector matches the user's chat message against this list): `/agntux-gmail open the reply composer for action {id}`, `/agntux-gmail open the email composer for action {id}`, `/agntux-gmail draft an email reply for action {id}`. The legacy `ux: Use the agntux-gmail plugin to \u2026` envelope is still accepted for backwards compatibility with action items already on disk. Once this UI is rendered, the user sees everything they need in the iframe \u2014 do NOT add any chat commentary after rendering, and do NOT make any further tool calls; the UI is the response. After the user clicks Save Draft inside this UI and the Gmail Connector tool returns, do NOT re-render this AgntUX compose UI and do NOT render Gmail's native draft/send UI \u2014 the action is complete; return the connector's success/error as plain chat text.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        error: { type: "string" }
      },
      additionalProperties: true
    },
    ui_resource_uri: COMPOSE_RESOURCE_URI
    // data_paths intentionally omitted — emit-manifest.mjs supplies the
    // personal `actions/{id}.md` default and ViewToolDescriptor's contract
    // (see context.ts) keeps data_paths in the manifest layer.
  },
  handle: handleCompose
};
var mod = { viewTools: [composeView] };
var agntux_gmail_view_default = mod;
export {
  agntux_gmail_view_default as default
};
