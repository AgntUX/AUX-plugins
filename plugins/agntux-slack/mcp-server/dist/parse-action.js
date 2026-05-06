// =============================================================================
// parse-action — read an action item file and surface the fields the triage
// view tool needs. Stateless, read-only; never writes to disk.
//
// Frontmatter is parsed via the `yaml` package; body sections (`## Why this
// matters`, `## Personalization fit`, `## Compose payload`,
// `## Canvas payload`) are extracted by header lookup. The two payload
// sections wrap a fenced ```yaml block whose shape mirrors compose-view /
// canvas-view's structuredContent contract.
// =============================================================================
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
const FALLBACK_FRONTMATTER = {
    id: "",
    status: "",
    priority: "",
    reason_class: "",
    reason_detail: "",
    source: null,
    source_ref: null,
    related_entities: [],
    suggested_actions: [],
    due_by: null,
    snoozed_until: null,
    completed_at: null,
    dismissed_at: null,
    created_at: null,
};
function asString(v, fallback = "") {
    return typeof v === "string" ? v : fallback;
}
function asStringOrNull(v) {
    return typeof v === "string" ? v : null;
}
function asStringArray(v) {
    if (!Array.isArray(v))
        return [];
    return v.filter((x) => typeof x === "string");
}
function asSuggestedActions(v) {
    if (!Array.isArray(v))
        return [];
    return v
        .map((row) => {
        if (!row || typeof row !== "object")
            return null;
        const r = row;
        const label = asString(r.label);
        const host_prompt = asString(r.host_prompt);
        if (!label || !host_prompt)
            return null;
        // Normalise newlines: YAML block scalars often end with a trailing \n.
        return { label, host_prompt: host_prompt.trimEnd() };
    })
        .filter((row) => row !== null);
}
export function parseFrontmatter(text) {
    const match = FRONTMATTER_RE.exec(text);
    if (!match) {
        return { frontmatter: { ...FALLBACK_FRONTMATTER }, body: text };
    }
    const yamlBlock = match[1];
    const body = match[2];
    let raw = {};
    try {
        const parsed = parseYaml(yamlBlock);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            raw = parsed;
        }
    }
    catch {
        // Malformed YAML: fall through with empty raw — caller surfaces a graceful
        // error path instead of throwing.
    }
    return {
        frontmatter: {
            id: asString(raw.id),
            status: asString(raw.status),
            priority: asString(raw.priority),
            reason_class: asString(raw.reason_class),
            reason_detail: asString(raw.reason_detail),
            source: asStringOrNull(raw.source),
            source_ref: asStringOrNull(raw.source_ref),
            related_entities: asStringArray(raw.related_entities),
            suggested_actions: asSuggestedActions(raw.suggested_actions),
            due_by: asStringOrNull(raw.due_by),
            snoozed_until: asStringOrNull(raw.snoozed_until),
            completed_at: asStringOrNull(raw.completed_at),
            dismissed_at: asStringOrNull(raw.dismissed_at),
            created_at: asStringOrNull(raw.created_at),
        },
        body,
    };
}
// Extract the prose under a top-level body section (e.g. `## Why this matters`).
// Returns the section's plain text up to the next `## ` header, or the empty
// string when the section is absent. Trims leading/trailing whitespace.
export function extractSection(body, header) {
    const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^##\\s+${escaped}\\s*$`, "m");
    const match = re.exec(body);
    if (!match)
        return "";
    const start = match.index + match[0].length;
    const after = body.slice(start);
    // Find the next `## ` header (any character class) to know where to stop.
    const nextHeader = /^##\s+/m.exec(after);
    const sliceEnd = nextHeader ? nextHeader.index : after.length;
    return after.slice(0, sliceEnd).trim();
}
// Lift a YAML object out of a fenced ```yaml block under a `## ` header.
// Returns the parsed object, or null when the header is absent, the fenced
// block can't be located, or YAML parse fails. Mirrors agntux-core's
// section-extraction idiom; the schema-validation work is the caller's.
export function parseBodySection(body, header) {
    const section = extractSection(body, header);
    if (!section)
        return null;
    // Match a fenced YAML block; tolerate ```yml as an alias and stray
    // whitespace after the opening fence. The closing fence must be the first
    // bare ``` line at column zero.
    const fenceRe = /^```ya?ml\s*\n([\s\S]*?)\n```\s*$/m;
    const match = fenceRe.exec(section);
    if (!match)
        return null;
    const yamlText = match[1];
    try {
        const parsed = parseYaml(yamlText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
function asNumber(v, fallback = 0) {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function asBoolean(v, fallback = false) {
    return typeof v === "boolean" ? v : fallback;
}
function normalizeMessagesPreview(v) {
    if (!Array.isArray(v))
        return [];
    return v
        .map((item) => {
        if (!item || typeof item !== "object")
            return null;
        const r = item;
        return {
            ts: asString(r.ts),
            author: asString(r.author),
            body_excerpt: asString(r.body_excerpt),
        };
    })
        .filter((x) => x !== null);
}
function normalizeComposePayload(raw) {
    if (!raw)
        return null;
    const tcRaw = raw.thread_context && typeof raw.thread_context === "object"
        ? raw.thread_context
        : {};
    const channelRaw = raw.channel && typeof raw.channel === "object"
        ? raw.channel
        : {};
    const draftedBody = asString(raw.drafted_body);
    if (!draftedBody)
        return null;
    return {
        drafted_body: draftedBody,
        personalization_signals: asStringArray(raw.personalization_signals),
        thread_context: {
            parent_ts: asString(tcRaw.parent_ts),
            parent_author_real_name: asString(tcRaw.parent_author_real_name),
            parent_excerpt: asString(tcRaw.parent_excerpt),
            last_reply_ts: asStringOrNull(tcRaw.last_reply_ts),
            last_reply_author_real_name: asStringOrNull(tcRaw.last_reply_author_real_name),
            last_reply_excerpt: asStringOrNull(tcRaw.last_reply_excerpt),
            total_replies: asNumber(tcRaw.total_replies),
            participants: asStringArray(tcRaw.participants),
            messages_preview: normalizeMessagesPreview(tcRaw.messages_preview),
        },
        channel: {
            id: asString(channelRaw.id),
            name: asString(channelRaw.name),
            is_dm: asBoolean(channelRaw.is_dm),
        },
        slack_permalink: asStringOrNull(raw.slack_permalink),
        generated_at: asStringOrNull(raw.generated_at),
    };
}
function normalizeCanvasPayload(raw) {
    if (!raw)
        return null;
    const draftedRaw = raw.drafted_canvas && typeof raw.drafted_canvas === "object"
        ? raw.drafted_canvas
        : {};
    const channelRaw = raw.channel && typeof raw.channel === "object"
        ? raw.channel
        : {};
    const threadRaw = raw.thread && typeof raw.thread === "object"
        ? raw.thread
        : {};
    const title = asString(draftedRaw.title);
    if (!title)
        return null;
    return {
        drafted_canvas: {
            title,
            tldr: asString(draftedRaw.tldr),
            decisions: asStringArray(draftedRaw.decisions),
            open_questions: asStringArray(draftedRaw.open_questions),
            participants: asStringArray(draftedRaw.participants),
        },
        channel: {
            id: asString(channelRaw.id),
            name: asString(channelRaw.name),
        },
        thread: {
            parent_ts: asString(threadRaw.parent_ts),
            total_replies: asNumber(threadRaw.total_replies),
            participants: asStringArray(threadRaw.participants),
        },
        proposed_followup_message: asString(raw.proposed_followup_message),
        generated_at: asStringOrNull(raw.generated_at),
    };
}
export function parseActionFile(filePath) {
    const text = readFileSync(filePath, "utf8");
    const { frontmatter, body } = parseFrontmatter(text);
    return {
        frontmatter,
        why_matters: extractSection(body, "Why this matters"),
        personalization_fit: extractSection(body, "Personalization fit"),
        compose_payload: normalizeComposePayload(parseBodySection(body, "Compose payload")),
        canvas_payload: normalizeCanvasPayload(parseBodySection(body, "Canvas payload")),
    };
}
//# sourceMappingURL=parse-action.js.map