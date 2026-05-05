// =============================================================================
// compose_view — render tool for the agntux-slack Slack reply compose MCP App.
//
// Shape rules (mirrors triage-view.ts):
//   - The draft skill has already fetched thread context from Slack and
//     composed the draft body. It passes the structured context here so this
//     tool does NOT call Slack tools — it is read-only and stateless.
//   - The handler reads <root>/actions/{action_id}.md to verify the action
//     exists and is still open (not done/dismissed/snoozed-future).
//   - Hard caps are enforced server-side. Never throws from the happy path.
//
// Returns:
//   On success — { structuredContent: ComposePayload, content: [...], _meta }
//   On error   — { structuredContent: { error: '...' }, content: [...], _meta }
//
// Committed-envelope encoding (for draft-flow-author):
//   Component emits: ux: Use the agntux-slack plugin to commit the drafted
//   reply for action {action_id} with body «{edited_body}» (mode: {send|
//   schedule|save_draft}{, send_at: {RFC3339}}).
//   Unicode guillemets «»  delimit the body. Literal « or » in the body are
//   escaped by doubling (««, »»). The draft skill parser reverses the doubling.
// =============================================================================

import { statSync } from "node:fs";
import { join } from "node:path";
import { expectedAgntuxRoot } from "../agntux-root.js";
import { parseActionFile } from "../parse-action.js";

// ── Constants & caps ─────────────────────────────────────────────────────────

const COMPOSE_RESOURCE_URI = "ui://slack-compose" as const;
const MAX_DRAFTED_BODY_CHARS = 4000;
const MAX_PERSONALIZATION_SIGNALS = 4;
const MAX_SIGNAL_CHARS = 120;
const MAX_PARTICIPANTS = 6;
const MAX_MESSAGES_PREVIEW = 8;
const MAX_MESSAGE_EXCERPT_CHARS = 200;
const MAX_EXCERPT_CHARS = 300;

// ── Types ────────────────────────────────────────────────────────────────────

type InitialVerb = "draft" | "schedule" | "save_draft";

interface ChannelInfo {
  id: string;
  name: string;
  is_dm: boolean;
}

interface ThreadInfo {
  parent_ts: string;
  parent_author_real_name: string;
  parent_excerpt: string;
  last_reply_ts: string | null;
  last_reply_author_real_name: string | null;
  last_reply_excerpt: string | null;
  total_replies: number;
  participants: string[];
}

interface MessagePreview {
  ts: string;
  author: string;
  body_excerpt: string;
}

interface ComposeStructuredContent {
  action_id: string;
  initial_verb: InitialVerb;
  channel: ChannelInfo;
  thread: ThreadInfo;
  messages_preview: MessagePreview[];
  messages_truncated: boolean;
  drafted_body: string;
  personalization_signals: string[];
  proposed_send_time: string | null;
  slack_permalink: string | null;
}

interface ComposeStructuredError {
  error:
    | "action_not_found"
    | "action_already_handled"
    | "agntux_root_missing"
    | "license_paused";
}

interface ViewToolMeta {
  ui: {
    resourceUri: typeof COMPOSE_RESOURCE_URI;
    visibility: ["model", "app"];
  };
}

interface ViewToolSuccess {
  structuredContent: ComposeStructuredContent;
  content: Array<{ type: "text"; text: string }>;
  _meta: ViewToolMeta;
}

interface ViewToolError {
  structuredContent: ComposeStructuredError;
  content: Array<{ type: "text"; text: string }>;
  _meta: ViewToolMeta;
}

