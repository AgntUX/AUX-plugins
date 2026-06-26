// =============================================================================
// agntux-calendly-view — view tools for the Calendly MCP App.
//
// Exposes three write handlers:
//   agntux-calendly-cancel         — cancel a scheduled meeting
//   agntux-calendly-no-show        — mark one or more invitees as no-show
//   agntux-calendly-scheduling-link — generate a single-use booking link
//
// Each handler is user-initiated (dual-trigger shape): the host passes
// inline args directly from the skill lane, so no action-file read is
// needed. The handlers also accept an optional action_id as a fallback for
// action-item–based opens, but they degrade gracefully (placeholder) when
// neither the inline fields nor a readable action file is present.
//
// Render-harness contract: every handler MUST render a placeholder payload
// when called with empty args `{}` and MUST NEVER throw.
// =============================================================================

import {
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  renderConfirmationText,
} from "@agntux/plugin-runtime";

// =============================================================================
// Handler 1 — cancel
// =============================================================================

const CANCEL_RESOURCE_URI = "ui://agntux-calendly/cancel" as const;
const CANCEL_UI_LABEL = "Calendly meeting cancellation";

interface CancelArgs {
  action_id?: string;
  meeting_url?: string;
  event_uri?: string;
  meeting_name?: string;
  invitee_name?: string;
  start_time_utc?: string;
  draft_reason?: string;
}

interface CancelPayload {
  meeting_url: string;
  event_uri: string;
  meeting_name: string;
  invitee_name: string;
  start_time_utc: string;
  draft_reason: string;
}

function hasCancelInlineArgs(args: CancelArgs): boolean {
  return args.event_uri !== undefined || args.meeting_name !== undefined;
}

async function handleCancel(
  args: CancelArgs,
  _ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: CancelPayload;
}> {
  const empty: CancelPayload = {
    meeting_url: "",
    event_uri: "",
    meeting_name: "",
    invitee_name: "",
    start_time_utc: "",
    draft_reason: "",
  };

  if (hasCancelInlineArgs(args)) {
    return {
      content: [{ type: "text", text: renderConfirmationText(CANCEL_UI_LABEL) }],
      structuredContent: {
        meeting_url: typeof args.meeting_url === "string" ? args.meeting_url : "",
        event_uri: typeof args.event_uri === "string" ? args.event_uri : "",
        meeting_name: typeof args.meeting_name === "string" ? args.meeting_name : "",
        invitee_name: typeof args.invitee_name === "string" ? args.invitee_name : "",
        start_time_utc: typeof args.start_time_utc === "string" ? args.start_time_utc : "",
        draft_reason: typeof args.draft_reason === "string" ? args.draft_reason : "",
      },
    };
  }

  return {
    content: [{ type: "text", text: renderConfirmationText(CANCEL_UI_LABEL) }],
    structuredContent: empty,
  };
}

const cancelViewTool: ViewTool<CancelArgs, CancelPayload> = {
  descriptor: {
    name: "agntux_calendly_cancel",
    description:
      "Cancel a scheduled Calendly meeting on behalf of the user. Use this whenever the user wants to cancel a booked event or reschedule by first cancelling the existing meeting. Accepts the event URI and an optional cancellation reason. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        meeting_url: { type: "string" },
        event_uri: { type: "string" },
        meeting_name: { type: "string" },
        invitee_name: { type: "string" },
        start_time_utc: { type: "string" },
        draft_reason: { type: "string" },
      },
      required: [],
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      properties: {
        meeting_url: { type: "string" },
        event_uri: { type: "string" },
        meeting_name: { type: "string" },
        invitee_name: { type: "string" },
        start_time_utc: { type: "string" },
        draft_reason: { type: "string" },
      },
      required: ["meeting_url", "event_uri", "meeting_name", "invitee_name", "start_time_utc", "draft_reason"],
      additionalProperties: false,
    },
    ui_resource_uri: CANCEL_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleCancel,
};

// =============================================================================
// Handler 2 — no-show
// =============================================================================

const NO_SHOW_RESOURCE_URI = "ui://agntux-calendly/no-show" as const;
const NO_SHOW_UI_LABEL = "Calendly no-show marker";

interface InviteeEntry {
  invitee_uri: string;
  name: string;
  email: string;
  is_guest: boolean;
}

interface NoShowArgs {
  action_id?: string;
  meeting_url?: string;
  meeting_name?: string;
  start_time_utc?: string;
  invitees?: unknown;
}

interface NoShowPayload {
  meeting_url: string;
  meeting_name: string;
  start_time_utc: string;
  invitees: InviteeEntry[];
}

function hasNoShowInlineArgs(args: NoShowArgs): boolean {
  return args.meeting_name !== undefined || args.invitees !== undefined;
}

function parseInvitees(raw: unknown): InviteeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x): InviteeEntry | null => {
      if (!x || typeof x !== "object") return null;
      const r = x as Record<string, unknown>;
      const entry: InviteeEntry = {
        invitee_uri: typeof r.invitee_uri === "string" ? r.invitee_uri : "",
        name: typeof r.name === "string" ? r.name : "",
        email: typeof r.email === "string" ? r.email : "",
        is_guest: typeof r.is_guest === "boolean" ? r.is_guest : false,
      };
      return entry;
    })
    .filter((e): e is InviteeEntry => e !== null && !!e.invitee_uri);
}

