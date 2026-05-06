// =============================================================================
// compose_view — render tool for the agntux-slack Slack reply compose MCP App.
//
// Shape rules (mirrors triage-view.ts):
//   - The draft skill has already fetched thread context from Slack and
//     composed the draft body. It passes the structured context here so this
//     tool does NOT call Slack tools — it is read-only and stateless.
//   - The handler reads <root>/actions/{action_id}.md to verify the action
//     exists and is still open (not done/dismissed/snoozed-future).
//   - Hard caps are enforced server-side. Never throws from the happy path.
//
// Returns:
//   On success — { structuredContent: ComposePayload, content: [...], _meta }
//   On error   — { structuredContent: { error: '...' }, content: [...], _meta }
//
// Committed-envelope encoding (for draft-flow-author):
//   Component emits: ux: Use the agntux-slack plugin to commit the drafted
//   reply for action {action_id} with body «{edited_body}» (mode: {send|
//   schedule|save_draft}{, send_at: {RFC3339}}).
//   Unicode guillemets «»  delimit the body. Literal « or » in the body are
//   escaped by doubling (««, »»). The draft skill parser reverses the doubling.
// =============================================================================
import { statSync } from "node:fs";
import { join } from "node:path";
import { expectedAgntuxRoot } from "../agntux-root.js";
import { parseActionFile } from "../parse-action.js";
// ── Constants & caps ─────────────────────────────────────────────────────────
const COMPOSE_RESOURCE_URI = "ui://slack-compose";
const MAX_DRAFTED_BODY_CHARS = 4000;
const MAX_PERSONALIZATION_SIGNALS = 4;
const MAX_SIGNAL_CHARS = 120;
const MAX_PARTICIPANTS = 6;
const MAX_MESSAGES_PREVIEW = 8;
const MAX_MESSAGE_EXCERPT_CHARS = 200;
const MAX_EXCERPT_CHARS = 300;
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
function asStringOrNull(v) {
    return typeof v === "string" ? v : null;
}
function asNumber(v, fallback = 0) {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function asBoolean(v, fallback = false) {
    return typeof v === "boolean" ? v : fallback;
}
function asStringArray(v) {
    if (!Array.isArray(v))
        return [];
    return v.filter((x) => typeof x === "string");
}
function asInitialVerb(v) {
    if (v === "draft" || v === "schedule" || v === "save_draft")
        return v;
    return "draft";
}
function structuredError(kind, message) {
    return {
        structuredContent: { error: kind },
        content: [{ type: "text", text: message }],
        _meta: { ui: { resourceUri: COMPOSE_RESOURCE_URI, visibility: ["model", "app"] } },
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
        return { id: "", name: "", is_dm: false };
    const r = raw;
    return {
        id: asString(r.id),
        name: asString(r.name),
        is_dm: asBoolean(r.is_dm),
    };
}
function parseThreadContextArg(raw) {
    if (!raw || typeof raw !== "object") {
        return {
            parent_ts: "",
            parent_author_real_name: "",
            parent_excerpt: "",
            last_reply_ts: null,
            last_reply_author_real_name: null,
            last_reply_excerpt: null,
            total_replies: 0,
            participants: [],
        };
    }
    const r = raw;
    return {
        parent_ts: asString(r.parent_ts),
        parent_author_real_name: asString(r.parent_author_real_name),
        parent_excerpt: truncate(asString(r.parent_excerpt), MAX_EXCERPT_CHARS),
        last_reply_ts: asStringOrNull(r.last_reply_ts),
        last_reply_author_real_name: asStringOrNull(r.last_reply_author_real_name),
        last_reply_excerpt: asStringOrNull(r.last_reply_excerpt)
            ? truncate(asString(r.last_reply_excerpt), MAX_EXCERPT_CHARS)
            : null,
        total_replies: asNumber(r.total_replies),
        participants: asStringArray(r.participants).slice(0, MAX_PARTICIPANTS),
    };
}
function parseMessagesPreviewArg(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .slice(0, MAX_MESSAGES_PREVIEW)
        .map((item) => {
        if (!item || typeof item !== "object")
            return null;
        const r = item;
        return {
            ts: asString(r.ts),
            author: asString(r.author),
            body_excerpt: truncate(asString(r.body_excerpt), MAX_MESSAGE_EXCERPT_CHARS),
        };
    })
        .filter((x) => x !== null);
}
// ── Tool descriptor ──────────────────────────────────────────────────────────
export const composeViewTool = {
    name: "agntux_slack_compose_view",
    description: "Render the Slack reply composer iframe for an action item. Trigger when " +
        "the user says 'open the reply composer for action {id}' or 'open the " +
        "reply composer in schedule mode for action {id}'. Loads thread context " +
        "and a pre-composed draft from the action file's `## Compose payload` " +
        "body section when only {action_id, initial_verb} are supplied. Inline " +
        "args (drafted_body, thread_context, channel, …) override the on-disk " +
        "payload when both are present — kept for backward compat with any " +
        "out-of-band caller that still produces a working-memory payload. Action " +
        "files that lack a `## Compose payload` section (pre-1.1.0) surface the " +
        "`compose_payload_missing` structured error envelope. Returns " +
        "_meta.ui.resourceUri = ui://slack-compose.",
    inputSchema: {
        type: "object",
        properties: {
            action_id: {
                type: "string",
                description: "Slug of the action item (from filename, no .md suffix).",
            },
            initial_verb: {
                type: "string",
                enum: ["draft", "schedule", "save_draft"],
                description: "Optional. Which mode tab to pre-select. Defaults to 'draft'.",
            },
            drafted_body: {
                type: "string",
                description: "Optional. Inline override for the action file's `## Compose payload → drafted_body`. ≤4000 chars; truncated if longer.",
            },
            personalization_signals: {
                type: "array",
                items: { type: "string" },
                description: "Optional. Up to 4 bullet strings (≤120 chars each). Inline override for the on-disk payload.",
            },
            thread_context: {
                type: "object",
                description: "Optional. Structured thread context override. When omitted, lifted from the action file's `## Compose payload`.",
                properties: {
                    parent_ts: { type: "string" },
                    parent_author_real_name: { type: "string" },
                    parent_excerpt: { type: "string" },
                    last_reply_ts: { type: "string" },
                    last_reply_author_real_name: { type: "string" },
                    last_reply_excerpt: { type: "string" },
                    total_replies: { type: "number" },
                    participants: { type: "array", items: { type: "string" } },
                    messages_preview: { type: "array" },
                },
            },
            channel: {
                type: "object",
                description: "Optional. { id: string, name: string, is_dm: boolean }. Override for the on-disk payload.",
                properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    is_dm: { type: "boolean" },
                },
            },
            proposed_send_time: {
                type: "string",
                description: "Optional RFC 3339 datetime for schedule mode.",
            },
            slack_permalink: {
                type: "string",
                description: "Optional URL to the source thread. Override for the on-disk payload.",
            },
        },
        required: ["action_id"],
    },
    _meta: {
        ui: {
            resourceUri: COMPOSE_RESOURCE_URI,
        },
    },
};
// ── Handler ──────────────────────────────────────────────────────────────────
export async function handleComposeView(args) {
    const actionId = asString(args.action_id);
    if (!actionId || !/^[a-zA-Z0-9_-]+$/.test(actionId)) {
        return structuredError("action_not_found", `compose_view: invalid action_id '${actionId}'.`);
    }
    const root = expectedAgntuxRoot();
    const actionPath = join(root, "actions", `${actionId}.md`);
    try {
        statSync(actionPath);
    }
    catch {
        return structuredError("action_not_found", `compose_view: action file not found at ${actionPath}.`);
    }
    let parsed;
    try {
        parsed = parseActionFile(actionPath);
    }
    catch {
        return structuredError("action_not_found", `compose_view: failed to parse action file ${actionPath}.`);
    }
    const fm = parsed.frontmatter;
    if (isActionAlreadyHandled(fm.status, fm.snoozed_until)) {
        return structuredError("action_already_handled", `compose_view: action ${actionId} is no longer open (status: ${fm.status}).`);
    }
    // Dual-mode resolution: prefer inline args (legacy draft-skill commit-side
    // path) when present, otherwise fall back to the action file's `##
    // Compose payload` body section. Either source can satisfy the contract;
    // missing both surfaces compose_payload_missing.
    const onDisk = parsed.compose_payload;
    const inlineDraftedBody = asString(args.drafted_body);
    const hasInlineBody = inlineDraftedBody.length > 0;
    const inlineThreadCtx = args.thread_context && typeof args.thread_context === "object"
        ? args.thread_context
        : null;
    const inlineChannel = args.channel && typeof args.channel === "object"
        ? args.channel
        : null;
    if (!hasInlineBody && !onDisk) {
        return structuredError("compose_payload_missing", `compose_view: action ${actionId} has no \`## Compose payload\` body section and no inline drafted_body was supplied.`);
    }
    const draftedBody = truncate(hasInlineBody ? inlineDraftedBody : onDisk?.drafted_body ?? "", MAX_DRAFTED_BODY_CHARS);
    const rawSignals = Array.isArray(args.personalization_signals)
        ? args.personalization_signals
        : onDisk
            ? onDisk.personalization_signals
            : [];
    const personalizationSignals = rawSignals
        .slice(0, MAX_PERSONALIZATION_SIGNALS)
        .filter((s) => typeof s === "string")
        .map((s) => truncate(s, MAX_SIGNAL_CHARS));
    const channel = inlineChannel
        ? parseChannelArg(inlineChannel)
        : onDisk
            ? {
                id: onDisk.channel.id,
                name: onDisk.channel.name,
                is_dm: onDisk.channel.is_dm,
            }
            : { id: "", name: "", is_dm: false };
    const threadCtx = inlineThreadCtx
        ? parseThreadContextArg(inlineThreadCtx)
        : onDisk
            ? {
                parent_ts: onDisk.thread_context.parent_ts,
                parent_author_real_name: onDisk.thread_context.parent_author_real_name,
                parent_excerpt: truncate(onDisk.thread_context.parent_excerpt, MAX_EXCERPT_CHARS),
                last_reply_ts: onDisk.thread_context.last_reply_ts,
                last_reply_author_real_name: onDisk.thread_context.last_reply_author_real_name,
                last_reply_excerpt: onDisk.thread_context.last_reply_excerpt
                    ? truncate(onDisk.thread_context.last_reply_excerpt, MAX_EXCERPT_CHARS)
                    : null,
                total_replies: onDisk.thread_context.total_replies,
                participants: onDisk.thread_context.participants.slice(0, MAX_PARTICIPANTS),
            }
            : parseThreadContextArg(undefined);
    // Extract raw messages_preview once so the truncation check and the
    // normalizer share a single source of truth. Inline override wins; on-disk
    // payload supplies the fallback.
    const rawMessages = inlineThreadCtx
        ? Array.isArray(inlineThreadCtx.messages_preview)
            ? inlineThreadCtx.messages_preview
            : []
        : (onDisk?.thread_context.messages_preview ?? []);
    const messagesPreview = parseMessagesPreviewArg(rawMessages);
    const messagesTruncated = rawMessages.length > MAX_MESSAGES_PREVIEW;
    const proposedSendTime = asStringOrNull(args.proposed_send_time);
    const slackPermalink = asStringOrNull(args.slack_permalink) ??
        (onDisk ? onDisk.slack_permalink : null);
    const initialVerb = asInitialVerb(args.initial_verb);
    const payload = {
        action_id: actionId,
        initial_verb: initialVerb,
        channel,
        thread: {
            parent_ts: threadCtx.parent_ts,
            parent_author_real_name: threadCtx.parent_author_real_name,
            parent_excerpt: threadCtx.parent_excerpt,
            last_reply_ts: threadCtx.last_reply_ts,
            last_reply_author_real_name: threadCtx.last_reply_author_real_name,
            last_reply_excerpt: threadCtx.last_reply_excerpt,
            total_replies: threadCtx.total_replies,
            participants: threadCtx.participants,
        },
        messages_preview: messagesPreview,
        messages_truncated: messagesTruncated,
        drafted_body: draftedBody,
        personalization_signals: personalizationSignals,
        proposed_send_time: proposedSendTime,
        slack_permalink: slackPermalink,
    };
    const channelLabel = channel.is_dm ? `DM` : `#${channel.name}`;
    return {
        structuredContent: payload,
        content: [
            {
                type: "text",
                text: `compose_view rendered for action ${actionId} (${channelLabel}, mode: ${initialVerb}).`,
            },
        ],
        _meta: {
            ui: {
                resourceUri: COMPOSE_RESOURCE_URI,
                visibility: ["model", "app"],
            },
        },
    };
}
//# sourceMappingURL=compose-view.js.map