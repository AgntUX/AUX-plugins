// =============================================================================
// agntux-slack-view.ts — compose_view + canvas_view ViewTools for the
// agntux-slack plugin's MCP Apps.
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
} from "@agntux/plugin-runtime";

// ── Constants & caps ─────────────────────────────────────────────────────────

const COMPOSE_RESOURCE_URI = "ui://agntux-slack/compose" as const;
const CANVAS_RESOURCE_URI = "ui://agntux-slack/canvas" as const;

const MAX_DRAFTED_BODY_CHARS = 4000;
const MAX_PERSONALIZATION_SIGNALS = 4;
const MAX_SIGNAL_CHARS = 120;
const MAX_PARTICIPANTS = 12;
const MAX_MESSAGES_PREVIEW = 8;
const MAX_MESSAGE_EXCERPT_CHARS = 200;
const MAX_EXCERPT_CHARS = 300;
const MAX_TITLE_CHARS = 80;
const MAX_TLDR_CHARS = 500;
const MAX_DECISIONS = 8;
const MAX_DECISION_CHARS = 200;
const MAX_OPEN_QUESTIONS = 8;
const MAX_QUESTION_CHARS = 200;
const MAX_FOLLOWUP_CHARS = 200;

// ── Types ────────────────────────────────────────────────────────────────────

type InitialVerb = "draft" | "schedule" | "save_draft";

interface ComposeArgs {
  action_id: string;
}

interface ComposePayloadOk {
  action_id: string;
  initial_verb: InitialVerb;
  channel: { id: string; name: string; is_dm: boolean };
  thread: {
    parent_ts: string;
    parent_author_real_name: string;
    parent_excerpt: string;
    last_reply_ts: string | null;
    last_reply_author_real_name: string | null;
    last_reply_excerpt: string | null;
    total_replies: number;
    participants: string[];
  };
  messages_preview: Array<{ ts: string; author: string; body_excerpt: string }>;
  messages_truncated: boolean;
  drafted_body: string;
  personalization_signals: string[];
  proposed_send_time: string | null;
  slack_permalink: string | null;
}

interface ComposePayloadErr {
  error:
    | "action_not_found"
    | "action_already_handled"
    | "compose_payload_missing";
}

type ComposePayload = ComposePayloadOk | ComposePayloadErr;

interface CanvasArgs {
  action_id: string;
}

interface CanvasPayloadOk {
  action_id: string;
  channel: { id: string; name: string };
  thread: {
    parent_ts: string;
    total_replies: number;
    participants: string[];
  };
  drafted_canvas: {
    title: string;
    tldr: string;
    decisions: string[];
    open_questions: string[];
    participants: string[];
  };
  proposed_followup_message: string;
}

interface CanvasPayloadErr {
  error:
    | "action_not_found"
    | "action_already_handled"
    | "canvas_payload_missing";
}

type CanvasPayload = CanvasPayloadOk | CanvasPayloadErr;

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

// ── compose_view handler ─────────────────────────────────────────────────────

