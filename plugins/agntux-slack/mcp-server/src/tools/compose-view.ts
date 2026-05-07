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
//   - Single-mode (6.0.0+): the action file's `## Compose payload` is the
//     ONLY payload source. Pre-launch the legacy inline-override path was
//     removed alongside the `agents/ui-handlers/compose.md` metadata file;
//     the only input arg is `action_id`. The iframe always opens in
//     default Draft mode — the user clicks the Schedule tab inside the
//     iframe to switch.
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
  "ui/resourceUri": typeof COMPOSE_RESOURCE_URI;
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

function structuredError(
  kind: ComposeStructuredError["error"],
  message: string,
): ViewToolError {
  return {
    structuredContent: { error: kind },
    content: [{ type: "text", text: message }],
    _meta: { ui: { resourceUri: COMPOSE_RESOURCE_URI }, "ui/resourceUri": COMPOSE_RESOURCE_URI },
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
    "Open the Slack reply composer for an action. Use when the user asks " +
    "to draft a reply / schedule a reply / save a Slack draft for an " +
    "action ID, when prompted with phrases like 'open the reply composer " +
    "for action {id}' / 'draft a reply for action {id}' / 'reply to " +
    "action {id}', or when triage's Draft/Schedule buttons fire this tool " +
    "via host_prompt. Pass ONLY action_id; the handler reads the action " +
    "file's `## Compose payload` body section from disk. The iframe " +
    "always opens in Draft mode — the user clicks the Schedule tab in " +
    "the iframe to switch. Action files that lack a `## Compose payload` " +
    "section surface the `compose_payload_missing` structured error " +
    "envelope. Returns _meta.ui.resourceUri = ui://slack-compose.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action_id: {
        type: "string",
        description: "Slug of the action item (from filename, no .md suffix).",
      },
    },
    required: ["action_id"],
  },
  // outputSchema is what tells the host "this tool returns structuredContent
  // that should be passed to the iframe as toolOutput, not surfaced to the
  // model as chat text." Without it, Claude Cowork (and per the upstream
  // app project's c023186 fix, ChatGPT) silently text-render the
  // structuredContent — the iframe never opens. Mirrors the official
  // ext-apps `scenario-modeler-server` example. No `required` fields so
  // both the success payload and the structured-error envelope validate.
  outputSchema: {
    type: "object" as const,
    properties: {
      action_id: { type: "string" },
      initial_verb: { type: "string" },
      channel: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          is_dm: { type: "boolean" },
        },
      },
      thread: {
        type: "object",
        properties: {
          parent_ts: { type: "string" },
          parent_author_real_name: { type: "string" },
          parent_excerpt: { type: "string" },
          last_reply_ts: {},
          last_reply_author_real_name: {},
          last_reply_excerpt: {},
          total_replies: { type: "number" },
          participants: { type: "array", items: { type: "string" } },
        },
      },
      messages_preview: { type: "array" },
      messages_truncated: { type: "boolean" },
      drafted_body: { type: "string" },
      personalization_signals: { type: "array", items: { type: "string" } },
      proposed_send_time: {},
      slack_permalink: {},
      error: { type: "string" },
    },
  },
  // The MCP Apps spec defines two synonymous keys for declaring a tool's
  // associated UI resource: the modern nested `_meta.ui.resourceUri` and the
  // legacy flat `_meta["ui/resourceUri"]`. The official `registerAppTool`
  // helper in @modelcontextprotocol/ext-apps emits both, so we do too —
  // defensive against any host that only reads one of them.
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

  const onDisk = parsed.compose_payload;
  if (!onDisk) {
    return structuredError(
      "compose_payload_missing",
      `compose_view: action ${actionId} has no \`## Compose payload\` body section.`,
    );
  }

  const draftedBody = truncate(onDisk.drafted_body, MAX_DRAFTED_BODY_CHARS);

  const personalizationSignals = onDisk.personalization_signals
    .slice(0, MAX_PERSONALIZATION_SIGNALS)
    .filter((s): s is string => typeof s === "string")
    .map((s) => truncate(s, MAX_SIGNAL_CHARS));

  const channel: ChannelInfo = {
    id: onDisk.channel.id,
    name: onDisk.channel.name,
    is_dm: onDisk.channel.is_dm,
  };

  const rawMessages = onDisk.thread_context.messages_preview ?? [];
  const messagesPreview = parseMessagesPreviewArg(rawMessages);
  const messagesTruncated = rawMessages.length > MAX_MESSAGES_PREVIEW;

  const payload: ComposeStructuredContent = {
    action_id: actionId,
    initial_verb: "draft",
    channel,
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
    messages_truncated: messagesTruncated,
    drafted_body: draftedBody,
    personalization_signals: personalizationSignals,
    proposed_send_time: null,
    slack_permalink: onDisk.slack_permalink,
  };

  const channelLabel = channel.is_dm ? `DM` : `#${channel.name}`;

  return {
    structuredContent: payload,
    content: [
      {
        type: "text",
        text: `compose_view rendered for action ${actionId} (${channelLabel}, mode: draft).`,
      },
    ],
    _meta: {
      ui: {
        resourceUri: COMPOSE_RESOURCE_URI,
      },
      "ui/resourceUri": COMPOSE_RESOURCE_URI,
    },
  };
}
