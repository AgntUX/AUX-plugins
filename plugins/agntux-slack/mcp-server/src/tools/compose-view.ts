// =============================================================================
// compose_view — render tool for the agntux-slack Slack reply compose MCP App.
//
// Shape rules (mirrors triage-view.ts):
//   - The sync skill pre-composed the draft body and thread context at
//     ingest time and stored them in the action file's `## Compose payload`
//     body section. This tool reads <root>/actions/{action_id}.md, verifies
//     the action is still open (not done/dismissed/snoozed-future), and
//     lifts the payload — it does NOT call Slack tools (read-only,
//     stateless).
//   - Inline structured args still win when supplied (legacy / testing path).
//   - Hard caps are enforced server-side. Never throws from the happy path.
//
// Returns:
//   On success — { structuredContent: ComposePayload, content: [...], _meta }
//   On error   — { structuredContent: { error: '...' }, content: [...], _meta }
//
// Committed-envelope encoding (5.0.0+):
//   The component emits an envelope addressed at the user's Slack Connector
//   directly — no agntux-slack draft skill in the chain (the skill was
//   removed in 5.0.0). channel_id, thread_ts, body, mode, and send_at are
//   carried inline so the host has everything it needs without a disk read.
//   Unicode guillemets «» delimit the body; literal « or » in the body are
//   escaped by doubling (««, »»). See
//   ui-handlers/compose/component/src/lib/build-envelope.ts for the full
//   shape and rationale.
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
    | "license_paused"
    | "compose_payload_missing";
}