type ViewToolResult = ViewToolSuccess | ViewToolError;

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

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asBoolean(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asInitialVerb(v: unknown): InitialVerb {
  if (v === "draft" || v === "schedule" || v === "save_draft") return v;
  return "draft";
}

function structuredError(
  kind: ComposeStructuredError["error"],
  message: string,
): ViewToolError {
  return {
    structuredContent: { error: kind },
    content: [{ type: "text", text: message }],
    _meta: { ui: { resourceUri: COMPOSE_RESOURCE_URI, visibility: ["model", "app"] } },
  };
}

function isActionAlreadyHandled(status: string, snoozedUntil: string | null): boolean {
  if (status === "done" || status === "dismissed") return true;
  if (status === "snoozed" && snoozedUntil) {
    const until = new Date(snoozedUntil).getTime();
    if (Number.isFinite(until) && until > Date.now()) return true;
  }
  return false;
}

function parseChannelArg(raw: unknown): ChannelInfo {
  if (!raw || typeof raw !== "object") return { id: "", name: "", is_dm: false };
  const r = raw as Record<string, unknown>;
  return {
    id: asString(r.id),
    name: asString(r.name),
    is_dm: asBoolean(r.is_dm),
  };
}

function parseThreadContextArg(raw: unknown): Omit<ThreadInfo, "participants"> & { participants: string[] } {
  if (!raw || typeof raw !== "object") {
    return {
      parent_ts: "",
      parent_author_real_name: "",
      parent_excerpt: "",
      last_reply_ts: null,
      last_reply_author_real_name: null,
      last_reply_excerpt: null,
      total_replies: 0,
      participants: [],
    };
  }
  const r = raw as Record<string, unknown>;
  return {
    parent_ts: asString(r.parent_ts),
    parent_author_real_name: asString(r.parent_author_real_name),
    parent_excerpt: truncate(asString(r.parent_excerpt), MAX_EXCERPT_CHARS),
    last_reply_ts: asStringOrNull(r.last_reply_ts),
    last_reply_author_real_name: asStringOrNull(r.last_reply_author_real_name),
    last_reply_excerpt: asStringOrNull(r.last_reply_excerpt)
      ? truncate(asString(r.last_reply_excerpt), MAX_EXCERPT_CHARS)
      : null,
    total_replies: asNumber(r.total_replies),
    participants: asStringArray(r.participants).slice(0, MAX_PARTICIPANTS),
  };
}

function parseMessagesPreviewArg(raw: unknown): MessagePreview[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_MESSAGES_PREVIEW)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      return {
        ts: asString(r.ts),
        author: asString(r.author),
        body_excerpt: truncate(asString(r.body_excerpt), MAX_MESSAGE_EXCERPT_CHARS),
      };
    })
    .filter((x): x is MessagePreview => x !== null);
}

// ── Tool descriptor ──────────────────────────────────────────────────────────