async function handleCompose(
  args: ComposeArgs,
  ctx: ViewToolContext,
): Promise<{ structuredContent: ComposePayload }> {
  const actionId = asString(args.action_id);
  if (!actionId || !/^[a-zA-Z0-9_-]+$/.test(actionId)) {
    return { structuredContent: { error: "action_not_found" } };
  }
  const path = `actions/${actionId}.md`;
  let buf: Buffer;
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
  const personalizationSignals = onDisk.personalization_signals
    .slice(0, MAX_PERSONALIZATION_SIGNALS)
    .filter((s): s is string => typeof s === "string")
    .map((s) => truncate(s, MAX_SIGNAL_CHARS));
  const rawMessages = onDisk.thread_context.messages_preview ?? [];
  const messagesPreview = rawMessages
    .slice(0, MAX_MESSAGES_PREVIEW)
    .map((m) => ({
      ts: asString(m.ts),
      author: asString(m.author),
      body_excerpt: truncate(asString(m.body_excerpt), MAX_MESSAGE_EXCERPT_CHARS),
    }));
  const payload: ComposePayloadOk = {
    action_id: actionId,
    initial_verb: "draft",
    channel: {
      id: onDisk.channel.id,
      name: onDisk.channel.name,
      is_dm: onDisk.channel.is_dm,
    },
    thread: {
      parent_ts: onDisk.thread_context.parent_ts,
      parent_author_real_name: onDisk.thread_context.parent_author_real_name,
      parent_excerpt: truncate(
        onDisk.thread_context.parent_excerpt,
        MAX_EXCERPT_CHARS,
      ),
      last_reply_ts: onDisk.thread_context.last_reply_ts,
      last_reply_author_real_name:
        onDisk.thread_context.last_reply_author_real_name,
      last_reply_excerpt: onDisk.thread_context.last_reply_excerpt
        ? truncate(
            onDisk.thread_context.last_reply_excerpt,
            MAX_EXCERPT_CHARS,
          )
        : null,
      total_replies: onDisk.thread_context.total_replies,
      participants: onDisk.thread_context.participants.slice(
        0,
        MAX_PARTICIPANTS,
      ),
    },
    messages_preview: messagesPreview,
    messages_truncated: rawMessages.length > MAX_MESSAGES_PREVIEW,
    drafted_body: truncate(onDisk.drafted_body, MAX_DRAFTED_BODY_CHARS),
    personalization_signals: personalizationSignals,
    proposed_send_time: null,
    slack_permalink: onDisk.slack_permalink,
  };
  return { structuredContent: payload };
}

// ── canvas_view handler ──────────────────────────────────────────────────────

async function handleCanvas(
  args: CanvasArgs,
  ctx: ViewToolContext,
): Promise<{ structuredContent: CanvasPayload }> {
  const actionId = asString(args.action_id);
  if (!actionId || !/^[a-zA-Z0-9_-]+$/.test(actionId)) {
    return { structuredContent: { error: "action_not_found" } };
  }
  const path = `actions/${actionId}.md`;
  let buf: Buffer;
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
  const onDisk = parsed.canvas_payload;
  if (!onDisk) {
    return { structuredContent: { error: "canvas_payload_missing" } };
  }
  const payload: CanvasPayloadOk = {
    action_id: actionId,
    channel: {
      id: onDisk.channel.id,
      name: onDisk.channel.name,
    },
    thread: {
      parent_ts: onDisk.thread.parent_ts,
      total_replies: onDisk.thread.total_replies,
      participants: onDisk.thread.participants.slice(0, MAX_PARTICIPANTS),
    },
    drafted_canvas: {
      title: truncate(onDisk.drafted_canvas.title, MAX_TITLE_CHARS),
      tldr: truncate(onDisk.drafted_canvas.tldr, MAX_TLDR_CHARS),
      decisions: onDisk.drafted_canvas.decisions
        .slice(0, MAX_DECISIONS)
        .map((d) => truncate(d, MAX_DECISION_CHARS)),
      open_questions: onDisk.drafted_canvas.open_questions
        .slice(0, MAX_OPEN_QUESTIONS)
        .map((q) => truncate(q, MAX_QUESTION_CHARS)),
      participants: onDisk.drafted_canvas.participants.slice(0, MAX_PARTICIPANTS),
    },
    proposed_followup_message: truncate(
      onDisk.proposed_followup_message ?? "",
      MAX_FOLLOWUP_CHARS,
    ),
  };
  return { structuredContent: payload };
}

// ── Descriptors ──────────────────────────────────────────────────────────────

const composeView: ViewTool<ComposeArgs, ComposePayload> = {
  descriptor: {
    name: "agntux_slack_compose_view",
    description:
      "Open the Slack reply composer for an action. Pass action_id; the handler reads the action file's `## Compose payload` body section.",
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
        initial_verb: { type: "string" },
        error: { type: "string" },
      },
      additionalProperties: true,
    },
    ui_resource_uri: COMPOSE_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleCompose,
};

const canvasView: ViewTool<CanvasArgs, CanvasPayload> = {
  descriptor: {
    name: "agntux_slack_canvas_view",
    description:
      "Open the Slack canvas summariser for an action. Pass action_id; the handler reads the action file's `## Canvas payload` body section.",
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
    ui_resource_uri: CANVAS_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleCanvas,
};

const mod: ViewToolModule = { viewTools: [composeView, canvasView] };
export default mod;
