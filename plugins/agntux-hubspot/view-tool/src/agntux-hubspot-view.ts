// =============================================================================
// agntux-hubspot-view.ts — view tools for the HubSpot CRM MCP App (agntux-hubspot).
//
// Exports 4 view tools in listing.yaml order:
//   [0] agntux_hubspot_move_deal_view
//   [1] agntux_hubspot_task_view
//   [2] agntux_hubspot_activity_view
//   [3] agntux_hubspot_reassign_view
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

function errorPayload(error: string) {
  return { error };
}

// =============================================================================
// MOVE-DEAL VIEW
// =============================================================================

const MOVE_DEAL_RESOURCE_URI = "ui://agntux-hubspot/move-deal" as const;
const MOVE_DEAL_LABEL = "HubSpot move deal";

interface MoveDealArgs { action_id: string }

interface DealStage { id: string; label: string }

interface MoveDealPayloadOk {
  deal_url: string;
  deal_id: string;
  deal_name: string;
  pipeline_label: string;
  current_stage: string;
  available_stages: DealStage[];
  amount: string;
  currency_code: string;
  close_date: string;
}

type MoveDealPayload = MoveDealPayloadOk | { error: string };

async function handleMoveDeal(
  args: MoveDealArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: MoveDealPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: CONTENT_TEXT(MOVE_DEAL_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { frontmatter, body } = parseFrontmatter(buf.toString("utf8"));
    if (frontmatter.status === "done" || frontmatter.status === "dismissed") {
      return {
        content: CONTENT_TEXT(MOVE_DEAL_LABEL),
        structuredContent: errorPayload("action_already_handled"),
      };
    }
    const data = parseYamlSection(body, "Move-deal payload");
    if (!data) {
      return {
        content: CONTENT_TEXT(MOVE_DEAL_LABEL),
        structuredContent: errorPayload("move_deal_payload_missing"),
      };
    }

    const rawStages = Array.isArray(data.available_stages) ? data.available_stages : [];
    const available_stages: DealStage[] = rawStages
      .map((x): DealStage | null => {
        if (!x || typeof x !== "object") return null;
        const r = x as Record<string, unknown>;
        const id = str(r.id);
        if (!id) return null;
        return { id, label: str(r.label) };
      })
      .filter((s): s is DealStage => s !== null);

    const payload: MoveDealPayloadOk = {
      deal_url: str(data.deal_url),
      deal_id: str(data.deal_id),
      deal_name: str(data.deal_name),
      pipeline_label: str(data.pipeline_label),
      current_stage: str(data.current_stage),
      available_stages,
      amount: str(data.amount),
      currency_code: str(data.currency_code),
      close_date: str(data.close_date),
    };
    return {
      content: CONTENT_TEXT(MOVE_DEAL_LABEL),
      structuredContent: payload,
    };
  } catch {
    return {
      content: CONTENT_TEXT(MOVE_DEAL_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
}

const moveDealViewTool: ViewTool<MoveDealArgs, MoveDealPayload> = {
  descriptor: {
    name: "agntux_hubspot_move_deal_view",
    description:
      "Use this to move a HubSpot deal to a new pipeline stage on behalf of the user. " +
      "Opens a stage picker pre-loaded with the available stages for this deal's pipeline. " +
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
        deal_url: { type: "string" },
        deal_id: { type: "string" },
        deal_name: { type: "string" },
        pipeline_label: { type: "string" },
        current_stage: { type: "string" },
        available_stages: { type: "array" },
        amount: { type: "string" },
        currency_code: { type: "string" },
        close_date: { type: "string" },
      },
      required: [],
      additionalProperties: true,
    },
    ui_resource_uri: MOVE_DEAL_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleMoveDeal,
};

// =============================================================================
// TASK VIEW
// =============================================================================

const TASK_RESOURCE_URI = "ui://agntux-hubspot/task" as const;
const TASK_LABEL = "HubSpot task";

interface TaskArgs { action_id: string }

interface TaskPayloadOk {
  task_url: string;
  task_id: string;
  task_title: string;
  due_date: string;
  status: string;
  associated_record_name: string;
  modes: string[];
}

type TaskPayload = TaskPayloadOk | { error: string };

async function handleTask(
  args: TaskArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: TaskPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: CONTENT_TEXT(TASK_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { frontmatter, body } = parseFrontmatter(buf.toString("utf8"));
    if (frontmatter.status === "done" || frontmatter.status === "dismissed") {
      return {
        content: CONTENT_TEXT(TASK_LABEL),
        structuredContent: errorPayload("action_already_handled"),
      };
    }
    const data = parseYamlSection(body, "Task payload");
    if (!data) {
      return {
        content: CONTENT_TEXT(TASK_LABEL),
        structuredContent: errorPayload("task_payload_missing"),
      };
    }

    const payload: TaskPayloadOk = {
      task_url: str(data.task_url),
      task_id: str(data.task_id),
      task_title: str(data.task_title),
      due_date: str(data.due_date),
      status: str(data.status),
      associated_record_name: str(data.associated_record_name),
      modes: strArray(data.modes).length > 0 ? strArray(data.modes) : ["complete", "reschedule"],
    };
    return {
      content: CONTENT_TEXT(TASK_LABEL),
      structuredContent: payload,
    };
  } catch {
    return {
      content: CONTENT_TEXT(TASK_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
}

const taskViewTool: ViewTool<TaskArgs, TaskPayload> = {
  descriptor: {
    name: "agntux_hubspot_task_view",
    description:
      "Use this to complete or reschedule a HubSpot task on behalf of the user. " +
      "Opens a task card with tabs to mark the task complete or pick a new due date. " +
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
        task_url: { type: "string" },
        task_id: { type: "string" },
        task_title: { type: "string" },
        due_date: { type: "string" },
        status: { type: "string" },
        associated_record_name: { type: "string" },
        modes: { type: "array", items: { type: "string" } },
      },
      required: [],
      additionalProperties: true,
    },
    ui_resource_uri: TASK_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleTask,
};

// =============================================================================
// ACTIVITY VIEW
// =============================================================================

const ACTIVITY_RESOURCE_URI = "ui://agntux-hubspot/activity" as const;
const ACTIVITY_LABEL = "HubSpot log activity";

interface ActivityArgs { action_id: string }

interface ActivityPayloadOk {
  record_url: string;
  record_id: string;
  record_type: string;
  record_name: string;
  draft_body: string;
  personalization_signals: string[];
}

type ActivityPayload = ActivityPayloadOk | { error: string };

const DRAFT_BODY_MAX = 2000;

async function handleActivity(
  args: ActivityArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: ActivityPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: CONTENT_TEXT(ACTIVITY_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { frontmatter, body } = parseFrontmatter(buf.toString("utf8"));
    if (frontmatter.status === "done" || frontmatter.status === "dismissed") {
      return {
        content: CONTENT_TEXT(ACTIVITY_LABEL),
        structuredContent: errorPayload("action_already_handled"),
      };
    }
    const data = parseYamlSection(body, "Activity payload");
    if (!data) {
      return {
        content: CONTENT_TEXT(ACTIVITY_LABEL),
        structuredContent: errorPayload("activity_payload_missing"),
      };
    }

    let draftBody = str(data.draft_body);
    if (draftBody.length > DRAFT_BODY_MAX) {
      draftBody = draftBody.slice(0, DRAFT_BODY_MAX);
    }

    const payload: ActivityPayloadOk = {
      record_url: str(data.record_url),
      record_id: str(data.record_id),
      record_type: str(data.record_type),
      record_name: str(data.record_name),
      draft_body: draftBody,
      personalization_signals: strArray(data.personalization_signals),
    };
    return {
      content: CONTENT_TEXT(ACTIVITY_LABEL),
      structuredContent: payload,
    };
  } catch {
    return {
      content: CONTENT_TEXT(ACTIVITY_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
}

const activityViewTool: ViewTool<ActivityArgs, ActivityPayload> = {
  descriptor: {
    name: "agntux_hubspot_activity_view",
    description:
      "Use this to log a note or activity on a HubSpot record on behalf of the user. " +
      "Opens a note composer pre-filled with a draft body the user can edit before submitting. " +
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
        record_url: { type: "string" },
        record_id: { type: "string" },
        record_type: { type: "string" },
        record_name: { type: "string" },
        draft_body: { type: "string" },
        personalization_signals: { type: "array", items: { type: "string" } },
      },
      required: [],
      additionalProperties: true,
    },
    ui_resource_uri: ACTIVITY_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleActivity,
};

// =============================================================================
// REASSIGN VIEW
// =============================================================================

const REASSIGN_RESOURCE_URI = "ui://agntux-hubspot/reassign" as const;
const REASSIGN_LABEL = "HubSpot reassign record";

interface ReassignArgs { action_id: string }

interface CandidateOwner { ownerId: string; name: string }

interface ReassignPayloadOk {
  record_url: string;
  record_id: string;
  record_type: string;
  record_name: string;
  current_owner: string;
  candidate_owners: CandidateOwner[];
}

type ReassignPayload = ReassignPayloadOk | { error: string };

async function handleReassign(
  args: ReassignArgs,
  ctx: ViewToolContext,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: ReassignPayload }> {
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: CONTENT_TEXT(REASSIGN_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const { frontmatter, body } = parseFrontmatter(buf.toString("utf8"));
    if (frontmatter.status === "done" || frontmatter.status === "dismissed") {
      return {
        content: CONTENT_TEXT(REASSIGN_LABEL),
        structuredContent: errorPayload("action_already_handled"),
      };
    }
    const data = parseYamlSection(body, "Reassign payload");
    if (!data) {
      return {
        content: CONTENT_TEXT(REASSIGN_LABEL),
        structuredContent: errorPayload("reassign_payload_missing"),
      };
    }

    const rawOwners = Array.isArray(data.candidate_owners) ? data.candidate_owners : [];
    const candidate_owners: CandidateOwner[] = rawOwners
      .map((x): CandidateOwner | null => {
        if (!x || typeof x !== "object") return null;
        const r = x as Record<string, unknown>;
        const ownerId = str(r.ownerId);
        if (!ownerId) return null;
        return { ownerId, name: str(r.name) };
      })
      .filter((o): o is CandidateOwner => o !== null);

    const payload: ReassignPayloadOk = {
      record_url: str(data.record_url),
      record_id: str(data.record_id),
      record_type: str(data.record_type),
      record_name: str(data.record_name),
      current_owner: str(data.current_owner),
      candidate_owners,
    };
    return {
      content: CONTENT_TEXT(REASSIGN_LABEL),
      structuredContent: payload,
    };
  } catch {
    return {
      content: CONTENT_TEXT(REASSIGN_LABEL),
      structuredContent: errorPayload("action_not_found"),
    };
  }
}

const reassignViewTool: ViewTool<ReassignArgs, ReassignPayload> = {
  descriptor: {
    name: "agntux_hubspot_reassign_view",
    description:
      "Use this to reassign a HubSpot record (deal, ticket, or contact) to another owner on behalf of the user. " +
      "Opens an owner picker with team members available to receive the record. " +
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
        record_url: { type: "string" },
        record_id: { type: "string" },
        record_type: { type: "string" },
        record_name: { type: "string" },
        current_owner: { type: "string" },
        candidate_owners: { type: "array" },
      },
      required: [],
      additionalProperties: true,
    },
    ui_resource_uri: REASSIGN_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleReassign,
};

// =============================================================================
// Module export (listing.yaml order)
// =============================================================================

const mod: ViewToolModule = {
  viewTools: [
    moveDealViewTool,
    taskViewTool,
    activityViewTool,
    reassignViewTool,
  ],
};

export default mod;
