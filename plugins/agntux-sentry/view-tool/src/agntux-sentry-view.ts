// =============================================================================
// agntux-sentry-view.ts — view tools for the Sentry connector.
//
// Exports THREE view tools in a single module (multi-view shape):
//   1. agntux_sentry_resolve_view — resolve or resolve-in-next-release
//   2. agntux_sentry_ignore_view  — ignore / archive with mode options
//   3. agntux_sentry_assign_view  — assign to a user or team
//
// All three accept inline relay args directly from the host (no action file
// read needed — Sentry issues are relay-pattern data, not persisted action
// files). The inputSchema is wide (additionalProperties: true, no required
// action_id) so the host can pass structuredContent fields inline.
//
// Render-harness contract: every handler guards empty args and returns a
// placeholder payload — never throws, never builds `actions/undefined.md`.
// =============================================================================

import {
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  renderConfirmationText,
} from "@agntux/plugin-runtime";

// ── Constants ─────────────────────────────────────────────────────────────────

const RESOLVE_URI = "ui://agntux-sentry/resolve" as const;
const IGNORE_URI = "ui://agntux-sentry/ignore" as const;
const ASSIGN_URI = "ui://agntux-sentry/assign" as const;

const UI_LABEL_RESOLVE = "Sentry Resolve Issue";
const UI_LABEL_IGNORE = "Sentry Ignore Issue";
const UI_LABEL_ASSIGN = "Sentry Assign Issue";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ResolveArgs {
  issue_url?: string;
  issue_short_id?: string;
  issue_title?: string;
  level?: string;
  project?: string;
  events_count?: number;
  users_affected?: number;
  last_seen?: string;
  resolve_in_next_release?: boolean;
}

interface ResolvePayload {
  issue_url: string;
  issue_short_id: string;
  issue_title: string;
  level: string;
  project: string;
  events_count: number;
  users_affected: number;
  last_seen: string;
  resolve_in_next_release: boolean;
}

interface IgnoreArgs {
  issue_url?: string;
  issue_short_id?: string;
  issue_title?: string;
  level?: string;
  project?: string;
  events_count?: number;
  users_affected?: number;
  ignore_mode?: string;
  ignore_duration_minutes?: number;
  ignore_count?: number;
}

interface IgnorePayload {
  issue_url: string;
  issue_short_id: string;
  issue_title: string;
  level: string;
  project: string;
  events_count: number;
  users_affected: number;
  ignore_mode: string;
  ignore_duration_minutes: number;
  ignore_count: number;
}

interface CandidateAssignee {
  id: string;
  label: string;
  kind: "user" | "team";
}

interface AssignArgs {
  issue_url?: string;
  issue_short_id?: string;
  issue_title?: string;
  current_assignee?: string;
  candidate_assignees?: CandidateAssignee[];
}

interface AssignPayload {
  issue_url: string;
  issue_short_id: string;
  issue_title: string;
  current_assignee: string;
  candidate_assignees: CandidateAssignee[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function safeNum(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function safeBool(v: unknown): boolean {
  return typeof v === "boolean" ? v : false;
}

// ── Handler: resolve ──────────────────────────────────────────────────────────

async function handleResolve(
  args: ResolveArgs,
  _ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ResolvePayload;
}> {
  // Render-harness contract: empty args → placeholder payload, never throw.
  const placeholder: ResolvePayload = {
    issue_url: "",
    issue_short_id: "",
    issue_title: "",
    level: "",
    project: "",
    events_count: 0,
    users_affected: 0,
    last_seen: "",
    resolve_in_next_release: false,
  };

  if (!args || (!args.issue_short_id && !args.issue_url)) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_RESOLVE) }],
      structuredContent: placeholder,
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
        resolve_in_next_release: safeBool(args.resolve_in_next_release),
      },
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_RESOLVE) }],
      structuredContent: placeholder,
    };
  }
}

// ── Handler: ignore ───────────────────────────────────────────────────────────