async function handleNoShow(
  args: NoShowArgs,
  _ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: NoShowPayload;
}> {
  const empty: NoShowPayload = {
    meeting_url: "",
    meeting_name: "",
    start_time_utc: "",
    invitees: [],
  };

  if (hasNoShowInlineArgs(args)) {
    return {
      content: [{ type: "text", text: renderConfirmationText(NO_SHOW_UI_LABEL) }],
      structuredContent: {
        meeting_url: typeof args.meeting_url === "string" ? args.meeting_url : "",
        meeting_name: typeof args.meeting_name === "string" ? args.meeting_name : "",
        start_time_utc: typeof args.start_time_utc === "string" ? args.start_time_utc : "",
        invitees: parseInvitees(args.invitees),
      },
    };
  }

  return {
    content: [{ type: "text", text: renderConfirmationText(NO_SHOW_UI_LABEL) }],
    structuredContent: empty,
  };
}

const noShowViewTool: ViewTool<NoShowArgs, NoShowPayload> = {
  descriptor: {
    name: "agntux_calendly_no_show",
    description:
      "Mark one or more invitees as a no-show for a past Calendly meeting. Use this whenever the user wants to flag attendees who did not join a scheduled event. Accepts the meeting details and an array of invitees to mark. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        meeting_url: { type: "string" },
        meeting_name: { type: "string" },
        start_time_utc: { type: "string" },
        invitees: {
          type: "array",
          items: {
            type: "object",
            properties: {
              invitee_uri: { type: "string" },
              name: { type: "string" },
              email: { type: "string" },
              is_guest: { type: "boolean" },
            },
          },
        },
      },
      required: [],
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      properties: {
        meeting_url: { type: "string" },
        meeting_name: { type: "string" },
        start_time_utc: { type: "string" },
        invitees: {
          type: "array",
          items: {
            type: "object",
            properties: {
              invitee_uri: { type: "string" },
              name: { type: "string" },
              email: { type: "string" },
              is_guest: { type: "boolean" },
            },
            required: ["invitee_uri", "name", "email", "is_guest"],
          },
        },
      },
      required: ["meeting_url", "meeting_name", "start_time_utc", "invitees"],
      additionalProperties: false,
    },
    ui_resource_uri: NO_SHOW_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleNoShow,
};

// =============================================================================
// Handler 3 — scheduling-link
// =============================================================================

const SCHEDULING_LINK_RESOURCE_URI = "ui://agntux-calendly/scheduling-link" as const;
const SCHEDULING_LINK_UI_LABEL = "Calendly single-use booking link";

interface EventTypeEntry {
  event_type_uri: string;
  name: string;
  duration_minutes: number;
  scheduling_url: string;
}

interface SchedulingLinkArgs {
  action_id?: string;
  event_types?: unknown;
  host_scheduling_url?: string;
}

interface SchedulingLinkPayload {
  event_types: EventTypeEntry[];
  host_scheduling_url: string;
}

function hasSchedulingLinkInlineArgs(args: SchedulingLinkArgs): boolean {
  return args.event_types !== undefined || args.host_scheduling_url !== undefined;
}

function parseEventTypes(raw: unknown): EventTypeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x): EventTypeEntry | null => {
      if (!x || typeof x !== "object") return null;
      const r = x as Record<string, unknown>;
      const entry: EventTypeEntry = {
        event_type_uri: typeof r.event_type_uri === "string" ? r.event_type_uri : "",
        name: typeof r.name === "string" ? r.name : "",
        duration_minutes: typeof r.duration_minutes === "number" ? r.duration_minutes : 0,
        scheduling_url: typeof r.scheduling_url === "string" ? r.scheduling_url : "",
      };
      return entry;
    })
    .filter((e): e is EventTypeEntry => e !== null && !!e.event_type_uri);
}

async function handleSchedulingLink(
  args: SchedulingLinkArgs,
  _ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: SchedulingLinkPayload;
}> {
  const empty: SchedulingLinkPayload = {
    event_types: [],
    host_scheduling_url: "",
  };

  if (hasSchedulingLinkInlineArgs(args)) {
    return {
      content: [{ type: "text", text: renderConfirmationText(SCHEDULING_LINK_UI_LABEL) }],
      structuredContent: {
        event_types: parseEventTypes(args.event_types),
        host_scheduling_url: typeof args.host_scheduling_url === "string" ? args.host_scheduling_url : "",
      },
    };
  }

  return {
    content: [{ type: "text", text: renderConfirmationText(SCHEDULING_LINK_UI_LABEL) }],
    structuredContent: empty,
  };
}

const schedulingLinkViewTool: ViewTool<SchedulingLinkArgs, SchedulingLinkPayload> = {
  descriptor: {
    name: "agntux_calendly_scheduling_link",
    description:
      "Generate a single-use Calendly booking link for a specific event type. Use this whenever the user wants to share a one-time booking link that expires after one use. Accepts the available event types and the host's scheduling URL. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        event_types: {
          type: "array",
          items: {
            type: "object",
            properties: {
              event_type_uri: { type: "string" },
              name: { type: "string" },
              duration_minutes: { type: "number" },
              scheduling_url: { type: "string" },
            },
          },
        },
        host_scheduling_url: { type: "string" },
      },
      required: [],
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      properties: {
        event_types: {
          type: "array",
          items: {
            type: "object",
            properties: {
              event_type_uri: { type: "string" },
              name: { type: "string" },
              duration_minutes: { type: "number" },
              scheduling_url: { type: "string" },
            },
            required: ["event_type_uri", "name", "duration_minutes", "scheduling_url"],
          },
        },
        host_scheduling_url: { type: "string" },
      },
      required: ["event_types", "host_scheduling_url"],
      additionalProperties: false,
    },
    ui_resource_uri: SCHEDULING_LINK_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleSchedulingLink,
};

// =============================================================================
// Default export — the contract the remote registry consumes
// =============================================================================

const mod: ViewToolModule = {
  viewTools: [cancelViewTool, noShowViewTool, schedulingLinkViewTool],
};
export default mod;
