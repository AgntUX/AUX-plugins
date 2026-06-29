// =============================================================================
// agntux-posthog-view — view tools for the PostHog connector plugin.
//
// Exports FOUR view tools in a single module:
//   1. agntux_posthog_resolve   — resolve or reassign a PostHog error issue
//   2. agntux_posthog_reply     — reply to a PostHog comment thread
//   3. agntux_posthog_experiment — ship the winning experiment variant
//   4. agntux_posthog_report    — mark a flagged inbox report handled
//
// All handlers are action_id-driven. They read the action file from the
// personal action store, extract the relevant data, and return a
// structuredContent payload the iframe consumes.
//
// Render-harness safety: every handler guards against empty/undefined action_id
// and degrades gracefully to a placeholder so cold first-paint and the
// headless render check never produce a tool-call HTTP 500.
// =============================================================================

import {
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  extractFrontmatterMetadata,
  parseFrontmatter,
  renderConfirmationText,
} from "@agntux/plugin-runtime";

// ── Constants ─────────────────────────────────────────────────────────────────

const RESOLVE_RESOURCE_URI = "ui://agntux-posthog/resolve" as const;
const REPLY_RESOURCE_URI = "ui://agntux-posthog/reply" as const;
const EXPERIMENT_RESOURCE_URI = "ui://agntux-posthog/experiment" as const;
const REPORT_RESOURCE_URI = "ui://agntux-posthog/report" as const;

const UI_LABEL_RESOLVE = "PostHog — Resolve Error Issue";
const UI_LABEL_REPLY = "PostHog — Reply to Comment";
const UI_LABEL_EXPERIMENT = "PostHog — Ship Experiment Variant";
const UI_LABEL_REPORT = "PostHog — Mark Report Handled";

// ── Safe accessor ─────────────────────────────────────────────────────────────

function str(v: unknown): string {
  if (typeof v === "string") return v;
  // Coerce primitive non-string scalars (number / boolean / bigint). PostHog
  // ids (issue_id, experiment_id, …) are numeric, and the ingest skill often
  // writes them UNQUOTED in YAML frontmatter, so extractFrontmatterMetadata
  // parses them as numbers. The previous `typeof v === "string" ? v : ""`
  // silently dropped those, leaving issue_id empty and the iframe's
  // "Update issue" button a dead no-op. Coercing here preserves them.
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  return "";
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  // Coerce each element via str() so numeric list entries (e.g. numeric
  // variant keys or assignee ids) survive instead of being filtered out.
  return v.map((x) => str(x)).filter((s) => s.length > 0);
}

// ── Types: resolve ────────────────────────────────────────────────────────────

interface ResolveArgs {
  action_id: string;
}

interface ResolvePayload {
  action_id: string;
  issue_url: string;
  issue_id: string;
  issue_title: string;
  occurrence_summary: string;
  current_status: string;
  current_assignee: string;
  candidate_assignees: string[];
  target_status: string;
}

// ── Types: reply ──────────────────────────────────────────────────────────────

interface ReplyArgs {
  action_id: string;
}

interface ReplyPayload {
  action_id: string;
  thread_url: string;
  source_item_title: string;
  thread_excerpt: string;
  author_name: string;
  draft_body: string;
  personalization_signals: string;
}

// ── Types: experiment ─────────────────────────────────────────────────────────

interface ExperimentArgs {
  action_id: string;
}

interface ExperimentPayload {
  action_id: string;
  experiment_url: string;
  experiment_id: string;
  experiment_name: string;
  variants: string[];
  recommended_variant: string;
  result_summary: string;
}

// ── Types: report ─────────────────────────────────────────────────────────────

interface ReportArgs {
  action_id: string;
}

interface ReportPayload {
  action_id: string;
  report_url: string;
  report_id: string;
  report_title: string;
  report_summary: string;
  target_state: string;
}

// ── Handler: resolve ──────────────────────────────────────────────────────────

