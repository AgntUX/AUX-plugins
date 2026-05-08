// =============================================================================
// canvas_view — render tool for the agntux-slack Slack canvas-summary MCP App.
//
// Shape rules (mirrors compose-view.ts):
//   - The sync skill pre-composed the canvas sections at ingest time and
//     stored them in the action file's `## Canvas payload` body section.
//     This tool reads <root>/actions/{action_id}.md, verifies the action is
//     still open, and lifts the payload — it does NOT call Slack tools
//     (read-only, stateless).
//   - Single-mode (6.0.0+): the action file's `## Canvas payload` is the
//     ONLY payload source. Pre-launch the legacy inline-override path was
//     removed alongside the `agents/ui-handlers/canvas.md` metadata file;
//     the only input arg is `action_id`.
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
    | "canvas_payload_missing";
}

interface ViewToolMeta {
  ui: {
    resourceUri: typeof CANVAS_RESOURCE_URI;
  };
  "ui/resourceUri": typeof CANVAS_RESOURCE_URI;
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

function structuredError(
  kind: CanvasStructuredError["error"],
  message: string,
): ViewToolError {
  return {
    structuredContent: { error: kind },
    content: [{ type: "text", text: message }],
    _meta: { ui: { resourceUri: CANVAS_RESOURCE_URI }, "ui/resourceUri": CANVAS_RESOURCE_URI },
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

// ── Tool descriptor ──────────────────────────────────────────────────────────

export const canvasViewTool = {
  name: "agntux_slack_canvas_view",
  description:
    "Open the Slack canvas summariser for an action. Use when the user " +
    "asks to summarise a thread / open the canvas summariser for an " +
    "action ID, when prompted with phrases like 'summarise the thread " +
    "for action {id}' / 'open the canvas summariser for action {id}' / " +
    "'create a canvas for action {id}', or when triage's Open canvas " +
    "button fires this tool via host_prompt. Pass ONLY action_id; the " +
    "handler reads the action file's `## Canvas payload` body section " +
    "from disk and lifts the canvas sections (title, TL;DR, decisions, " +
    "open questions, participants), channel, thread, and follow-up " +
    "message. Action files that lack a `## Canvas payload` section " +
    "surface the `canvas_payload_missing` structured error envelope. " +
    "Returns _meta.ui.resourceUri = ui://slack-canvas.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action_id: {
        type: "string",
        description: "Slug of the action item (from filename, no .md suffix).",
      },
    },
    required: ["action_id"],
  },
  // outputSchema is what tells the host "this tool returns structuredContent
  // that should be passed to the iframe as toolOutput, not surfaced to the
  // model as chat text." Without it, Claude Cowork (and per the upstream
  // app project's c023186 fix, ChatGPT) silently text-render the
  // structuredContent — the iframe never opens. Mirrors the official
  // ext-apps `scenario-modeler-server` example. No `required` fields so
  // both the success payload and the structured-error envelope validate.
  outputSchema: {
    type: "object" as const,
    properties: {
      action_id: { type: "string" },
      channel: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
      },
      thread: {
        type: "object",
        properties: {
          parent_ts: { type: "string" },
          total_replies: { type: "number" },
          participants: { type: "array", items: { type: "string" } },
        },
      },
      drafted_canvas: {
        type: "object",
        properties: {
          title: { type: "string" },
          tldr: { type: "string" },
          decisions: { type: "array", items: { type: "string" } },
          open_questions: { type: "array", items: { type: "string" } },
          participants: { type: "array", items: { type: "string" } },
        },
      },
      proposed_followup_message: { type: "string" },
      error: { type: "string" },
    },
  },
  // The MCP Apps spec defines two synonymous keys for declaring a tool's
  // associated UI resource: the modern nested `_meta.ui.resourceUri` and the
  // legacy flat `_meta["ui/resourceUri"]`. The official `registerAppTool`
  // helper in @modelcontextprotocol/ext-apps emits both, so we do too —
  // defensive against any host that only reads one of them.
  _meta: {
    ui: {
      resourceUri: CANVAS_RESOURCE_URI,
    },
    "ui/resourceUri": CANVAS_RESOURCE_URI,
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

  const onDisk = parsed.canvas_payload;
  if (!onDisk) {
    return structuredError(
      "canvas_payload_missing",
      `canvas_view: action ${actionId} has no \`## Canvas payload\` body section.`,
    );
  }

  const channel: ChannelInfo = {
    id: onDisk.channel.id,
    name: onDisk.channel.name,
  };
  const thread: ThreadInfo = {
    parent_ts: onDisk.thread.parent_ts,
    total_replies: onDisk.thread.total_replies,
    participants: onDisk.thread.participants.slice(0, MAX_PARTICIPANTS),
  };
  const draftedCanvas: DraftedCanvas = {
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
  };
  const proposedFollowupMessage = truncate(
    onDisk.proposed_followup_message ?? "",
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
      },
      "ui/resourceUri": CANVAS_RESOURCE_URI,
    },
  };
}