interface ViewToolMeta {
  ui: {
    resourceUri: typeof COMPOSE_RESOURCE_URI;
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
    _meta: { ui: { resourceUri: COMPOSE_RESOURCE_URI } },
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
  name: "agntux_slack_compose_view",
  description:
    "Render the Slack reply composer iframe for an action item. " +
    "TRIGGER PHRASES (map verbatim to args — do not paraphrase): " +
    "'open the reply composer for action {id}' → call with {action_id: id}; " +
    "'open the reply composer in schedule mode for action {id}' → call with " +
    "{action_id: id, initial_verb: \"schedule\"}. " +
    "For these click-time prompts, pass ONLY action_id (and initial_verb when " +
    "the phrase contains 'in schedule mode'). The tool reads the action " +
    "file's `## Compose payload` body section and lifts drafted_body, " +
    "thread_context, channel, personalization_signals, and slack_permalink " +
    "from disk. Do NOT pass drafted_body, thread_context, channel, " +
    "personalization_signals, or slack_permalink inline — those args are a " +
    "legacy back-compat surface for out-of-band working-memory callers, and " +
    "any inline value (including partial / empty objects) overrides the " +
    "on-disk payload destructively, producing an empty UI. Action files that " +
    "lack a `## Compose payload` section (pre-1.1.0) surface the " +
    "`compose_payload_missing` structured error envelope. Returns " +
    "_meta.ui.resourceUri = ui://slack-compose.",
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
        description:
          "Which mode tab to pre-select. MUST be set to 'schedule' when the " +
          "trigger phrase contains 'in schedule mode' (e.g., 'open the reply " +
          "composer in schedule mode for action {id}'). Otherwise omit (defaults " +
          "to 'draft'). 'save_draft' is reserved for legacy out-of-band callers.",
      },
      drafted_body: {
        type: "string",
        description:
          "LEGACY back-compat only. Do NOT pass for click-time trigger phrases — " +
          "the tool lifts the body from the action file's `## Compose payload`. " +
          "Inline override for out-of-band working-memory callers. ≤4000 chars; " +
          "truncated if longer.",
      },
      personalization_signals: {
        type: "array",
        items: { type: "string" },
        description:
          "LEGACY back-compat only. Do NOT pass for click-time trigger phrases. " +
          "Inline override for out-of-band working-memory callers.",
      },
      thread_context: {
        type: "object",
        description:
          "LEGACY back-compat only. Do NOT pass for click-time trigger phrases — " +
          "the tool lifts thread context from the action file's `## Compose " +
          "payload`. Inline override for out-of-band working-memory callers.",
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
        description:
          "LEGACY back-compat only. Do NOT pass for click-time trigger phrases — " +
          "the tool lifts channel from the action file's `## Compose payload`. " +
          "Inline override for out-of-band working-memory callers.",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          is_dm: { type: "boolean" },
        },
      },
      proposed_send_time: {
        type: "string",
        description:
          "LEGACY back-compat only. Do NOT pass for click-time trigger phrases — " +
          "the user picks the send time inside the iframe. Optional RFC 3339 " +
          "datetime for out-of-band callers that pre-compute a schedule time.",
      },
      slack_permalink: {
        type: "string",
        description:
          "LEGACY back-compat only. Do NOT pass for click-time trigger phrases. " +
          "Inline override for out-of-band working-memory callers.",
      },
    },
    required: ["action_id"],
  },
  // The MCP Apps spec defines two synonymous keys for declaring a tool's
  // associated UI resource. We emit both — modern hosts (MCPJam, latest
  // Claude.ai) read the nested `_meta.ui.resourceUri`; older hosts (Claude
  // Cowork desktop as of 5.x) only read the legacy flat `_meta["ui/resourceUri"]`
  // and otherwise fall back to text-rendering the structuredContent. The
  // upstream `registerAppTool` helper in @modelcontextprotocol/ext-apps
  // populates both for the same reason.
  _meta: {
    ui: {
      resourceUri: COMPOSE_RESOURCE_URI,
    },
    "ui/resourceUri": COMPOSE_RESOURCE_URI,
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

  // Dual-mode resolution: prefer inline args (legacy draft-skill commit-side
  // path) when present, otherwise fall back to the action file's `##
  // Compose payload` body section. Either source can satisfy the contract;
  // missing both surfaces compose_payload_missing.
  const onDisk = parsed.compose_payload;
  const inlineDraftedBody = asString(args.drafted_body);
  const hasInlineBody = inlineDraftedBody.length > 0;
  const inlineThreadCtx =
    args.thread_context && typeof args.thread_context === "object"
      ? (args.thread_context as Record<string, unknown>)
      : null;
  const inlineChannel =
    args.channel && typeof args.channel === "object"
      ? (args.channel as Record<string, unknown>)
      : null;

  if (!hasInlineBody && !onDisk) {
    return structuredError(
      "compose_payload_missing",
      `compose_view: action ${actionId} has no \`## Compose payload\` body section and no inline drafted_body was supplied.`,
    );
  }

  const draftedBody = truncate(
    hasInlineBody ? inlineDraftedBody : onDisk?.drafted_body ?? "",
    MAX_DRAFTED_BODY_CHARS,
  );

  const rawSignals = Array.isArray(args.personalization_signals)
    ? (args.personalization_signals as unknown[])
    : onDisk
      ? onDisk.personalization_signals
      : [];
  const personalizationSignals = rawSignals
    .slice(0, MAX_PERSONALIZATION_SIGNALS)
    .filter((s): s is string => typeof s === "string")
    .map((s) => truncate(s, MAX_SIGNAL_CHARS));

  const channel = inlineChannel
    ? parseChannelArg(inlineChannel)
    : onDisk
      ? {
          id: onDisk.channel.id,
          name: onDisk.channel.name,
          is_dm: onDisk.channel.is_dm,
        }
      : { id: "", name: "", is_dm: false };

  const threadCtx = inlineThreadCtx
    ? parseThreadContextArg(inlineThreadCtx)
    : onDisk
      ? {
          parent_ts: onDisk.thread_context.parent_ts,
          parent_author_real_name:
            onDisk.thread_context.parent_author_real_name,
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
        }
      : parseThreadContextArg(undefined);

  // Extract raw messages_preview once so the truncation check and the
  // normalizer share a single source of truth. Inline override wins; on-disk
  // payload supplies the fallback.
  const rawMessages = inlineThreadCtx
    ? Array.isArray(inlineThreadCtx.messages_preview)
      ? (inlineThreadCtx.messages_preview as unknown[])
      : []
    : (onDisk?.thread_context.messages_preview ?? []);
  const messagesPreview = parseMessagesPreviewArg(rawMessages);
  const messagesTruncated = rawMessages.length > MAX_MESSAGES_PREVIEW;

  const proposedSendTime = asStringOrNull(args.proposed_send_time);
  const slackPermalink =
    asStringOrNull(args.slack_permalink) ??
    (onDisk ? onDisk.slack_permalink : null);
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
      },
    },
  };
}