async function handleResolve(
  args: ResolveArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ResolvePayload;
}> {
  const emptyPayload: ResolvePayload = {
    action_id: "",
    issue_url: "",
    issue_id: "",
    issue_title: "",
    occurrence_summary: "",
    current_status: "",
    current_assignee: "",
    candidate_assignees: [],
    target_status: "resolved",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_RESOLVE) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);

    // Read compose payload fields from frontmatter or body as authored by ingest.
    // The ingest skill writes PostHog-specific fields into frontmatter and body.
    // extractFrontmatterMetadata returns the raw parsed YAML object so arbitrary
    // plugin-specific keys (issue_url, issue_id, …) are accessible without the
    // normalized-shape restriction imposed by parseFrontmatter's return value.
    const fm: Record<string, unknown> = extractFrontmatterMetadata(text) ?? {};

    // Extract fields — prefer frontmatter, fall back to body scan
    const issueUrl = str(fm.issue_url);
    const issueId = str(fm.issue_id);
    const issueTitle = str(fm.issue_title) || str(fm.title);
    const occurrenceSummary = str(fm.occurrence_summary) || (body ? body.split("\n\n")[0] : "");
    const currentStatus = str(fm.current_status) || str(fm.status);
    const currentAssignee = str(fm.current_assignee);
    const candidateAssignees = strArr(fm.candidate_assignees);
    const targetStatus = str(fm.target_status) || "resolved";

    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_RESOLVE) }],
      structuredContent: {
        action_id: actionId,
        issue_url: issueUrl,
        issue_id: issueId,
        issue_title: issueTitle,
        occurrence_summary: occurrenceSummary,
        current_status: currentStatus,
        current_assignee: currentAssignee,
        candidate_assignees: candidateAssignees,
        target_status: targetStatus,
      },
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_RESOLVE) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

// ── Handler: reply ────────────────────────────────────────────────────────────

async function handleReply(
  args: ReplyArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ReplyPayload;
}> {
  const emptyPayload: ReplyPayload = {
    action_id: "",
    thread_url: "",
    source_item_title: "",
    thread_excerpt: "",
    author_name: "",
    draft_body: "",
    personalization_signals: "",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_REPLY) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);
    const fm: Record<string, unknown> = extractFrontmatterMetadata(text) ?? {};

    const threadUrl = str(fm.thread_url);
    const sourceItemTitle = str(fm.source_item_title) || str(fm.title);
    const threadExcerpt = str(fm.thread_excerpt) || (body ? body.split("\n\n")[0] : "");
    const authorName = str(fm.author_name);
    const draftBody = str(fm.draft_body);
    const personalizationSignals = str(fm.personalization_signals);

    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_REPLY) }],
      structuredContent: {
        action_id: actionId,
        thread_url: threadUrl,
        source_item_title: sourceItemTitle,
        thread_excerpt: threadExcerpt,
        author_name: authorName,
        draft_body: draftBody,
        personalization_signals: personalizationSignals,
      },
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_REPLY) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

// ── Handler: experiment ───────────────────────────────────────────────────────

async function handleExperiment(
  args: ExperimentArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ExperimentPayload;
}> {
  const emptyPayload: ExperimentPayload = {
    action_id: "",
    experiment_url: "",
    experiment_id: "",
    experiment_name: "",
    variants: [],
    recommended_variant: "",
    result_summary: "",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_EXPERIMENT) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);
    const fm: Record<string, unknown> = extractFrontmatterMetadata(text) ?? {};

    const experimentUrl = str(fm.experiment_url);
    const experimentId = str(fm.experiment_id);
    const experimentName = str(fm.experiment_name) || str(fm.title);
    const variants = strArr(fm.variants);
    const recommendedVariant = str(fm.recommended_variant);
    const resultSummary = str(fm.result_summary) || (body ? body.split("\n\n")[0] : "");

    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_EXPERIMENT) }],
      structuredContent: {
        action_id: actionId,
        experiment_url: experimentUrl,
        experiment_id: experimentId,
        experiment_name: experimentName,
        variants: variants,
        recommended_variant: recommendedVariant,
        result_summary: resultSummary,
      },
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_EXPERIMENT) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

// ── Handler: report ───────────────────────────────────────────────────────────

async function handleReport(
  args: ReportArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ReportPayload;
}> {
  const emptyPayload: ReportPayload = {
    action_id: "",
    report_url: "",
    report_id: "",
    report_title: "",
    report_summary: "",
    target_state: "resolved",
  };

  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_REPORT) }],
      structuredContent: emptyPayload,
    };
  }

  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);
    const fm: Record<string, unknown> = extractFrontmatterMetadata(text) ?? {};

    const reportUrl = str(fm.report_url);
    const reportId = str(fm.report_id);
    const reportTitle = str(fm.report_title) || str(fm.title);
    const reportSummary = str(fm.report_summary) || (body ? body.split("\n\n")[0] : "");
    const targetState = str(fm.target_state) || "resolved";

    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_REPORT) }],
      structuredContent: {
        action_id: actionId,
        report_url: reportUrl,
        report_id: reportId,
        report_title: reportTitle,
        report_summary: reportSummary,
        target_state: targetState,
      },
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_REPORT) }],
      structuredContent: { ...emptyPayload, action_id: actionId },
    };
  }
}

