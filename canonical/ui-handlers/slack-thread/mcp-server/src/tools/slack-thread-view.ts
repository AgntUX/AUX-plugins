// =============================================================================
// slack_thread_view — stateless view tool for the Slack thread UI handler
// =============================================================================
//
// CONSTRAINTS (linter rule T23 will grep tools/*.ts and reject violations):
//
//   NO third-party MCP imports        — import nothing from mcp__slack__*
//   NO source MCP calls               — do not call any mcp__slack__* tool
//   NO fs.writeFile / fs.appendFile   — this tool is read-only; zero file writes
//   NO network calls                  — no fetch(), no https.request, no http.get
//   NO state mutation                 — stateless: same inputs → same outputs
//
// Source data arrives via tool arguments. The host's agent loop calls the Slack
// MCP first (mcp__slack__get_thread), then calls this view tool with the results
// — see P9 §6.2 wire trace. This tool only packages args into the structuredContent
// envelope and returns _meta.ui.resourceUri so the host renders the right MCP App.
//
// Naming: slack_thread_view — matches ^[a-z][a-z0-9_]*_view$ per P9 D2.
// Registered via Server.setRequestHandler(ListToolsRequestSchema) in index.ts.
// =============================================================================

// Tool descriptor — registered via Server.setRequestHandler(ListToolsRequestSchema).
export const viewToolDescriptor = {
  name: "slack_thread_view",
  description:
    "Render the slack-thread UI component for Slack. " +
    "Returns structuredContent populated with thread messages, members, and the " +
    "orchestrator-drafted proposed reply. Also returns _meta.ui.resourceUri pointing " +
    "at ui://slack-thread. Stateless: no Slack MCP calls, no file writes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      // Thread messages from mcp__slack__get_thread — passed through verbatim.
      thread_messages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id:      { type: "string" },
            ts:      { type: "string" },
            user_id: { type: "string" },
            text:    { type: "string" },
          },
        },
        description: "Messages in the thread, ordered oldest-first. From mcp__slack__get_thread.",
      },
      // Thread members (user_id → display name) from mcp__slack__get_thread or users.info.
      thread_members: {
        type: "array",
        items: {
          type: "object",
          properties: {
            user_id:   { type: "string" },
            name:      { type: "string" },
            real_name: { type: "string" },
          },
        },
        description: "Participants in the thread with display names.",
      },
      // Message IDs to visually highlight in the UI (e.g., the flagged messages).
      highlighted_msg_ids: {
        type: "array",
        items: { type: "string" },
        description: "IDs of messages to visually highlight. May be empty.",
      },
      // Orchestrator-authored draft reply — filled by ux at click time per P9 D1.
      // Corresponds to the {propose_reply} slot in the action item host_prompt.
      proposed_reply: {
        type: "string",
        description: "Orchestrator-authored proposed reply text. May be empty string.",
      },
      // Forwarded from the action item for use in the send-thread-reply follow-up intent.
      action_id: {
        type: "string",
        description: "Action item ID from <agntux project root>/actions/. Forwarded into structuredContent.",
      },
      // Slack channel ID (C09ABCDEF) — used in the send-thread-reply intent body.
      channel_id: {
        type: "string",
        description: "Slack channel ID (e.g., C09ABCDEF).",
      },
      // Human-readable channel name — display only, not used in MCP calls.
      channel_name: {
        type: "string",
        description: "Human-readable channel name without # prefix (e.g., acme-renewal).",
      },
      // thread_ts is the Slack-native thread identifier — doubles as the source ref.
      thread_ts: {
        type: "string",
        description: "Slack thread_ts (digits-dot-digits, e.g., 1714043640.001200). Required.",
      },
    },
    required: ["thread_ts"],
  },
} as const;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ThreadMessage {
  id: string;
  ts: string;
  user_id: string;
  text: string;
}

export interface ThreadMember {
  user_id: string;
  name: string;
  real_name: string;
}

interface ViewToolArgs {
  thread_ts: string;
  thread_messages?: ThreadMessage[];
  thread_members?: ThreadMember[];
  highlighted_msg_ids?: string[];
  proposed_reply?: string;
  action_id?: string;
  channel_id?: string;
  channel_name?: string;
}

export interface SlackThreadStructuredContent {
  thread_messages: ThreadMessage[];
  thread_members: ThreadMember[];
  highlighted_msg_ids: string[];
  proposed_reply: string;
  action_id: string;
  channel_id: string;
  channel_name: string;
  thread_ts: string;
}

