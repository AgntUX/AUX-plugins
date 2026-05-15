// =============================================================================
// agntux-slack-view.ts — compose_view + canvas_view ViewTools for the
// agntux-slack plugin's MCP Apps.
//
// Loaded server-side by the remote MCP registry; reads action files from
// ctx.fs (S3-backed in production, local-fs in the developer iteration
// loop). No node:fs imports — handler talks to ctx.fs only.
//
// The slack on-disk YAML shape is plugin-specific and does NOT match
// @agntux/plugin-runtime's gmail-shaped `ComposePayloadOnDisk`. The
// runtime's `parseComposePayload` is gmail-only by design (see its
// JSDoc). So we re-extract the slack `## Compose payload` and
// `## Canvas payload` body sections directly via `extractFencedYaml`
// + js-yaml, with slack-specific types defined locally.
// =============================================================================

import {
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  ViewToolFsError,
  extractFencedYaml,
  parseFrontmatter,
} from "@agntux/plugin-runtime";
import yaml from "js-yaml";

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

// ── Slack on-disk YAML shapes ────────────────────────────────────────────────

interface SlackChannel {
  id: string;
  name: string;
  is_dm: boolean;
}

interface SlackMessagePreview {
  ts: string;
  author: string;
  body_excerpt: string;
}

interface SlackThreadContext {
  parent_ts: string;
  parent_author_real_name: string;
  parent_excerpt: string;
  last_reply_ts: string | null;
  last_reply_author_real_name: string | null;
  last_reply_excerpt: string | null;
  total_replies: number;
  participants: string[];
  messages_preview: SlackMessagePreview[];
}

interface SlackComposePayloadOnDisk {
  channel: SlackChannel;
  thread_context: SlackThreadContext;
  drafted_body: string;
  personalization_signals: string[];
  slack_permalink: string | null;
}

interface SlackCanvasThread {
  parent_ts: string;
  total_replies: number;
  participants: string[];
}

interface SlackCanvasDraft {
  title: string;
  tldr: string;
  decisions: string[];
  open_questions: string[];
  participants: string[];
}

interface SlackCanvasPayloadOnDisk {
  channel: { id: string; name: string };
  thread: SlackCanvasThread;
  drafted_canvas: SlackCanvasDraft;
  proposed_followup_message: string | null;
}

// ── Wire shapes returned to the iframe ───────────────────────────────────────

type InitialVerb = "draft" | "schedule" | "save_draft";

interface ComposeArgs {
  action_id: string;
}

interface ComposePayloadOk {
  action_id: string;
  initial_verb: InitialVerb;
  channel: SlackChannel;
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
  messages_preview: SlackMessagePreview[];
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
  thread: SlackCanvasThread;
  drafted_canvas: SlackCanvasDraft;
  proposed_followup_message: string;
}

interface CanvasPayloadErr {
  error: "action_not_found" | "action_already_handled" | "canvas_payload_missing";
}

type CanvasPayload = CanvasPayloadOk | CanvasPayloadErr;

// ── Coercion helpers ─────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + "…";
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function asSlackChannel(v: unknown): SlackChannel {
  const r = asRecord(v);
  return {
    id: asString(r.id),
    name: asString(r.name),
    is_dm: asBool(r.is_dm),
  };
}

function asMessagesPreview(v: unknown): SlackMessagePreview[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((row): SlackMessagePreview | null => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      return {
        ts: asString(r.ts),
        author: asString(r.author),
        body_excerpt: asString(r.body_excerpt),
      };
    })
    .filter((m): m is SlackMessagePreview => m !== null);
}

function asSlackThreadContext(v: unknown): SlackThreadContext {
  const r = asRecord(v);
  return {
    parent_ts: asString(r.parent_ts),
    parent_author_real_name: asString(r.parent_author_real_name),
    parent_excerpt: asString(r.parent_excerpt),
    last_reply_ts: asStringOrNull(r.last_reply_ts),
    last_reply_author_real_name: asStringOrNull(r.last_reply_author_real_name),
    last_reply_excerpt: asStringOrNull(r.last_reply_excerpt),
    total_replies: asNumber(r.total_replies),
    participants: asStringArray(r.participants),
    messages_preview: asMessagesPreview(r.messages_preview),
  };
}

function parseSlackComposePayload(body: string): SlackComposePayloadOnDisk | null {
  const yamlBody = extractFencedYaml(body, "Compose payload");
  if (yamlBody == null) return null;
  let raw: unknown;
  try {
    raw = yaml.load(yamlBody);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    channel: asSlackChannel(r.channel),
    thread_context: asSlackThreadContext(r.thread_context),
    drafted_body: asString(r.drafted_body),
    personalization_signals: asStringArray(r.personalization_signals),
    slack_permalink: asStringOrNull(r.slack_permalink),
  };
}

