// =============================================================================
// agntux-jira-view.ts — view tools for the Jira MCP App (agntux-jira).
//
// Exports 5 view tools in listing.yaml order:
//   [0] agntux_jira_comment_view
//   [1] agntux_jira_transition_view
//   [2] agntux_jira_assign_view
//   [3] agntux_jira_edit_view
//   [4] agntux_jira_log_work_view
//
// Every handler:
//   - Guards action_id up front (renders a placeholder for empty args {})
//   - Wraps the fs read + YAML parse in a catch-all (never rethrows)
//   - Ships a content[] block with renderConfirmationText() on every branch
// =============================================================================

import {
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  parseFrontmatter,
  extractFencedYaml,
  renderConfirmationText,
  ViewToolFsError,
} from "@agntux/plugin-runtime";
import yaml from "js-yaml";

// ── Utility ───────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function parseYamlSection(body: string, header: string): Record<string, unknown> | null {
  const raw = extractFencedYaml(body, header);
  if (!raw) return null;
  try {
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

const CONTENT_TEXT = (label: string) => [
  { type: "text" as const, text: renderConfirmationText(label) },
];

// ── Error payload helpers ─────────────────────────────────────────────────────

function errorPayload(error: string) {
  return { error };
}

// =============================================================================
// COMMENT VIEW
// =============================================================================

const COMMENT_RESOURCE_URI = "ui://agntux-jira/comment" as const;
const COMMENT_LABEL = "Jira comment composer";

interface CommentArgs { action_id: string }

interface CommentPayloadOk {
  cloud_id: string;
  issue_key: string;
  issue_url: string;
  issue_title: string;
  issue_status: string;
  issue_assignee: string | null;
  issue_priority: string | null;
  draft_body: string;
  personalization_signals: string[];
  generated_at: string;
}

type CommentPayload = CommentPayloadOk | { error: string };

const DRAFT_BODY_MAX = 2000;

async function handleComment(
  args: CommentArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: CommentPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: CONTENT_TEXT(COMMENT_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { frontmatter, body } = parseFrontmatter(buf.toString("utf8"));
    // Guard done/dismissed actions
    if (frontmatter.status === "done" || frontmatter.status === "dismissed") {
      return {
        content: CONTENT_TEXT(COMMENT_LABEL),
        structuredContent: errorPayload("action_already_handled"),
      };
    }
    const data = parseYamlSection(body, "Comment payload");
    if (!data) {
      return {
        content: CONTENT_TEXT(COMMENT_LABEL),
        structuredContent: errorPayload("comment_payload_missing"),
      };
    }
    let draftBody = str(data.draft_body);
    if (draftBody.length > DRAFT_BODY_MAX) {
      draftBody = draftBody.slice(0, DRAFT_BODY_MAX);
    }
    const payload: CommentPayloadOk = {
      cloud_id: str(data.cloud_id),
      issue_key: str(data.issue_key),
      issue_url: str(data.issue_url),
      issue_title: str(data.issue_title),
      issue_status: str(data.issue_status),
      issue_assignee: strOrNull(data.issue_assignee),
      issue_priority: strOrNull(data.issue_priority),
      draft_body: draftBody,
      personalization_signals: strArray(data.personalization_signals),
      generated_at: str(data.generated_at),
    };
    return {
      content: CONTENT_TEXT(COMMENT_LABEL),
      structuredContent: payload,
    };
  } catch (err) {
    if (err instanceof ViewToolFsError && err.code === "not-found") {
      return {
        content: CONTENT_TEXT(COMMENT_LABEL),
        structuredContent: errorPayload("action_not_found"),
      };
    }
    return {
      content: CONTENT_TEXT(COMMENT_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
}

const commentViewTool: ViewTool<CommentArgs, CommentPayload> = {
  descriptor: {
    name: "agntux_jira_comment_view",
    description:
      "Use this to add a comment to a Jira issue on behalf of the user. " +
      "Opens a comment composer pre-filled with the draft body from the action item, " +
      "letting the user review and edit before posting. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        cloud_id: { type: "string" },
        issue_key: { type: "string" },
        issue_url: { type: "string" },
        issue_title: { type: "string" },
        issue_status: { type: "string" },
        issue_assignee: { type: ["string", "null"] },
        issue_priority: { type: ["string", "null"] },
        draft_body: { type: "string" },
        personalization_signals: { type: "array", items: { type: "string" } },
        generated_at: { type: "string" },
      },
      required: [],
      additionalProperties: true,
    },
    ui_resource_uri: COMMENT_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleComment,
};

// =============================================================================
// TRANSITION VIEW
// =============================================================================

const TRANSITION_RESOURCE_URI = "ui://agntux-jira/transition" as const;
const TRANSITION_LABEL = "Jira issue transition";

interface TransitionArgs { action_id: string }

interface TransitionItem { id: string; name: string }

interface TransitionPayloadOk {
  cloud_id: string;
  issue_key: string;
  issue_url: string;
  issue_title: string;
  current_state: string;
  available_transitions: TransitionItem[];
  suggested_transition_id: string;
  optional_comment: string | null;
  personalization_signals: string[];
  generated_at: string;
}

type TransitionPayload = TransitionPayloadOk | { error: string };

async function handleTransition(
  args: TransitionArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: TransitionPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: CONTENT_TEXT(TRANSITION_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { frontmatter, body } = parseFrontmatter(buf.toString("utf8"));
    if (frontmatter.status === "done" || frontmatter.status === "dismissed") {
      return {
        content: CONTENT_TEXT(TRANSITION_LABEL),
        structuredContent: errorPayload("action_already_handled"),
      };
    }
    const data = parseYamlSection(body, "Transition payload");
    if (!data) {
      return {
        content: CONTENT_TEXT(TRANSITION_LABEL),
        structuredContent: errorPayload("transition_payload_missing"),
      };
    }
    const rawTransitions = Array.isArray(data.available_transitions)
      ? data.available_transitions
      : [];
    const available_transitions: TransitionItem[] = rawTransitions
      .map((x): TransitionItem | null => {
        if (!x || typeof x !== "object") return null;
        const r = x as Record<string, unknown>;
        const id = str(r.id);
        const name = str(r.name);
        if (!id) return null;
        return { id, name };
      })
      .filter((t): t is TransitionItem => t !== null);

    const payload: TransitionPayloadOk = {
      cloud_id: str(data.cloud_id),
      issue_key: str(data.issue_key),
      issue_url: str(data.issue_url),
      issue_title: str(data.issue_title),
      current_state: str(data.current_state),
      available_transitions,
      suggested_transition_id: str(data.suggested_transition_id),
      optional_comment: strOrNull(data.optional_comment),
      personalization_signals: strArray(data.personalization_signals),
      generated_at: str(data.generated_at),
    };
    return {
      content: CONTENT_TEXT(TRANSITION_LABEL),
      structuredContent: payload,
    };
  } catch (err) {
    if (err instanceof ViewToolFsError && err.code === "not-found") {
      return {
        content: CONTENT_TEXT(TRANSITION_LABEL),
        structuredContent: errorPayload("action_not_found"),
      };
    }
    return {
      content: CONTENT_TEXT(TRANSITION_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
}

const transitionViewTool: ViewTool<TransitionArgs, TransitionPayload> = {
  descriptor: {
    name: "agntux_jira_transition_view",
    description:
      "Use this to change the status of a Jira issue (e.g., move from In Progress to In Review or Done). " +
      "Opens a transition picker showing all available transitions with the suggested one pre-selected. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        cloud_id: { type: "string" },
        issue_key: { type: "string" },
        issue_url: { type: "string" },
        issue_title: { type: "string" },
        current_state: { type: "string" },
        available_transitions: { type: "array" },
        suggested_transition_id: { type: "string" },
        optional_comment: { type: ["string", "null"] },
        personalization_signals: { type: "array", items: { type: "string" } },
        generated_at: { type: "string" },
      },
      required: [],
      additionalProperties: true,
    },
    ui_resource_uri: TRANSITION_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleTransition,
};

// =============================================================================
// ASSIGN VIEW
// =============================================================================

const ASSIGN_RESOURCE_URI = "ui://agntux-jira/assign" as const;
const ASSIGN_LABEL = "Jira issue assign";

interface AssignArgs { action_id: string }

interface AssigneeCandidate { account_id: string; display_name: string }
interface CurrentAssignee { account_id: string; display_name: string }

interface AssignPayloadOk {
  cloud_id: string;
  issue_key: string;
  issue_url: string;
  issue_title: string;
  current_assignee: CurrentAssignee | null;
  candidate_assignees: AssigneeCandidate[];
  suggested_assignee_account_id: string | null;
  personalization_signals: string[];
  generated_at: string;
}

type AssignPayload = AssignPayloadOk | { error: string };

async function handleAssign(
  args: AssignArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: AssignPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: CONTENT_TEXT(ASSIGN_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { frontmatter, body } = parseFrontmatter(buf.toString("utf8"));
    if (frontmatter.status === "done" || frontmatter.status === "dismissed") {
      return {
        content: CONTENT_TEXT(ASSIGN_LABEL),
        structuredContent: errorPayload("action_already_handled"),
      };
    }
    const data = parseYamlSection(body, "Assign payload");
    if (!data) {
      return {
        content: CONTENT_TEXT(ASSIGN_LABEL),
        structuredContent: errorPayload("assign_payload_missing"),
      };
    }

    let current_assignee: CurrentAssignee | null = null;
    if (data.current_assignee && typeof data.current_assignee === "object" && !Array.isArray(data.current_assignee)) {
      const ca = data.current_assignee as Record<string, unknown>;
      current_assignee = { account_id: str(ca.account_id), display_name: str(ca.display_name) };
    }

    const rawCandidates = Array.isArray(data.candidate_assignees) ? data.candidate_assignees : [];
    const candidate_assignees: AssigneeCandidate[] = rawCandidates
      .map((x): AssigneeCandidate | null => {
        if (!x || typeof x !== "object") return null;
        const r = x as Record<string, unknown>;
        const account_id = str(r.account_id);
        const display_name = str(r.display_name);
        return { account_id, display_name };
      })
      .filter((c): c is AssigneeCandidate => c !== null);

    const payload: AssignPayloadOk = {
      cloud_id: str(data.cloud_id),
      issue_key: str(data.issue_key),
      issue_url: str(data.issue_url),
      issue_title: str(data.issue_title),
      current_assignee,
      candidate_assignees,
      suggested_assignee_account_id: strOrNull(data.suggested_assignee_account_id),
      personalization_signals: strArray(data.personalization_signals),
      generated_at: str(data.generated_at),
    };
    return {
      content: CONTENT_TEXT(ASSIGN_LABEL),
      structuredContent: payload,
    };
  } catch (err) {
    if (err instanceof ViewToolFsError && err.code === "not-found") {
      return {
        content: CONTENT_TEXT(ASSIGN_LABEL),
        structuredContent: errorPayload("action_not_found"),
      };
    }
    return {
      content: CONTENT_TEXT(ASSIGN_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
}

const assignViewTool: ViewTool<AssignArgs, AssignPayload> = {
  descriptor: {
    name: "agntux_jira_assign_view",
    description:
      "Use this to assign or re-assign a Jira issue to a person. " +
      "Opens an assignee picker with candidates pre-loaded and the suggested pick pre-selected. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        cloud_id: { type: "string" },
        issue_key: { type: "string" },
        issue_url: { type: "string" },
        issue_title: { type: "string" },
        current_assignee: {},
        candidate_assignees: { type: "array" },
        suggested_assignee_account_id: { type: ["string", "null"] },
        personalization_signals: { type: "array", items: { type: "string" } },
        generated_at: { type: "string" },
      },
      required: [],
      additionalProperties: true,
    },
    ui_resource_uri: ASSIGN_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleAssign,
};

// =============================================================================
// EDIT VIEW
// =============================================================================

const EDIT_RESOURCE_URI = "ui://agntux-jira/edit" as const;
const EDIT_LABEL = "Jira issue editor";

interface EditArgs { action_id: string }

interface EditPayloadOk {
  cloud_id: string;
  issue_key: string;
  issue_url: string;
  current_summary: string;
  current_priority: string | null;
  current_labels: string[];
  available_priorities: string[];
  available_labels: string[];
  draft_summary: string | null;
  draft_priority: string | null;
  draft_labels: string[] | null;
  personalization_signals: string[];
  generated_at: string;
}

type EditPayload = EditPayloadOk | { error: string };

async function handleEdit(
  args: EditArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: EditPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: CONTENT_TEXT(EDIT_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { frontmatter, body } = parseFrontmatter(buf.toString("utf8"));
    if (frontmatter.status === "done" || frontmatter.status === "dismissed") {
      return {
        content: CONTENT_TEXT(EDIT_LABEL),
        structuredContent: errorPayload("action_already_handled"),
      };
    }
    const data = parseYamlSection(body, "Edit payload");
    if (!data) {
      return {
        content: CONTENT_TEXT(EDIT_LABEL),
        structuredContent: errorPayload("edit_payload_missing"),
      };
    }

    const draft_labels_raw = data.draft_labels;
    const draft_labels: string[] | null = Array.isArray(draft_labels_raw)
      ? draft_labels_raw.filter((x): x is string => typeof x === "string")
      : null;

    const payload: EditPayloadOk = {
      cloud_id: str(data.cloud_id),
      issue_key: str(data.issue_key),
      issue_url: str(data.issue_url),
      current_summary: str(data.current_summary),
      current_priority: strOrNull(data.current_priority),
      current_labels: strArray(data.current_labels),
      available_priorities: strArray(data.available_priorities),
      available_labels: strArray(data.available_labels),
      draft_summary: strOrNull(data.draft_summary),
      draft_priority: strOrNull(data.draft_priority),
      draft_labels,
      personalization_signals: strArray(data.personalization_signals),
      generated_at: str(data.generated_at),
    };
    return {
      content: CONTENT_TEXT(EDIT_LABEL),
      structuredContent: payload,
    };
  } catch (err) {
    if (err instanceof ViewToolFsError && err.code === "not-found") {
      return {
        content: CONTENT_TEXT(EDIT_LABEL),
        structuredContent: errorPayload("action_not_found"),
      };
    }
    return {
      content: CONTENT_TEXT(EDIT_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
}

const editViewTool: ViewTool<EditArgs, EditPayload> = {
  descriptor: {
    name: "agntux_jira_edit_view",
    description:
      "Use this to edit the fields of a Jira issue — summary, priority, and labels. " +
      "Opens an edit form pre-filled with draft suggestions; only changed fields are sent. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        cloud_id: { type: "string" },
        issue_key: { type: "string" },
        issue_url: { type: "string" },
        current_summary: { type: "string" },
        current_priority: { type: ["string", "null"] },
        current_labels: { type: "array", items: { type: "string" } },
        available_priorities: { type: "array", items: { type: "string" } },
        available_labels: { type: "array", items: { type: "string" } },
        draft_summary: { type: ["string", "null"] },
        draft_priority: { type: ["string", "null"] },
        draft_labels: {},
        personalization_signals: { type: "array", items: { type: "string" } },
        generated_at: { type: "string" },
      },
      required: [],
      additionalProperties: true,
    },
    ui_resource_uri: EDIT_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleEdit,
};

// =============================================================================
// LOG-WORK VIEW
// =============================================================================

const LOG_WORK_RESOURCE_URI = "ui://agntux-jira/log-work" as const;
const LOG_WORK_LABEL = "Jira log work";

interface LogWorkArgs { action_id: string }

interface LogWorkPayloadOk {
  cloud_id: string;
  issue_key: string;
  issue_url: string;
  issue_title: string;
  suggested_time_spent: string;
  suggested_started: string;
  draft_comment: string | null;
  personalization_signals: string[];
  generated_at: string;
}

type LogWorkPayload = LogWorkPayloadOk | { error: string };

async function handleLogWork(
  args: LogWorkArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: LogWorkPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: CONTENT_TEXT(LOG_WORK_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { frontmatter, body } = parseFrontmatter(buf.toString("utf8"));
    if (frontmatter.status === "done" || frontmatter.status === "dismissed") {
      return {
        content: CONTENT_TEXT(LOG_WORK_LABEL),
        structuredContent: errorPayload("action_already_handled"),
      };
    }
    const data = parseYamlSection(body, "Log-work payload");
    if (!data) {
      return {
        content: CONTENT_TEXT(LOG_WORK_LABEL),
        structuredContent: errorPayload("log_work_payload_missing"),
      };
    }
    const payload: LogWorkPayloadOk = {
      cloud_id: str(data.cloud_id),
      issue_key: str(data.issue_key),
      issue_url: str(data.issue_url),
      issue_title: str(data.issue_title),
      suggested_time_spent: str(data.suggested_time_spent),
      suggested_started: str(data.suggested_started),
      draft_comment: strOrNull(data.draft_comment),
      personalization_signals: strArray(data.personalization_signals),
      generated_at: str(data.generated_at),
    };
    return {
      content: CONTENT_TEXT(LOG_WORK_LABEL),
      structuredContent: payload,
    };
  } catch (err) {
    if (err instanceof ViewToolFsError && err.code === "not-found") {
      return {
        content: CONTENT_TEXT(LOG_WORK_LABEL),
        structuredContent: errorPayload("action_not_found"),
      };
    }
    return {
      content: CONTENT_TEXT(LOG_WORK_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
}

const logWorkViewTool: ViewTool<LogWorkArgs, LogWorkPayload> = {
  descriptor: {
    name: "agntux_jira_log_work_view",
    description:
      "Use this to log work time spent on a Jira issue. " +
      "Opens a worklog form pre-filled with a suggested time estimate and start time. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        cloud_id: { type: "string" },
        issue_key: { type: "string" },
        issue_url: { type: "string" },
        issue_title: { type: "string" },
        suggested_time_spent: { type: "string" },
        suggested_started: { type: "string" },
        draft_comment: { type: ["string", "null"] },
        personalization_signals: { type: "array", items: { type: "string" } },
        generated_at: { type: "string" },
      },
      required: [],
      additionalProperties: true,
    },
    ui_resource_uri: LOG_WORK_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleLogWork,
};

// =============================================================================
// Module export (listing.yaml order)
// =============================================================================

const mod: ViewToolModule = {
  viewTools: [
    commentViewTool,
    transitionViewTool,
    assignViewTool,
    editViewTool,
    logWorkViewTool,
  ],
};

export default mod;
