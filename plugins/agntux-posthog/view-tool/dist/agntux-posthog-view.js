// src/agntux-posthog-view.ts
import {
  extractFrontmatterMetadata,
  parseFrontmatter,
  renderConfirmationText
} from "@agntux/plugin-runtime";
var RESOLVE_RESOURCE_URI = "ui://agntux-posthog/resolve";
var REPLY_RESOURCE_URI = "ui://agntux-posthog/reply";
var EXPERIMENT_RESOURCE_URI = "ui://agntux-posthog/experiment";
var REPORT_RESOURCE_URI = "ui://agntux-posthog/report";
var UI_LABEL_RESOLVE = "PostHog \u2014 Resolve Error Issue";
var UI_LABEL_REPLY = "PostHog \u2014 Reply to Comment";
var UI_LABEL_EXPERIMENT = "PostHog \u2014 Ship Experiment Variant";
var UI_LABEL_REPORT = "PostHog \u2014 Mark Report Handled";
function str(v) {
  return typeof v === "string" ? v : "";
}
function strArr(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
async function handleResolve(args, ctx) {
  const emptyPayload = {
    action_id: "",
    issue_url: "",
    issue_id: "",
    issue_title: "",
    occurrence_summary: "",
    current_status: "",
    current_assignee: "",
    candidate_assignees: [],
    target_status: "resolved"
  };
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_RESOLVE) }],
      structuredContent: emptyPayload
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);
    const fm = extractFrontmatterMetadata(text) ?? {};
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
        target_status: targetStatus
      }
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_RESOLVE) }],
      structuredContent: { ...emptyPayload, action_id: actionId }
    };
  }
}
async function handleReply(args, ctx) {
  const emptyPayload = {
    action_id: "",
    thread_url: "",
    source_item_title: "",
    thread_excerpt: "",
    author_name: "",
    draft_body: "",
    personalization_signals: ""
  };
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_REPLY) }],
      structuredContent: emptyPayload
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);
    const fm = extractFrontmatterMetadata(text) ?? {};
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
        personalization_signals: personalizationSignals
      }
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_REPLY) }],
      structuredContent: { ...emptyPayload, action_id: actionId }
    };
  }
}
async function handleExperiment(args, ctx) {
  const emptyPayload = {
    action_id: "",
    experiment_url: "",
    experiment_id: "",
    experiment_name: "",
    variants: [],
    recommended_variant: "",
    result_summary: ""
  };
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_EXPERIMENT) }],
      structuredContent: emptyPayload
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);
    const fm = extractFrontmatterMetadata(text) ?? {};
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
        variants,
        recommended_variant: recommendedVariant,
        result_summary: resultSummary
      }
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_EXPERIMENT) }],
      structuredContent: { ...emptyPayload, action_id: actionId }
    };
  }
}
async function handleReport(args, ctx) {
  const emptyPayload = {
    action_id: "",
    report_url: "",
    report_id: "",
    report_title: "",
    report_summary: "",
    target_state: "resolved"
  };
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_REPORT) }],
      structuredContent: emptyPayload
    };
  }
  try {
    const buf = await ctx.fs.readFile(`actions/${actionId}.md`);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);
    const fm = extractFrontmatterMetadata(text) ?? {};
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
        target_state: targetState
      }
    };
  } catch {
    return {
      content: [{ type: "text", text: renderConfirmationText(UI_LABEL_REPORT) }],
      structuredContent: { ...emptyPayload, action_id: actionId }
    };
  }
}
var MCP_APP_SUFFIX = "This tool is an MCP App view tool: it returns a structured data payload that the host (Claude Desktop / Claude Cowork / Claude Code) renders into an interactive iframe shown above the next assistant turn. The iframe is the user-visible result of calling this tool; no additional chat output, summary, or visualization tool call is needed afterwards.";
var resolveViewTool = {
  descriptor: {
    name: "agntux_posthog_resolve",
    description: "Use this to resolve or reassign a PostHog error tracking issue. Shown when the user wants to update the status or assignee of an error issue. " + MCP_APP_SUFFIX,
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false
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
        target_status: { type: "string" }
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
        "target_status"
      ],
      additionalProperties: false
    },
    ui_resource_uri: RESOLVE_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleResolve
};
var replyViewTool = {
  descriptor: {
    name: "agntux_posthog_reply",
    description: "Use this to reply to a PostHog comment thread. Shown when the user wants to send a reply to a comment thread on an error issue or insight. " + MCP_APP_SUFFIX,
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false
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
        personalization_signals: { type: "string" }
      },
      required: [
        "action_id",
        "thread_url",
        "source_item_title",
        "thread_excerpt",
        "author_name",
        "draft_body",
        "personalization_signals"
      ],
      additionalProperties: false
    },
    ui_resource_uri: REPLY_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleReply
};
var experimentViewTool = {
  descriptor: {
    name: "agntux_posthog_experiment",
    description: "Use this to ship the winning variant of a PostHog experiment. Shown when the user wants to roll out or ship an experiment variant based on results. " + MCP_APP_SUFFIX,
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false
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
        result_summary: { type: "string" }
      },
      required: [
        "action_id",
        "experiment_url",
        "experiment_id",
        "experiment_name",
        "variants",
        "recommended_variant",
        "result_summary"
      ],
      additionalProperties: false
    },
    ui_resource_uri: EXPERIMENT_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleExperiment
};
var reportViewTool = {
  descriptor: {
    name: "agntux_posthog_report",
    description: "Use this to mark a flagged PostHog inbox report as handled. Shown when the user wants to resolve or archive a flagged inbox report. " + MCP_APP_SUFFIX,
    inputSchema: {
      type: "object",
      properties: { action_id: { type: "string" } },
      required: ["action_id"],
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        report_url: { type: "string" },
        report_id: { type: "string" },
        report_title: { type: "string" },
        report_summary: { type: "string" },
        target_state: { type: "string" }
      },
      required: [
        "action_id",
        "report_url",
        "report_id",
        "report_title",
        "report_summary",
        "target_state"
      ],
      additionalProperties: false
    },
    ui_resource_uri: REPORT_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" }]
  },
  handle: handleReport
};
var mod = {
  viewTools: [resolveViewTool, replyViewTool, experimentViewTool, reportViewTool]
};
var agntux_posthog_view_default = mod;
export {
  agntux_posthog_view_default as default
};
