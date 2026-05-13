// =============================================================================
// parse-action — read an action item file and surface the fields the triage
// view tool needs. Stateless, read-only; never writes to disk.
//
// Frontmatter is parsed via the `yaml` package; body sections (`## Why this
// matters`, `## Personalization fit`) are extracted by header lookup.
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
    team_id: null,
    team_slug: null,
    source_team: null,
    member_relevance_class: null,
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
// Only http(s) URLs are accepted by the openLink dispatcher. This is the trust
// boundary that catches buggy or hostile ingest plugins emitting `javascript:`,
// `data:`, `file:`, or other schemes the host might dispatch unsafely.
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
        // Drop any url that isn't an http(s) URL. Treat a rejected url as if
        // the field were absent — the row is kept iff host_prompt fills in.
        const url = rawUrl && SAFE_URL_RE.test(rawUrl) ? rawUrl : "";
        // A row needs a label and at least one of host_prompt or url. The two
        // are dispatch alternatives: url -> openLink (host primitive), host_prompt
        // -> sendFollowUpMessage (chat-mediated). When both are present, the
        // triage UI prefers url; host_prompt is kept as a chat-fallback for older
        // hosts that don't expose openLink.
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
            team_id: asNonEmptyStringOrNull(raw.team_id),
            team_slug: asNonEmptyStringOrNull(raw.team_slug),
            source_team: asNonEmptyStringOrNull(raw.source_team),
            member_relevance_class: asNonEmptyStringOrNull(raw.member_relevance_class),
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
export function parseActionFile(filePath) {
    const text = readFileSync(filePath, "utf8");
    const { frontmatter, body } = parseFrontmatter(text);
    return {
        frontmatter,
        why_matters: extractSection(body, "Why this matters"),
        personalization_fit: extractSection(body, "Personalization fit"),
    };
}