export const composeViewTool = {
  name: "compose_view",
  description:
    "Render the agntux-slack Slack reply compose card. Called by the draft " +
    "skill after it has fetched thread context from Slack and composed a " +
    "draft body. Returns a structured compose payload the host renders as an " +
    "editable reply card (ui://slack-compose) with Send / Schedule / Save as " +
    "draft modes. Returns _meta.ui.resourceUri = ui://slack-compose.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action_id: {
        type: "string",
        description: "Slug of the action item (from filename, no .md suffix).",
      },
      initial_verb: {
        type: "string",
        enum: ["draft", "schedule", "save_draft"],
        description: "Which mode tab to pre-select: draft, schedule, or save_draft.",
      },
      drafted_body: {
        type: "string",
        description: "Agent-composed draft reply body, ≤4000 chars. Truncated if longer.",
      },
      personalization_signals: {
        type: "array",
        items: { type: "string" },
        description: "Optional. Up to 4 bullet strings (≤120 chars each) explaining why this draft fits the user.",
      },
      thread_context: {
        type: "object",
        description: "Required. Structured thread context: { parent_excerpt, parent_author_real_name, last_reply_excerpt, last_reply_author_real_name, last_reply_ts, total_replies, participants[], messages_preview[] }.",
        properties: {
          parent_ts: { type: "string" },
          parent_author_real_name: { type: "string" },
          parent_excerpt: { type: "string" },
          last_reply_ts: { type: "string" },
          last_reply_author_real_name: { type: "string" },
          last_reply_excerpt: { type: "string" },
          total_replies: { type: "number" },
          participants: { type: "array", items: { type: "string" } },
          messages_preview: { type: "array" },
        },
      },
      channel: {
        type: "object",
        description: "Required. { id: string, name: string, is_dm: boolean }.",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          is_dm: { type: "boolean" },
        },
      },
      proposed_send_time: {
        type: "string",
        description: "Optional RFC 3339 datetime for schedule mode.",
      },
      slack_permalink: {
        type: "string",
        description: "Optional URL to the source thread.",
      },
    },
    required: ["action_id", "initial_verb", "drafted_body", "thread_context", "channel"],
  },
  _meta: {
    ui: {
      resourceUri: COMPOSE_RESOURCE_URI,
    },
  },
} as const;

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleComposeView(
  args: Record<string, unknown>,
): Promise<ViewToolResult> {
  const actionId = asString(args.action_id);
  if (!actionId || !/^[a-zA-Z0-9_-]+$/.test(actionId)) {
    return structuredError(
      "action_not_found",
      `compose_view: invalid action_id '${actionId}'.`,
    );
  }

  const root = expectedAgntuxRoot();
  const actionPath = join(root, "actions", `${actionId}.md`);

  try {
    statSync(actionPath);
  } catch {
    return structuredError(
      "action_not_found",
      `compose_view: action file not found at ${actionPath}.`,
    );
  }

  let parsed;
  try {
    parsed = parseActionFile(actionPath);
  } catch {
    return structuredError(
      "action_not_found",
      `compose_view: failed to parse action file ${actionPath}.`,
    );
  }

  const fm = parsed.frontmatter;
  if (isActionAlreadyHandled(fm.status, fm.snoozed_until)) {
    return structuredError(
      "action_already_handled",
      `compose_view: action ${actionId} is no longer open (status: ${fm.status}).`,
    );
  }

  // Apply caps to agent-supplied args
  const draftedBody = truncate(asString(args.drafted_body), MAX_DRAFTED_BODY_CHARS);
  const rawSignals = Array.isArray(args.personalization_signals)
    ? (args.personalization_signals as unknown[])
    : [];
  const personalizationSignals = rawSignals
    .slice(0, MAX_PERSONALIZATION_SIGNALS)
    .filter((s): s is string => typeof s === "string")
    .map((s) => truncate(s, MAX_SIGNAL_CHARS));

  const channel = parseChannelArg(args.channel);
  const threadCtx = parseThreadContextArg(args.thread_context);

  // Extract raw messages_preview once so the truncation check and the
  // normalizer share a single source of truth.
  const rawThreadCtx =
    args.thread_context && typeof args.thread_context === "object"
      ? (args.thread_context as Record<string, unknown>)
      : null;
  const rawMessages = Array.isArray(rawThreadCtx?.messages_preview)
    ? (rawThreadCtx.messages_preview as unknown[])
    : [];
  const messagesPreview = parseMessagesPreviewArg(rawMessages);
  const messagesTruncated = rawMessages.length > MAX_MESSAGES_PREVIEW;

  const proposedSendTime = asStringOrNull(args.proposed_send_time);
  const slackPermalink = asStringOrNull(args.slack_permalink);
  const initialVerb = asInitialVerb(args.initial_verb);

  const payload: ComposeStructuredContent = {
    action_id: actionId,
    initial_verb: initialVerb,
    channel,
    thread: {
      parent_ts: threadCtx.parent_ts,
      parent_author_real_name: threadCtx.parent_author_real_name,
      parent_excerpt: threadCtx.parent_excerpt,
      last_reply_ts: threadCtx.last_reply_ts,
      last_reply_author_real_name: threadCtx.last_reply_author_real_name,
      last_reply_excerpt: threadCtx.last_reply_excerpt,
      total_replies: threadCtx.total_replies,
      participants: threadCtx.participants,
    },
    messages_preview: messagesPreview,
    messages_truncated: messagesTruncated,
    drafted_body: draftedBody,
    personalization_signals: personalizationSignals,
    proposed_send_time: proposedSendTime,
    slack_permalink: slackPermalink,
  };

  const channelLabel = channel.is_dm ? `DM` : `#${channel.name}`;

  return {
    structuredContent: payload,
    content: [
      {
        type: "text",
        text: `compose_view rendered for action ${actionId} (${channelLabel}, mode: ${initialVerb}).`,
      },
    ],
    _meta: {
      ui: {
        resourceUri: COMPOSE_RESOURCE_URI,
        visibility: ["model", "app"],
      },
    },
  };
}
