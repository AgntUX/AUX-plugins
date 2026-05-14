// =============================================================================
// parse-action — pure helpers for the action-item file format used by
// triage-view and friends. Stateless, read-only; takes a Buffer/string body
// rather than reading from disk so it works against both the local-fs and
// S3-backed ViewToolContext.
//
// Frontmatter is parsed via the `yaml` package; body sections (`## Why this
// matters`, `## Personalization fit`) are extracted by header lookup.
//
// Lifted from `plugins/agntux-core/mcp-server/src/parse-action.ts` — the
// only behavioural change is that `parseActionFile` now accepts the file
// contents directly (string | Buffer) instead of a file path. The fs read
// belongs in the caller (a ViewToolContext.fs.readFile) so this module stays
// platform-agnostic.
// =============================================================================
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
    team_id: null,
    team_slug: null,
    source_team: null,
    member_relevance_class: null,
    relevance_classes: [],
    done_by_user_slug: null,
    done_by_user_id: null,
    done_at: null,
};
function asString(v, fallback = "") {
    return typeof v === "string" ? v : fallback;
}
function asStringOrNull(v) {
    return typeof v === "string" ? v : null;
}
// Like asStringOrNull but normalizes whitespace-only strings to null so
// callers don't have to distinguish "absent" from "blank". Used for the
// optional team-aware fields where YAML may serialize `team_slug: ""` or
// `team_slug: ~` interchangeably.
function asNonEmptyStringOrNull(v) {
    if (typeof v !== "string")
        return null;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function asStringArray(v) {
    if (!Array.isArray(v))
        return [];
    return v.filter((x) => typeof x === "string");
}
// Only http(s) URLs are accepted by the openLink dispatcher. This is the
// trust boundary that catches buggy or hostile ingest plugins emitting
// `javascript:`, `data:`, `file:`, or other schemes the host might dispatch
// unsafely.
const SAFE_URL_RE = /^https?:\/\//i;
function asSuggestedActions(v) {
    if (!Array.isArray(v))
        return [];
    return v
        .map((row) => {
        if (!row || typeof row !== "object")
            return null;
        const r = row;
        const label = asString(r.label).trim();
        const host_prompt = asString(r.host_prompt).trim();
        const rawUrl = asString(r.url).trim();
        const url = rawUrl && SAFE_URL_RE.test(rawUrl) ? rawUrl : "";
        if (!label || (!host_prompt && !url))
            return null;
        return {
            label,
            host_prompt,
            url: url || null,
        };
    })
        .filter((row) => row !== null);
}
export function parseFrontmatter(text) {
    const match = FRONTMATTER_RE.exec(text);
    if (!match) {
        return { frontmatter: { ...FALLBACK_FRONTMATTER }, body: text };
    }
    const yamlBlock = match[1] ?? "";
    const body = match[2] ?? "";
    let raw = {};
    try {
        const parsed = parseYaml(yamlBlock);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            raw = parsed;
        }
    }
    catch {
        // Malformed YAML: fall through with empty raw — caller surfaces a
        // graceful error path instead of throwing.
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
            team_id: asNonEmptyStringOrNull(raw.team_id),
            team_slug: asNonEmptyStringOrNull(raw.team_slug),
            source_team: asNonEmptyStringOrNull(raw.source_team),
            member_relevance_class: asNonEmptyStringOrNull(raw.member_relevance_class),
            relevance_classes: asStringArray(raw.relevance_classes),
            done_by_user_slug: asNonEmptyStringOrNull(raw.done_by_user_slug),
            done_by_user_id: asNonEmptyStringOrNull(raw.done_by_user_id),
            done_at: asNonEmptyStringOrNull(raw.done_at),
        },
        body,
    };
}
// Extract the prose under a top-level body section (e.g. `## Why this
// matters`). Returns the section's plain text up to the next `## ` header,
// or the empty string when the section is absent. Trims leading/trailing
// whitespace.
export function extractSection(body, header) {
    const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^##\\s+${escaped}\\s*$`, "m");
    const match = re.exec(body);
    if (!match)
        return "";
    const start = match.index + match[0].length;
    const after = body.slice(start);
    const nextHeader = /^##\s+/m.exec(after);
    const sliceEnd = nextHeader ? nextHeader.index : after.length;
    return after.slice(0, sliceEnd).trim();
}
/**
 * Parse an action file from a Buffer or string body. Replaces the legacy
 * `parseActionFile(path)` from agntux-core/mcp-server — the caller is now
 * responsible for the fs read (typically `await ctx.fs.readFile(...)`).
 */
export function parseActionFile(content) {
    const text = typeof content === "string" ? content : content.toString("utf8");
    const { frontmatter, body } = parseFrontmatter(text);
    return {
        frontmatter,
        why_matters: extractSection(body, "Why this matters"),
        personalization_fit: extractSection(body, "Personalization fit"),
    };
}