function parseSlackCanvasPayload(body: string): SlackCanvasPayloadOnDisk | null {
  const yamlBody = extractFencedYaml(body, "Canvas payload");
  if (yamlBody == null) return null;
  let raw: unknown;
  try {
    raw = yaml.load(yamlBody);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const channelR = asRecord(r.channel);
  const threadR = asRecord(r.thread);
  const draftR = asRecord(r.drafted_canvas);
  return {
    channel: {
      id: asString(channelR.id),
      name: asString(channelR.name),
    },
    thread: {
      parent_ts: asString(threadR.parent_ts),
      total_replies: asNumber(threadR.total_replies),
      participants: asStringArray(threadR.participants),
    },
    drafted_canvas: {
      title: asString(draftR.title),
      tldr: asString(draftR.tldr),
      decisions: asStringArray(draftR.decisions),
      open_questions: asStringArray(draftR.open_questions),
      participants: asStringArray(draftR.participants),
    },
    proposed_followup_message: asStringOrNull(r.proposed_followup_message),
  };
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

async function readActionFile(
  ctx: ViewToolContext,
  actionId: string,
): Promise<string | "not-found" | "error"> {
  const path = `actions/${actionId}.md`;
  try {
    const buf = await ctx.fs.readFile(path);
    return buf.toString("utf8");
  } catch (err) {
    if (err instanceof ViewToolFsError && err.code === "not-found") {
      return "not-found";
    }
    throw err;
  }
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
  const text = await readActionFile(ctx, actionId);
  if (text === "not-found" || text === "error") {
    return { structuredContent: { error: "action_not_found" } };
  }
  const { frontmatter, body } = parseFrontmatter(text);
  if (isActionAlreadyHandled(frontmatter.status, frontmatter.snoozed_until)) {
    return { structuredContent: { error: "action_already_handled" } };
  }
  const onDisk = parseSlackComposePayload(body);
  if (!onDisk) {
    return { structuredContent: { error: "compose_payload_missing" } };
  }
  const personalizationSignals = onDisk.personalization_signals
    .slice(0, MAX_PERSONALIZATION_SIGNALS)
    .map((s) => truncate(s, MAX_SIGNAL_CHARS));
  const messagesPreview = onDisk.thread_context.messages_preview
    .slice(0, MAX_MESSAGES_PREVIEW)
    .map((m) => ({
      ts: m.ts,
      author: m.author,
      body_excerpt: truncate(m.body_excerpt, MAX_MESSAGE_EXCERPT_CHARS),
    }));
  const payload: ComposePayloadOk = {
    action_id: actionId,
    initial_verb: "draft",
    channel: onDisk.channel,
    thread: {
      parent_ts: onDisk.thread_context.parent_ts,
      parent_author_real_name: onDisk.thread_context.parent_author_real_name,
      parent_excerpt: truncate(onDisk.thread_context.parent_excerpt, MAX_EXCERPT_CHARS),
      last_reply_ts: onDisk.thread_context.last_reply_ts,
      last_reply_author_real_name:
        onDisk.thread_context.last_reply_author_real_name,
      last_reply_excerpt: onDisk.thread_context.last_reply_excerpt
        ? truncate(onDisk.thread_context.last_reply_excerpt, MAX_EXCERPT_CHARS)
        : null,
      total_replies: onDisk.thread_context.total_replies,
      participants: onDisk.thread_context.participants.slice(0, MAX_PARTICIPANTS),
    },
    messages_preview: messagesPreview,
    messages_truncated:
      onDisk.thread_context.messages_preview.length > MAX_MESSAGES_PREVIEW,
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
  const text = await readActionFile(ctx, actionId);
  if (text === "not-found" || text === "error") {
    return { structuredContent: { error: "action_not_found" } };
  }
  const { frontmatter, body } = parseFrontmatter(text);
  if (isActionAlreadyHandled(frontmatter.status, frontmatter.snoozed_until)) {
    return { structuredContent: { error: "action_already_handled" } };
  }
  const onDisk = parseSlackCanvasPayload(body);
  if (!onDisk) {
    return { structuredContent: { error: "canvas_payload_missing" } };
  }
  const payload: CanvasPayloadOk = {
    action_id: actionId,
    channel: onDisk.channel,
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
//
// `data_paths` is intentionally omitted: emit-manifest.mjs defaults to
// `[{ pattern: "actions/{id}.md", scope: "personal" }]` when the descriptor
// doesn't ship one, which is exactly what slack needs. The ViewToolDescriptor
// runtime type doesn't declare data_paths (it's a manifest-layer field).

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
  },
  handle: handleCanvas,
};

const mod: ViewToolModule = { viewTools: [composeView, canvasView] };
export default mod;
