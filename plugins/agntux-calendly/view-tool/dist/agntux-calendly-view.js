// src/agntux-calendly-view.ts
import {
  renderConfirmationText
} from "@agntux/plugin-runtime";
var CANCEL_RESOURCE_URI = "ui://agntux-calendly/cancel";
var CANCEL_UI_LABEL = "Calendly meeting cancellation";
function hasCancelInlineArgs(args) {
  return args.event_uri !== void 0 || args.meeting_name !== void 0;
}
async function handleCancel(args, _ctx) {
  const empty = {
    meeting_url: "",
    event_uri: "",
    meeting_name: "",
    invitee_name: "",
    start_time_utc: "",
    draft_reason: ""
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
        draft_reason: typeof args.draft_reason === "string" ? args.draft_reason : ""
      }
    };
  }
  return {
    content: [{ type: "text", text: renderConfirmationText(CANCEL_UI_LABEL) }],
    structuredContent: empty
  };
}
var cancelViewTool = {
  descriptor: {
    name: "agntux_calendly_cancel",
    description: "Cancel a scheduled Calendly meeting on behalf of the user. Use this whenever the user wants to cancel a booked event or reschedule by first cancelling the existing meeting. Accepts the event URI and an optional cancellation reason. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        meeting_url: { type: "string" },
        event_uri: { type: "string" },
        meeting_name: { type: "string" },
        invitee_name: { type: "string" },
        start_time_utc: { type: "string" },
        draft_reason: { type: "string" }
      },
      required: [],
      additionalProperties: true
    },
    outputSchema: {
      type: "object",
      properties: {
        meeting_url: { type: "string" },
        event_uri: { type: "string" },
        meeting_name: { type: "string" },
        invitee_name: { type: "string" },
        start_time_utc: { type: "string" },
        draft_reason: { type: "string" }
      },
      required: ["meeting_url", "event_uri", "meeting_name", "invitee_name", "start_time_utc", "draft_reason"],
      additionalProperties: false
    },
    ui_resource_uri: CANCEL_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleCancel
};
var NO_SHOW_RESOURCE_URI = "ui://agntux-calendly/no-show";
var NO_SHOW_UI_LABEL = "Calendly no-show marker";
function hasNoShowInlineArgs(args) {
  return args.meeting_name !== void 0 || args.invitees !== void 0;
}
function parseInvitees(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    if (!x || typeof x !== "object") return null;
    const r = x;
    const entry = {
      invitee_uri: typeof r.invitee_uri === "string" ? r.invitee_uri : "",
      name: typeof r.name === "string" ? r.name : "",
      email: typeof r.email === "string" ? r.email : "",
      is_guest: typeof r.is_guest === "boolean" ? r.is_guest : false
    };
    return entry;
  }).filter((e) => e !== null && !!e.invitee_uri);
}
async function handleNoShow(args, _ctx) {
  const empty = {
    meeting_url: "",
    meeting_name: "",
    start_time_utc: "",
    invitees: []
  };
  if (hasNoShowInlineArgs(args)) {
    return {
      content: [{ type: "text", text: renderConfirmationText(NO_SHOW_UI_LABEL) }],
      structuredContent: {
        meeting_url: typeof args.meeting_url === "string" ? args.meeting_url : "",
        meeting_name: typeof args.meeting_name === "string" ? args.meeting_name : "",
        start_time_utc: typeof args.start_time_utc === "string" ? args.start_time_utc : "",
        invitees: parseInvitees(args.invitees)
      }
    };
  }
  return {
    content: [{ type: "text", text: renderConfirmationText(NO_SHOW_UI_LABEL) }],
    structuredContent: empty
  };
}
var noShowViewTool = {
  descriptor: {
    name: "agntux_calendly_no_show",
    description: "Mark one or more invitees as a no-show for a past Calendly meeting. Use this whenever the user wants to flag attendees who did not join a scheduled event. Accepts the meeting details and an array of invitees to mark. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
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
              is_guest: { type: "boolean" }
            }
          }
        }
      },
      required: [],
      additionalProperties: true
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
              is_guest: { type: "boolean" }
            },
            required: ["invitee_uri", "name", "email", "is_guest"]
          }
        }
      },
      required: ["meeting_url", "meeting_name", "start_time_utc", "invitees"],
      additionalProperties: false
    },
    ui_resource_uri: NO_SHOW_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleNoShow
};
var SCHEDULING_LINK_RESOURCE_URI = "ui://agntux-calendly/scheduling-link";
var SCHEDULING_LINK_UI_LABEL = "Calendly single-use booking link";
function hasSchedulingLinkInlineArgs(args) {
  return args.event_types !== void 0 || args.host_scheduling_url !== void 0;
}
function parseEventTypes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    if (!x || typeof x !== "object") return null;
    const r = x;
    const entry = {
      event_type_uri: typeof r.event_type_uri === "string" ? r.event_type_uri : "",
      name: typeof r.name === "string" ? r.name : "",
      duration_minutes: typeof r.duration_minutes === "number" ? r.duration_minutes : 0,
      scheduling_url: typeof r.scheduling_url === "string" ? r.scheduling_url : ""
    };
    return entry;
  }).filter((e) => e !== null && !!e.event_type_uri);
}
async function handleSchedulingLink(args, _ctx) {
  const empty = {
    event_types: [],
    host_scheduling_url: ""
  };
  if (hasSchedulingLinkInlineArgs(args)) {
    return {
      content: [{ type: "text", text: renderConfirmationText(SCHEDULING_LINK_UI_LABEL) }],
      structuredContent: {
        event_types: parseEventTypes(args.event_types),
        host_scheduling_url: typeof args.host_scheduling_url === "string" ? args.host_scheduling_url : ""
      }
    };
  }
  return {
    content: [{ type: "text", text: renderConfirmationText(SCHEDULING_LINK_UI_LABEL) }],
    structuredContent: empty
  };
}
var schedulingLinkViewTool = {
  descriptor: {
    name: "agntux_calendly_scheduling_link",
    description: "Generate a single-use Calendly booking link for a specific event type. Use this whenever the user wants to share a one-time booking link that expires after one use. Accepts the available event types and the host's scheduling URL. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
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
              scheduling_url: { type: "string" }
            }
          }
        },
        host_scheduling_url: { type: "string" }
      },
      required: [],
      additionalProperties: true
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
              scheduling_url: { type: "string" }
            },
            required: ["event_type_uri", "name", "duration_minutes", "scheduling_url"]
          }
        },
        host_scheduling_url: { type: "string" }
      },
      required: ["event_types", "host_scheduling_url"],
      additionalProperties: false
    },
    ui_resource_uri: SCHEDULING_LINK_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleSchedulingLink
};
var mod = {
  viewTools: [cancelViewTool, noShowViewTool, schedulingLinkViewTool]
};
var agntux_calendly_view_default = mod;
export {
  agntux_calendly_view_default as default
};