async function handleIgnore(
  args: IgnoreArgs,
  _ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: IgnorePayload;
}> {
  const placeholder: IgnorePayload = {
    issue_url: "",
    issue_short_id: "",
    issue_title: "",
    level: "",
    project: "",
    events_count: 0,
    users_affected: 0,
    ignore_mode: "untilEscalating",
    ignore_duration_minutes: 0,
    ignore_count: 0,
  };

  if (!args || (!args.issue_short_id && !args.issue_url)) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_IGNORE) }],
      structuredContent: placeholder,
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
        ignore_count: safeNum(args.ignore_count),
      },
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_IGNORE) }],
      structuredContent: placeholder,
    };
  }
}

// ── Handler: assign ───────────────────────────────────────────────────────────

async function handleAssign(
  args: AssignArgs,
  _ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: AssignPayload;
}> {
  const placeholder: AssignPayload = {
    issue_url: "",
    issue_short_id: "",
    issue_title: "",
    current_assignee: "",
    candidate_assignees: [],
  };

  if (!args || (!args.issue_short_id && !args.issue_url)) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_ASSIGN) }],
      structuredContent: placeholder,
    };
  }

  try {
    // Build candidate_assignees defensively — the host may pass partial objects.
    const rawCandidates = Array.isArray(args.candidate_assignees)
      ? args.candidate_assignees
      : [];

    const candidates: CandidateAssignee[] = rawCandidates
      .map((c): CandidateAssignee | null => {
        if (!c || typeof c !== "object") return null;
        const obj = c as unknown as Record<string, unknown>;
        const id = safeStr(obj.id);
        const label = safeStr(obj.label);
        const kind = (obj.kind === "user" || obj.kind === "team") ? obj.kind : "user";
        return id && label ? { id, label, kind } : null;
      })
      .filter((c): c is CandidateAssignee => c !== null);

    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_ASSIGN) }],
      structuredContent: {
        issue_url: safeStr(args.issue_url),
        issue_short_id: safeStr(args.issue_short_id),
        issue_title: safeStr(args.issue_title),
        current_assignee: safeStr(args.current_assignee),
        candidate_assignees: candidates,
      },
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_ASSIGN) }],
      structuredContent: placeholder,
    };
  }
}

// ── Descriptors ───────────────────────────────────────────────────────────────

const resolveViewTool: ViewTool<ResolveArgs, ResolvePayload> = {
  descriptor: {
    name: "agntux_sentry_resolve_view",
    description:
      "Use this to resolve a Sentry issue — mark it as resolved immediately or resolved in the next release. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
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
        resolve_in_next_release: { type: "boolean" },
      },
      required: [],
      additionalProperties: true,
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
        resolve_in_next_release: { type: "boolean" },
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
        "resolve_in_next_release",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: RESOLVE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleResolve,
};

const ignoreViewTool: ViewTool<IgnoreArgs, IgnorePayload> = {
  descriptor: {
    name: "agntux_sentry_ignore_view",
    description:
      "Use this to ignore or archive a Sentry issue — choose until it escalates again, forever, for a set duration, or until it happens N more times. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
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
        ignore_count: { type: "number" },
      },
      required: [],
      additionalProperties: true,
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
        ignore_count: { type: "number" },
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
        "ignore_count",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: IGNORE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleIgnore,
};

const assignViewTool: ViewTool<AssignArgs, AssignPayload> = {
  descriptor: {
    name: "agntux_sentry_assign_view",
    description:
      "Use this to assign a Sentry issue to a team member or team — shows the available candidates and lets the user pick one. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
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
              kind: { type: "string", enum: ["user", "team"] },
            },
            required: ["id", "label", "kind"],
          },
        },
      },
      required: [],
      additionalProperties: true,
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
              kind: { type: "string", enum: ["user", "team"] },
            },
            required: ["id", "label", "kind"],
          },
        },
      },
      required: [
        "issue_url",
        "issue_short_id",
        "issue_title",
        "current_assignee",
        "candidate_assignees",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: ASSIGN_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleAssign,
};

// ── Default export ─────────────────────────────────────────────────────────────

const mod: ViewToolModule = {
  viewTools: [resolveViewTool, ignoreViewTool, assignViewTool],
};
export default mod;
