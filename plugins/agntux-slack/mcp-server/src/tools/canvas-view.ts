// =============================================================================
// canvas_view — render tool for the agntux-slack Slack canvas-summary MCP App.
//
// Shape rules (mirrors compose-view.ts):
//   - The sync skill pre-composed the canvas sections at ingest time and
//     stored them in the action file's `## Canvas payload` body section.
//     This tool reads <root>/actions/{action_id}.md, verifies the action is
//     still open, and lifts the payload — it does NOT call Slack tools
//     (read-only, stateless).
//   - Inline structured args still win when supplied (legacy / testing path).
//   - Hard caps are enforced server-side. Never throws from the happy path.
//
// Returns:
//   On success — { structuredContent: CanvasPayload, content: [...], _meta }
//   On error   — { structuredContent: { error: '...' }, content: [...], _meta }
//
// Committed-envelope encoding (5.0.0+):
//   The component emits an envelope addressed at the user's Slack Connector
//   directly — no agntux-slack draft skill in the chain (the skill was
//   removed in 5.0.0). channel_id, thread_ts, scalar fields, and JSON-encoded
//   list fields are all carried inline. The envelope instructs the host to
//   call slack_create_canvas first, then post the canvas URL as a Slack
//   mrkdwn link `<URL|title>` in the parent's thread (via
//   slack_send_message). See
//   ui-handlers/canvas/component/src/lib/build-canvas-envelope.ts for the
//   full shape and rationale.
// =============================================================================

import { statSync } from "node:fs";
import { join } from "node:path";
import { expectedAgntuxRoot } from "../agntux-root.js";
import { parseActionFile } from "../parse-action.js";

// ── Constants & caps ─────────────────────────────────────────────────────────

const CANVAS_RESOURCE_URI = "ui://slack-canvas" as const;
const MAX_TITLE_CHARS = 80;
const MAX_TLDR_CHARS = 500;
const MAX_DECISIONS = 8;
const MAX_DECISION_CHARS = 200;
const MAX_OPEN_QUESTIONS = 8;
const MAX_QUESTION_CHARS = 200;
const MAX_PARTICIPANTS = 12;
const MAX_FOLLOWUP_CHARS = 200;

// ── Types ────────────────────────────────────────────────────────────────────

interface ChannelInfo {
  id: string;
  name: string;
}

interface ThreadInfo {
  parent_ts: string;
  total_replies: number;
  participants: string[];
}

interface DraftedCanvas {
  title: string;
  tldr: string;
  decisions: string[];
  open_questions: string[];
  participants: string[];
}

interface CanvasStructuredContent {
  action_id: string;
  channel: ChannelInfo;
  thread: ThreadInfo;
  drafted_canvas: DraftedCanvas;
  proposed_followup_message: string;
}

interface CanvasStructuredError {
  error:
    | "action_not_found"
    | "action_already_handled"
    | "agntux_root_missing"
    | "license_paused"
    | "canvas_payload_missing";
}

interface ViewToolMeta {
  ui: {
    resourceUri: typeof CANVAS_RESOURCE_URI;
    visibility: ["model", "app"];
  };
}

interface ViewToolSuccess {
  structuredContent: CanvasStructuredContent;
  content: Array<{ type: "text"; text: string }>;
  _meta: ViewToolMeta;
}

