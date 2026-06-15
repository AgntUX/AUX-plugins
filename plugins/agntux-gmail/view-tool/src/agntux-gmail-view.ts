// =============================================================================
// agntux-gmail-view.ts — compose_view ViewTool for the agntux-gmail plugin's
// MCP App.
//
// Loaded server-side by the remote MCP registry; reads action files from
// ctx.fs (S3-backed in production, local-fs in the developer iteration
// loop). No node:fs imports — handler talks to ctx.fs only.
// =============================================================================

import {
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  ViewToolFsError,
  parseActionFile,
  renderConfirmationText,
} from "@agntux/plugin-runtime";

// ── Constants & caps ─────────────────────────────────────────────────────────

const COMPOSE_RESOURCE_URI = "ui://agntux-gmail/compose" as const;
// Human-readable UI label fed to renderConfirmationText() so the model's
// `content[].text` block names the surface the host just materialized.
// Both success AND error branches ship the same block — the iframe
// renders both, so the "stop after rendering" framing applies either
// way. Wording centralized in @agntux/plugin-runtime.
const COMPOSE_UI_LABEL = "AgntUX Gmail reply composer";
const MAX_DRAFTED_BODY_CHARS = 4000;
const MAX_PERSONALIZATION_SIGNALS = 4;
const MAX_SIGNAL_CHARS = 120;
const MAX_PARTICIPANTS = 12;
const MAX_RECIPIENTS_PER_FIELD = 50;
const MAX_EXCERPT_CHARS = 300;
const MAX_EMAIL_CONTEXT_CHARS = 1000;
const MAX_SUBJECT_CHARS = 200;

// ── Types ────────────────────────────────────────────────────────────────────

interface ComposeArgs {
  action_id: string;
}

interface Participant {
  real_name: string;
  email: string;
}

interface ComposePayloadOk {
  action_id: string;
  thread: {
    thread_id: string;
    subject: string;
    parent_message_id: string;
    parent_author_real_name: string;
    parent_author_email: string;
    parent_excerpt: string;
    last_message_id: string;
    last_author_real_name: string;
    last_author_email: string;
    last_excerpt: string;
    total_messages: number;
    participants: Participant[];
  };
  recipients: { to: string[]; cc: string[]; bcc: string[] };
  reply_to_message_id: string;
  drafted_body: string;
  personalization_signals: string[];
  email_context: string;
  gmail_thread_url: string | null;
  user_email: string | null;
  account_index: number | null;
}

interface ComposePayloadErr {
  error:
    | "action_not_found"
    | "action_already_handled"
    | "compose_payload_missing";
}

type ComposePayload = ComposePayloadOk | ComposePayloadErr;

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + "…";
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function isActionAlreadyHandled(
  status: string,
  snoozedUntil: string | null,
): boolean {
  if (status === "done" || status === "dismissed") return true;
  if (status === "snoozed" && snoozedUntil) {
    const until = new Date(snoozedUntil).getTime();
    if (Number.isFinite(until) && until > Date.now()) return true;
  }
  return false;
}

function deriveUserEmailFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = /[?&]authuser=([^&#]+)/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

// ── compose_view handler ─────────────────────────────────────────────────────

// Envelope helper: every return — success and error alike — must ship
// the canonical content[] block. Wrapping the bare structuredContent
// here keeps each branch a one-liner and makes the pass-14 linter's
// grep for `renderConfirmationText(` trivial.
function composeEnvelope(payload: ComposePayload): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ComposePayload;
} {
  return {
    content: [
      { type: "text", text: renderConfirmationText(COMPOSE_UI_LABEL) },
    ],
    structuredContent: payload,
  };
}

async function handleCompose(
  args: ComposeArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ComposePayload;
}> {
  const actionId = asString(args.action_id);
  if (!actionId || !/^[a-zA-Z0-9_-]+$/.test(actionId)) {
    return composeEnvelope({ error: "action_not_found" });
  }
  const path = `actions/${actionId}.md`;
  let buf: Buffer;
  try {
    buf = await ctx.fs.readFile(path);
  } catch (err) {
    if (err instanceof ViewToolFsError && err.code === "not-found") {
      return composeEnvelope({ error: "action_not_found" });
    }
    throw err;
  }
  let parsed;
  try {
    parsed = parseActionFile(buf.toString("utf8"));
  } catch {
    return composeEnvelope({ error: "action_not_found" });
  }
  const fm = parsed.frontmatter;
  if (isActionAlreadyHandled(fm.status, fm.snoozed_until)) {
    return composeEnvelope({ error: "action_already_handled" });
  }
  const onDisk = parsed.compose_payload;
  if (!onDisk) {
    return composeEnvelope({ error: "compose_payload_missing" });
  }
  const personalizationSignals = onDisk.personalization_signals
    .slice(0, MAX_PERSONALIZATION_SIGNALS)
    .map((s) => truncate(s, MAX_SIGNAL_CHARS));
  const userEmail = deriveUserEmailFromUrl(onDisk.gmail_thread_url);
  const payload: ComposePayloadOk = {
    action_id: actionId,
    thread: {
      thread_id: onDisk.thread_context.thread_id,
      subject: truncate(onDisk.thread_context.subject, MAX_SUBJECT_CHARS),
      parent_message_id: onDisk.thread_context.parent_message_id,
      parent_author_real_name: onDisk.thread_context.parent_author_real_name,
      parent_author_email: onDisk.thread_context.parent_author_email,
      parent_excerpt: truncate(
        onDisk.thread_context.parent_excerpt,
        MAX_EXCERPT_CHARS,
      ),
      last_message_id: onDisk.thread_context.last_message_id,
      last_author_real_name: onDisk.thread_context.last_author_real_name,
      last_author_email: onDisk.thread_context.last_author_email,
      last_excerpt: truncate(
        onDisk.thread_context.last_excerpt,
        MAX_EXCERPT_CHARS,
      ),
      total_messages: onDisk.thread_context.total_messages,
      participants: onDisk.thread_context.participants.slice(0, MAX_PARTICIPANTS),
    },
    recipients: {
      to: onDisk.recipients.to.slice(0, MAX_RECIPIENTS_PER_FIELD),
      cc: onDisk.recipients.cc.slice(0, MAX_RECIPIENTS_PER_FIELD),
      bcc: onDisk.recipients.bcc.slice(0, MAX_RECIPIENTS_PER_FIELD),
    },
    reply_to_message_id: onDisk.reply_to_message_id,
    drafted_body: truncate(onDisk.drafted_body, MAX_DRAFTED_BODY_CHARS),
    personalization_signals: personalizationSignals,
    email_context: truncate(parsed.email_context, MAX_EMAIL_CONTEXT_CHARS),
    gmail_thread_url: onDisk.gmail_thread_url,
    user_email: userEmail,
    account_index: onDisk.account_index,
  };
  return composeEnvelope(payload);
}

// ── Descriptor ───────────────────────────────────────────────────────────────

const composeView: ViewTool<ComposeArgs, ComposePayload> = {
  descriptor: {
    name: "agntux_gmail_compose_view",
    description:
      "Open the Gmail reply composer for an action. Pass action_id; the handler reads the action file's `## Compose payload` body section. Trigger phrases (host's tool selector matches the user's chat message against this list): `Use the agntux-gmail plugin to open the reply composer for action {id}`, `Use the agntux-gmail plugin to open the email composer for action {id}`, `Use the agntux-gmail plugin to draft an email reply for action {id}`. The legacy `ux: Use the agntux-gmail plugin to …` envelope is still accepted for backwards compatibility with action items already on disk. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards. After the user clicks Save Draft inside this iframe, the host invokes the Gmail connector's draft tool. The connector's success/error response is what the user needs next — surface it as plain chat text; the AgntUX view tool does not need to be re-invoked and the connector's own native UI does not need to be rendered.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        error: { type: "string" },
      },
      additionalProperties: true,
    },
    ui_resource_uri: COMPOSE_RESOURCE_URI,
    // data_paths intentionally omitted — emit-manifest.mjs supplies the
    // personal `actions/{id}.md` default and ViewToolDescriptor's contract
    // (see context.ts) keeps data_paths in the manifest layer.
  },
  handle: handleCompose,
};

const mod: ViewToolModule = { viewTools: [composeView] };
export default mod;
