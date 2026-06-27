// src/agntux-sentry-view.ts
import {
  renderConfirmationText
} from "@agntux/plugin-runtime";
var RESOLVE_URI = "ui://agntux-sentry/resolve";
var IGNORE_URI = "ui://agntux-sentry/ignore";
var ASSIGN_URI = "ui://agntux-sentry/assign";
var UI_LABEL_RESOLVE = "Sentry Resolve Issue";
var UI_LABEL_IGNORE = "Sentry Ignore Issue";
var UI_LABEL_ASSIGN = "Sentry Assign Issue";
function safeStr(v) {
  return typeof v === "string" ? v : "";
}
function safeNum(v) {
  return typeof v === "number" ? v : 0;
}
function safeBool(v) {
  return typeof v === "boolean" ? v : false;
}
async function handleResolve(args, _ctx) {
  const placeholder = {
    issue_url: "",
    issue_short_id: "",
    issue_title: "",
    level: "",
    project: "",
    events_count: 0,
    users_affected: 0,
    last_seen: "",
    resolve_in_next_release: false
  };
  if (!args || !args.issue_short_id && !args.issue_url) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_RESOLVE) }],
      structuredContent: placeholder
    };
  }
  try {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_RESOLVE) }],
      structuredContent: {
        issue_url: safeStr(args.issue_url),
        issue_short_id: safeStr(args.issue_short_id),
        issue_title: safeStr(args.issue_title),
        level: safeStr(args.level),
        project: safeStr(args.project),
        events_count: safeNum(args.events_count),
        users_affected: safeNum(args.users_affected),
        last_seen: safeStr(args.last_seen),
        resolve_in_next_release: safeBool(args.resolve_in_next_release)
      }
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_RESOLVE) }],
      structuredContent: placeholder
    };
  }
}
async function handleIgnore(args, _ctx) {
  const placeholder = {
    issue_url: "",
    issue_short_id: "",
    issue_title: "",
    level: "",
    project: "",
    events_count: 0,
    users_affected: 0,
    ignore_mode: "untilEscalating",
    ignore_duration_minutes: 0,
    ignore_count: 0
  };
  if (!args || !args.issue_short_id && !args.issue_url) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_IGNORE) }],
      structuredContent: placeholder
    };
  }
  try {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_IGNORE) }],
      structuredContent: {
        issue_url: safeStr(args.issue_url),
        issue_short_id: safeStr(args.issue_short_id),
        issue_title: safeStr(args.issue_title),
        level: safeStr(args.level),
        project: safeStr(args.project),
        events_count: safeNum(args.events_count),
        users_affected: safeNum(args.users_affected),
        ignore_mode: safeStr(args.ignore_mode) || "untilEscalating",
        ignore_duration_minutes: safeNum(args.ignore_duration_minutes),
        ignore_count: safeNum(args.ignore_count)
      }
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_IGNORE) }],
      structuredContent: placeholder
    };
  }
}
async function handleAssign(args, _ctx) {
  const placeholder = {
    issue_url: "",
    issue_short_id: "",
    issue_title: "",
    current_assignee: "",
    candidate_assignees: []
  };
  if (!args || !args.issue_short_id && !args.issue_url) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_ASSIGN) }],
      structuredContent: placeholder
    };
  }
  try {
    const rawCandidates = Array.isArray(args.candidate_assignees) ? args.candidate_assignees : [];
    const candidates = rawCandidates.map((c) => {
      if (!c || typeof c !== "object") return null;
      const obj = c;
      const id = safeStr(obj.id);
      const label = safeStr(obj.label);
      const kind = obj.kind === "user" || obj.kind === "team" ? obj.kind : "user";
      return id && label ? { id, label, kind } : null;
    }).filter((c) => c !== null);
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_ASSIGN) }],
      structuredContent: {
        issue_url: safeStr(args.issue_url),
        issue_short_id: safeStr(args.issue_short_id),
        issue_title: safeStr(args.issue_title),
        current_assignee: safeStr(args.current_assignee),
        candidate_assignees: candidates
      }
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_ASSIGN) }],
      structuredContent: placeholder
    };
  }
}
var resolveViewTool = {
  descriptor: {
    name: "agntux_sentry_resolve_view",
    description: "Use this to resolve a Sentry issue \u2014 mark it as resolved immediately or resolved in the next release. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        issue_url: { type: "string" },
        issue_short_id: { type: "string" },
        issue_title: { type: "string" },
        level: { type: "string" },
        project: { type: "string" },
        events_count: { type: "number" },
        users_affected: { type: "number" },
        last_seen: { type: "string" },
        resolve_in_next_release: { type: "boolean" }
      },
      required: [],
      additionalProperties: true
    },
    outputSchema: {
      type: "object",
      properties: {
        issue_url: { type: "string" },
        issue_short_id: { type: "string" },
        issue_title: { type: "string" },
        level: { type: "string" },
        project: { type: "string" },
        events_count: { type: "number" },
        users_affected: { type: "number" },
        last_seen: { type: "string" },
        resolve_in_next_release: { type: "boolean" }
      },
      required: [
        "issue_url",
        "issue_short_id",
        "issue_title",
        "level",
        "project",
        "events_count",
        "users_affected",
        "last_seen",
        "resolve_in_next_release"
      ],
      additionalProperties: false
    },
    ui_resource_uri: RESOLVE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleResolve
};
var ignoreViewTool = {
  descriptor: {
    name: "agntux_sentry_ignore_view",
    description: "Use this to ignore or archive a Sentry issue \u2014 choose until it escalates again, forever, for a set duration, or until it happens N more times. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        issue_url: { type: "string" },
        issue_short_id: { type: "string" },
        issue_title: { type: "string" },
        level: { type: "string" },
        project: { type: "string" },
        events_count: { type: "number" },
        users_affected: { type: "number" },
        ignore_mode: { type: "string" },
        ignore_duration_minutes: { type: "number" },
        ignore_count: { type: "number" }
      },
      required: [],
      additionalProperties: true
    },
    outputSchema: {
      type: "object",
      properties: {
        issue_url: { type: "string" },
        issue_short_id: { type: "string" },
        issue_title: { type: "string" },
        level: { type: "string" },
        project: { type: "string" },
        events_count: { type: "number" },
        users_affected: { type: "number" },
        ignore_mode: { type: "string" },
        ignore_duration_minutes: { type: "number" },
        ignore_count: { type: "number" }
      },
      required: [
        "issue_url",
        "issue_short_id",
        "issue_title",
        "level",
        "project",
        "events_count",
        "users_affected",
        "ignore_mode",
        "ignore_duration_minutes",
        "ignore_count"
      ],
      additionalProperties: false
    },
    ui_resource_uri: IGNORE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleIgnore
};
var assignViewTool = {
  descriptor: {
    name: "agntux_sentry_assign_view",
    description: "Use this to assign a Sentry issue to a team member or team \u2014 shows the available candidates and lets the user pick one. This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        issue_url: { type: "string" },
        issue_short_id: { type: "string" },
        issue_title: { type: "string" },
        current_assignee: { type: "string" },
        candidate_assignees: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              kind: { type: "string", enum: ["user", "team"] }
            },
            required: ["id", "label", "kind"]
          }
        }
      },
      required: [],
      additionalProperties: true
    },
    outputSchema: {
      type: "object",
      properties: {
        issue_url: { type: "string" },
        issue_short_id: { type: "string" },
        issue_title: { type: "string" },
        current_assignee: { type: "string" },
        candidate_assignees: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              kind: { type: "string", enum: ["user", "team"] }
            },
            required: ["id", "label", "kind"]
          }
        }
      },
      required: [
        "issue_url",
        "issue_short_id",
        "issue_title",
        "current_assignee",
        "candidate_assignees"
      ],
      additionalProperties: false
    },
    ui_resource_uri: ASSIGN_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleAssign
};
var mod = {
  viewTools: [resolveViewTool, ignoreViewTool, assignViewTool]
};
var agntux_sentry_view_default = mod;
export {
  agntux_sentry_view_default as default
};