interface ViewToolError {
  structuredContent: CanvasStructuredError;
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

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function structuredError(
  kind: CanvasStructuredError["error"],
  message: string,
): ViewToolError {
  return {
    structuredContent: { error: kind },
    content: [{ type: "text", text: message }],
    _meta: { ui: { resourceUri: CANVAS_RESOURCE_URI, visibility: ["model", "app"] } },
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

function parseChannelArg(raw: unknown): ChannelInfo {
  if (!raw || typeof raw !== "object") return { id: "", name: "" };
  const r = raw as Record<string, unknown>;
  return { id: asString(r.id), name: asString(r.name) };
}

function parseThreadArg(raw: unknown): ThreadInfo {
  if (!raw || typeof raw !== "object") {
    return { parent_ts: "", total_replies: 0, participants: [] };
  }
  const r = raw as Record<string, unknown>;
  return {
    parent_ts: asString(r.parent_ts),
    total_replies: asNumber(r.total_replies),
    participants: asStringArray(r.participants).slice(0, MAX_PARTICIPANTS),
  };
}

function parseDraftedCanvas(raw: unknown): DraftedCanvas {
  if (!raw || typeof raw !== "object") {
    return { title: "", tldr: "", decisions: [], open_questions: [], participants: [] };
  }
  const r = raw as Record<string, unknown>;
  return {
    title: truncate(asString(r.title), MAX_TITLE_CHARS),
    tldr: truncate(asString(r.tldr), MAX_TLDR_CHARS),
    decisions: asStringArray(r.decisions)
      .slice(0, MAX_DECISIONS)
      .map((d) => truncate(d, MAX_DECISION_CHARS)),
    open_questions: asStringArray(r.open_questions)
      .slice(0, MAX_OPEN_QUESTIONS)
      .map((q) => truncate(q, MAX_QUESTION_CHARS)),
    participants: asStringArray(r.participants).slice(0, MAX_PARTICIPANTS),
  };
}

// ── Tool descriptor ──────────────────────────────────────────────────────────

export const canvasViewTool = {
  name: "agntux_slack_canvas_view",
  description:
    "Render the Slack canvas summariser iframe for an action item. Trigger " +
    "when the user says 'open the canvas summariser for action {id}'. Loads " +
    "the canvas sections (title, TL;DR, decisions, open questions, " +
    "participants) and follow-up message from the action file's `## Canvas " +
    "payload` body section when only {action_id} is supplied. Inline args " +
    "override the on-disk payload when both are present — kept for backward " +
    "compat with any out-of-band caller. Action files that lack a `## Canvas " +
    "payload` section surface the `canvas_payload_missing` structured error. " +
    "Returns _meta.ui.resourceUri = ui://slack-canvas.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action_id: {
        type: "string",
        description: "Slug of the action item (from filename, no .md suffix).",
      },
      drafted_canvas: {
        type: "object",
        description: "Optional. { title, tldr, decisions[], open_questions[], participants[] }. Override for the on-disk payload.",
        properties: {
          title: { type: "string" },
          tldr: { type: "string" },
          decisions: { type: "array", items: { type: "string" } },
          open_questions: { type: "array", items: { type: "string" } },
          participants: { type: "array", items: { type: "string" } },
        },
      },
      channel: {
        type: "object",
        description: "Optional. { id: string, name: string }. Override for the on-disk payload.",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
      },
      thread: {
        type: "object",
        description: "Optional. { parent_ts, total_replies, participants[] }. Override for the on-disk payload.",
        properties: {
          parent_ts: { type: "string" },
          total_replies: { type: "number" },
          participants: { type: "array", items: { type: "string" } },
        },
      },
      proposed_followup_message: {
        type: "string",
        description: "Optional. ≤200 chars. Override for the on-disk payload.",
      },
    },
    required: ["action_id"],
  },
  _meta: {
    ui: {
      resourceUri: CANVAS_RESOURCE_URI,
    },
  },
} as const;

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleCanvasView(
  args: Record<string, unknown>,
): Promise<ViewToolResult> {
  const actionId = asString(args.action_id);
  if (!actionId || !/^[a-zA-Z0-9_-]+$/.test(actionId)) {
    return structuredError(
      "action_not_found",
      `canvas_view: invalid action_id '${actionId}'.`,
    );
  }

  const root = expectedAgntuxRoot();
  const actionPath = join(root, "actions", `${actionId}.md`);

  try {
    statSync(actionPath);
  } catch {
    return structuredError(
      "action_not_found",
      `canvas_view: action file not found at ${actionPath}.`,
    );
  }

  let parsed;
  try {
    parsed = parseActionFile(actionPath);
  } catch {
    return structuredError(
      "action_not_found",
      `canvas_view: failed to parse action file ${actionPath}.`,
    );
  }

  const fm = parsed.frontmatter;
  if (isActionAlreadyHandled(fm.status, fm.snoozed_until)) {
    return structuredError(
      "action_already_handled",
      `canvas_view: action ${actionId} is no longer open (status: ${fm.status}).`,
    );
  }

  // Dual-mode resolution. Inline args win; on-disk `## Canvas payload`
  // supplies the fallback. Missing both surfaces canvas_payload_missing.
  const onDisk = parsed.canvas_payload;
  const inlineDraftedCanvas =
    args.drafted_canvas && typeof args.drafted_canvas === "object"
      ? (args.drafted_canvas as Record<string, unknown>)
      : null;
  const inlineDraftedTitle = inlineDraftedCanvas
    ? asString(inlineDraftedCanvas.title)
    : "";
  const hasInlineDrafted = inlineDraftedTitle.length > 0;

  if (!hasInlineDrafted && !onDisk) {
    return structuredError(
      "canvas_payload_missing",
      `canvas_view: action ${actionId} has no \`## Canvas payload\` body section and no inline drafted_canvas was supplied.`,
    );
  }

  const channel = args.channel
    ? parseChannelArg(args.channel)
    : onDisk
      ? { id: onDisk.channel.id, name: onDisk.channel.name }
      : { id: "", name: "" };
  const thread = args.thread
    ? parseThreadArg(args.thread)
    : onDisk
      ? {
          parent_ts: onDisk.thread.parent_ts,
          total_replies: onDisk.thread.total_replies,
          participants: onDisk.thread.participants.slice(0, MAX_PARTICIPANTS),
        }
      : { parent_ts: "", total_replies: 0, participants: [] };
  const draftedCanvas = inlineDraftedCanvas
    ? parseDraftedCanvas(inlineDraftedCanvas)
    : onDisk
      ? {
          title: truncate(onDisk.drafted_canvas.title, MAX_TITLE_CHARS),
          tldr: truncate(onDisk.drafted_canvas.tldr, MAX_TLDR_CHARS),
          decisions: onDisk.drafted_canvas.decisions
            .slice(0, MAX_DECISIONS)
            .map((d) => truncate(d, MAX_DECISION_CHARS)),
          open_questions: onDisk.drafted_canvas.open_questions
            .slice(0, MAX_OPEN_QUESTIONS)
            .map((q) => truncate(q, MAX_QUESTION_CHARS)),
          participants: onDisk.drafted_canvas.participants.slice(
            0,
            MAX_PARTICIPANTS,
          ),
        }
      : { title: "", tldr: "", decisions: [], open_questions: [], participants: [] };
  const inlineFollowup = asString(args.proposed_followup_message);
  const proposedFollowupMessage = truncate(
    inlineFollowup.length > 0
      ? inlineFollowup
      : onDisk?.proposed_followup_message ?? "",
    MAX_FOLLOWUP_CHARS,
  );

  const payload: CanvasStructuredContent = {
    action_id: actionId,
    channel,
    thread,
    drafted_canvas: draftedCanvas,
    proposed_followup_message: proposedFollowupMessage,
  };

  return {
    structuredContent: payload,
    content: [
      {
        type: "text",
        text: `canvas_view rendered for action ${actionId} (#${channel.name}, ${draftedCanvas.decisions.length} decisions, ${draftedCanvas.open_questions.length} open questions).`,
      },
    ],
    _meta: {
      ui: {
        resourceUri: CANVAS_RESOURCE_URI,
        visibility: ["model", "app"],
      },
    },
  };
}
