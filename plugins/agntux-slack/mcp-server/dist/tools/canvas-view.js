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
const CANVAS_RESOURCE_URI = "ui://slack-canvas";
const MAX_TITLE_CHARS = 80;
const MAX_TLDR_CHARS = 500;
const MAX_DECISIONS = 8;
const MAX_DECISION_CHARS = 200;
const MAX_OPEN_QUESTIONS = 8;
const MAX_QUESTION_CHARS = 200;
const MAX_PARTICIPANTS = 12;
const MAX_FOLLOWUP_CHARS = 200;
// ── Helpers ──────────────────────────────────────────────────────────────────
function truncate(s, max) {
    if (s.length <= max)
        return s;
    const slice = s.slice(0, max - 1);
    const lastSpace = slice.lastIndexOf(" ");
    return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + "…";
}
function asString(v, fallback = "") {
    return typeof v === "string" ? v : fallback;
}
function asNumber(v, fallback = 0) {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function asStringArray(v) {
    if (!Array.isArray(v))
        return [];
    return v.filter((x) => typeof x === "string");
}
function structuredError(kind, message) {
    return {
        structuredContent: { error: kind },
        content: [{ type: "text", text: message }],
        _meta: { ui: { resourceUri: CANVAS_RESOURCE_URI, visibility: ["model", "app"] } },
    };
}
function isActionAlreadyHandled(status, snoozedUntil) {
    if (status === "done" || status === "dismissed")
        return true;
    if (status === "snoozed" && snoozedUntil) {
        const until = new Date(snoozedUntil).getTime();
        if (Number.isFinite(until) && until > Date.now())
            return true;
    }
    return false;
}
function parseChannelArg(raw) {
    if (!raw || typeof raw !== "object")
        return { id: "", name: "" };
    const r = raw;
    return { id: asString(r.id), name: asString(r.name) };
}
function parseThreadArg(raw) {
    if (!raw || typeof raw !== "object") {
        return { parent_ts: "", total_replies: 0, participants: [] };
    }
    const r = raw;
    return {
        parent_ts: asString(r.parent_ts),
        total_replies: asNumber(r.total_replies),
        participants: asStringArray(r.participants).slice(0, MAX_PARTICIPANTS),
    };
}
function parseDraftedCanvas(raw) {
    if (!raw || typeof raw !== "object") {
        return { title: "", tldr: "", decisions: [], open_questions: [], participants: [] };
    }
    const r = raw;
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
    description: "Render the Slack canvas summariser iframe for an action item. " +
        "TRIGGER PHRASE (map verbatim to args — do not paraphrase): " +
        "'open the canvas summariser for action {id}' → call with {action_id: id}. " +
        "For this click-time prompt, pass ONLY action_id. The tool reads the " +
        "action file's `## Canvas payload` body section and lifts the canvas " +
        "sections (title, TL;DR, decisions, open questions, participants), " +
        "channel, thread, and follow-up message from disk. Do NOT pass " +
        "drafted_canvas, channel, thread, or proposed_followup_message inline — " +
        "those args are a legacy back-compat surface for out-of-band " +
        "working-memory callers, and any inline value (including partial / empty " +
        "objects) overrides the on-disk payload destructively, producing an " +
        "empty UI. Action files that lack a `## Canvas payload` section surface " +
        "the `canvas_payload_missing` structured error envelope. Returns " +
        "_meta.ui.resourceUri = ui://slack-canvas.",
    inputSchema: {
        type: "object",
        properties: {
            action_id: {
                type: "string",
                description: "Slug of the action item (from filename, no .md suffix).",
            },
            drafted_canvas: {
                type: "object",
                description: "LEGACY back-compat only. Do NOT pass for click-time trigger phrases — " +
                    "the tool lifts the canvas content from the action file's `## Canvas " +
                    "payload`. Inline override for out-of-band working-memory callers.",
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
                description: "LEGACY back-compat only. Do NOT pass for click-time trigger phrases — " +
                    "the tool lifts channel from the action file's `## Canvas payload`. " +
                    "Inline override for out-of-band working-memory callers.",
                properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                },
            },
            thread: {
                type: "object",
                description: "LEGACY back-compat only. Do NOT pass for click-time trigger phrases — " +
                    "the tool lifts thread from the action file's `## Canvas payload`. " +
                    "Inline override for out-of-band working-memory callers.",
                properties: {
                    parent_ts: { type: "string" },
                    total_replies: { type: "number" },
                    participants: { type: "array", items: { type: "string" } },
                },
            },
            proposed_followup_message: {
                type: "string",
                description: "LEGACY back-compat only. Do NOT pass for click-time trigger phrases. " +
                    "Inline override for out-of-band working-memory callers.",
            },
        },
        required: ["action_id"],
    },
    _meta: {
        ui: {
            resourceUri: CANVAS_RESOURCE_URI,
        },
    },
};
// ── Handler ──────────────────────────────────────────────────────────────────
export async function handleCanvasView(args) {
    const actionId = asString(args.action_id);
    if (!actionId || !/^[a-zA-Z0-9_-]+$/.test(actionId)) {
        return structuredError("action_not_found", `canvas_view: invalid action_id '${actionId}'.`);
    }
    const root = expectedAgntuxRoot();
    const actionPath = join(root, "actions", `${actionId}.md`);
    try {
        statSync(actionPath);
    }
    catch {
        return structuredError("action_not_found", `canvas_view: action file not found at ${actionPath}.`);
    }
    let parsed;
    try {
        parsed = parseActionFile(actionPath);
    }
    catch {
        return structuredError("action_not_found", `canvas_view: failed to parse action file ${actionPath}.`);
    }
    const fm = parsed.frontmatter;
    if (isActionAlreadyHandled(fm.status, fm.snoozed_until)) {
        return structuredError("action_already_handled", `canvas_view: action ${actionId} is no longer open (status: ${fm.status}).`);
    }
    // Dual-mode resolution. Inline args win; on-disk `## Canvas payload`
    // supplies the fallback. Missing both surfaces canvas_payload_missing.
    const onDisk = parsed.canvas_payload;
    const inlineDraftedCanvas = args.drafted_canvas && typeof args.drafted_canvas === "object"
        ? args.drafted_canvas
        : null;
    const inlineDraftedTitle = inlineDraftedCanvas
        ? asString(inlineDraftedCanvas.title)
        : "";
    const hasInlineDrafted = inlineDraftedTitle.length > 0;
    if (!hasInlineDrafted && !onDisk) {
        return structuredError("canvas_payload_missing", `canvas_view: action ${actionId} has no \`## Canvas payload\` body section and no inline drafted_canvas was supplied.`);
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
                participants: onDisk.drafted_canvas.participants.slice(0, MAX_PARTICIPANTS),
            }
            : { title: "", tldr: "", decisions: [], open_questions: [], participants: [] };
    const inlineFollowup = asString(args.proposed_followup_message);
    const proposedFollowupMessage = truncate(inlineFollowup.length > 0
        ? inlineFollowup
        : onDisk?.proposed_followup_message ?? "", MAX_FOLLOWUP_CHARS);
    const payload = {
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
//# sourceMappingURL=canvas-view.js.map