interface ViewToolResult {
  structuredContent: SlackThreadStructuredContent;
  content: Array<{ type: "text"; text: string }>;
  _meta: {
    ui: {
      resourceUri: "ui://slack-thread";
      visibility: ["model", "app"];
    };
  };
}

interface StructuredErrorResult {
  structuredContent: {
    error: "auth_failed" | "not_found" | "network";
  };
  content: Array<{ type: "text"; text: string }>;
  _meta: {
    ui: {
      resourceUri: "ui://slack-thread";
      visibility: ["model", "app"];
    };
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

// Handler — registered via Server.setRequestHandler(CallToolRequestSchema).
// Returns ViewToolResult on success or StructuredErrorResult on source failure.
// NEVER throws — always return a structured result so the host can render a
// graceful error state rather than an unhandled exception.
export async function handleSlackThreadView(
  args: Record<string, unknown>
): Promise<ViewToolResult | StructuredErrorResult> {
  const {
    thread_ts,
    thread_messages,
    thread_members,
    highlighted_msg_ids,
    proposed_reply,
    action_id,
    channel_id,
    channel_name,
  } = args as unknown as ViewToolArgs;

  // Validate thread_ts — required, must be a non-empty string.
  // Slack thread_ts format: digits-dot-digits (P9 §7.4).
  if (!thread_ts || typeof thread_ts !== "string" || thread_ts.trim() === "") {
    return structuredError(
      "not_found",
      "slack_thread_view: thread_ts is required. Got: " + JSON.stringify(thread_ts)
    );
  }

  // Validate thread_ts format (digits.digits — e.g., 1714043640.001200).
  const THREAD_TS_RE = /^\d+\.\d+$/;
  if (!THREAD_TS_RE.test(thread_ts.trim())) {
    return structuredError(
      "not_found",
      `slack_thread_view: thread_ts "${thread_ts}" is not a valid Slack thread_ts (expected digits.digits). ` +
      "Check the action item's source_ref field."
    );
  }

  // Defensive normalisation — every field defaults so the component never
  // receives undefined (per P9 §2.6 defensive default contract).
  const safeMessages: ThreadMessage[] = Array.isArray(thread_messages)
    ? thread_messages.map((m) => ({
        id:      typeof m.id      === "string" ? m.id      : "",
        ts:      typeof m.ts      === "string" ? m.ts      : "",
        user_id: typeof m.user_id === "string" ? m.user_id : "",
        text:    typeof m.text    === "string" ? m.text    : "",
      }))
    : [];

  const safeMembers: ThreadMember[] = Array.isArray(thread_members)
    ? thread_members.map((m) => ({
        user_id:   typeof m.user_id   === "string" ? m.user_id   : "",
        name:      typeof m.name      === "string" ? m.name      : "",
        real_name: typeof m.real_name === "string" ? m.real_name : "",
      }))
    : [];

  const safeHighlightedIds: string[] = Array.isArray(highlighted_msg_ids)
    ? highlighted_msg_ids.filter((id) => typeof id === "string")
    : [];

  const safeProposedReply = typeof proposed_reply === "string" ? proposed_reply : "";
  const safeActionId      = typeof action_id      === "string" ? action_id      : "";
  const safeChannelId     = typeof channel_id     === "string" ? channel_id     : "";
  const safeChannelName   = typeof channel_name   === "string" ? channel_name   : "";

  const msgCount = safeMessages.length;
  const chanDisplay = safeChannelName ? `#${safeChannelName}` : safeChannelId || "unknown channel";

  return {
    structuredContent: {
      thread_messages:    safeMessages,
      thread_members:     safeMembers,
      highlighted_msg_ids: safeHighlightedIds,
      proposed_reply:     safeProposedReply,
      action_id:          safeActionId,
      channel_id:         safeChannelId,
      channel_name:       safeChannelName,
      thread_ts:          thread_ts.trim(),
    },
    content: [
      {
        type: "text",
        text: `Slack thread ${thread_ts} in ${chanDisplay} — ${msgCount} message${msgCount !== 1 ? "s" : ""}`,
      },
    ],
    _meta: {
      ui: {
        resourceUri: "ui://slack-thread",
        visibility: ["model", "app"],
      },
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function structuredError(
  kind: "auth_failed" | "not_found" | "network",
  message: string
): StructuredErrorResult {
  return {
    structuredContent: { error: kind },
    content: [{ type: "text", text: message }],
    _meta: {
      ui: {
        resourceUri: "ui://slack-thread",
        visibility: ["model", "app"],
      },
    },
  };
}