// ── Descriptors ───────────────────────────────────────────────────────────────

const MCP_APP_SUFFIX =
  "This tool is an MCP App view tool: it returns a structured data " +
  "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
  "renders into an interactive iframe shown above the next assistant " +
  "turn. The iframe is the user-visible result of calling this tool; " +
  "no additional chat output, summary, or visualization tool call is " +
  "needed afterwards.";

const resolveViewTool: ViewTool<ResolveArgs, ResolvePayload> = {
  descriptor: {
    name: "agntux_posthog_resolve",
    description:
      "Use this to resolve or reassign a PostHog error tracking issue. " +
      "Shown when the user wants to update the status or assignee of an error issue. " +
      MCP_APP_SUFFIX,
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        issue_url: { type: "string" },
        issue_id: { type: "string" },
        issue_title: { type: "string" },
        occurrence_summary: { type: "string" },
        current_status: { type: "string" },
        current_assignee: { type: "string" },
        candidate_assignees: { type: "array", items: { type: "string" } },
        target_status: { type: "string" },
      },
      required: [
        "action_id",
        "issue_url",
        "issue_id",
        "issue_title",
        "occurrence_summary",
        "current_status",
        "current_assignee",
        "candidate_assignees",
        "target_status",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: RESOLVE_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleResolve,
};

const replyViewTool: ViewTool<ReplyArgs, ReplyPayload> = {
  descriptor: {
    name: "agntux_posthog_reply",
    description:
      "Use this to reply to a PostHog comment thread. " +
      "Shown when the user wants to send a reply to a comment thread on an error issue or insight. " +
      MCP_APP_SUFFIX,
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        thread_url: { type: "string" },
        source_item_title: { type: "string" },
        thread_excerpt: { type: "string" },
        author_name: { type: "string" },
        draft_body: { type: "string" },
        personalization_signals: { type: "string" },
      },
      required: [
        "action_id",
        "thread_url",
        "source_item_title",
        "thread_excerpt",
        "author_name",
        "draft_body",
        "personalization_signals",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: REPLY_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleReply,
};

const experimentViewTool: ViewTool<ExperimentArgs, ExperimentPayload> = {
  descriptor: {
    name: "agntux_posthog_experiment",
    description:
      "Use this to ship the winning variant of a PostHog experiment. " +
      "Shown when the user wants to roll out or ship an experiment variant based on results. " +
      MCP_APP_SUFFIX,
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        experiment_url: { type: "string" },
        experiment_id: { type: "string" },
        experiment_name: { type: "string" },
        variants: { type: "array", items: { type: "string" } },
        recommended_variant: { type: "string" },
        result_summary: { type: "string" },
      },
      required: [
        "action_id",
        "experiment_url",
        "experiment_id",
        "experiment_name",
        "variants",
        "recommended_variant",
        "result_summary",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: EXPERIMENT_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleExperiment,
};

const reportViewTool: ViewTool<ReportArgs, ReportPayload> = {
  descriptor: {
    name: "agntux_posthog_report",
    description:
      "Use this to mark a flagged PostHog inbox report as handled. " +
      "Shown when the user wants to resolve or archive a flagged inbox report. " +
      MCP_APP_SUFFIX,
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        report_url: { type: "string" },
        report_id: { type: "string" },
        report_title: { type: "string" },
        report_summary: { type: "string" },
        target_state: { type: "string" },
      },
      required: [
        "action_id",
        "report_url",
        "report_id",
        "report_title",
        "report_summary",
        "target_state",
      ],
      additionalProperties: false,
    },
    ui_resource_uri: REPORT_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }],
  },
  handle: handleReport,
};

// ── Default export ────────────────────────────────────────────────────────────

const mod: ViewToolModule = {
  viewTools: [resolveViewTool, replyViewTool, experimentViewTool, reportViewTool],
};
export default mod;
