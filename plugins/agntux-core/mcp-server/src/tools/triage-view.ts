// =============================================================================
// triage_view — render tool for the AgntUX action-item triage MCP App.
//
// Shape rules:
//   - inputSchema has ZERO fields. Server-side caps (DEFAULT_HANDLED_DAYS,
//     DEFAULT_LIMIT) are constants that the LLM never needs to fill in or
//     override. This keeps the tool-call latency low and the argument-token
//     cost effectively zero.
//   - The handler reads from the local AgntUX project root server-side. This
//     is a justified deviation from the canonical "view tools must be
//     stateless / no fs reads" rule because the source data IS local files;
//     there is no third-party MCP for the LLM to call first.
//   - The handler is read-only: zero file writes, zero network. Stateless
//     across calls — same project state in, same payload out.
//   - structuredContent budgets are enforced server-side (max 30 actions
//     per scope, last 7 days handled max 10 per scope, body excerpts ≤600
//     chars). The handler never returns more than these caps, even when the
//     LLM passes larger values.
//
// Returns:
//   On success — { structuredContent: TriagePayload, content: [...], _meta }
//   On graceful error — { structuredContent: { error: 'actions_index_missing' }, ... }
//
// Errors are STRUCTURED (per P2a §4): the tool never throws an exception
// from the happy path, so the host always renders the iframe and the
// component shows the corresponding degraded-state copy.
//
// Team-mode (P3 v2 §1):
//   When `<root>/.agntux/teams.json` exists and lists at least one team
//   or leader-view, the payload gains `schema_version: 2` and three
//   structured sections: `personal`, `teams[]`, `leader_views[]`. The
//   legacy `actions` / `handled_recent` / `counts` / `last_updated_at` /
//   `bootstrap_mode` keys stay populated for backward compatibility
//   with older bundle versions; in team mode those keys carry the
//   personal scope only so an older bundle renders identical-to-solo
//   personal content rather than a confusing mash-up.
//
//   When `teams.json` is absent OR present-but-empty (no memberships
//   AND no leader_views), the payload shape is BYTE-IDENTICAL to the
//   solo release prior to this change: no `schema_version`, no
//   `personal`, no `teams`, no `leader_views` keys. This invariant is
//   enforced by the byte-identical regression test in the suite.
// =============================================================================

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expectedAgntuxRoot } from "../agntux-root.js";
import {
  parseActionFile,
  parseFrontmatter,
  type ActionFrontmatter,
  type SuggestedActionRow,
} from "../parse-action.js";
import { readTriagePrefs, type TriagePrefsV2 } from "./triage-prefs.js";

// ── Constants & caps ─────────────────────────────────────────────────────────

const TRIAGE_RESOURCE_URI = "ui://triage";
const DEFAULT_LIMIT = 30;
const DEFAULT_HANDLED_DAYS = 7;
const MAX_HANDLED_RECENT = 10;
const MAX_RELATED_ENTITIES = 6;
const MAX_SUGGESTED_ACTIONS = 6;
const MAX_SUMMARY_CHARS = 200;
const MAX_TITLE_CHARS = 120;
const MAX_EXCERPT_CHARS = 600;
// Hard ceiling on the number of teams / leader-views the tool scans per
// call. teams.json is authored by the agntux-teams plugin and is expected
// to carry a small handful of entries (the user's team memberships); the
// cap is a defense against a buggy or hostile writer ballooning the
// payload to thousands of sections.
const MAX_TEAMS = 32;
const MAX_LEADER_VIEWS = 32;
// Strict slug pattern (mirrors P3 §"Team identifier" decision). Used to
// guard against path traversal when joining a directory like
// `<root>/teams/{team_slug}/actions/`. Even though teams.json is
// authored by agntux-teams (trusted), the public-plugin gate file
// surface is the one place an attacker could inject; treat it as
// untrusted input.
// Strict slug pattern shared with scope.ts and triage-prefs.ts: 1–64
// chars, lowercase + digits + dashes, must start AND end with [a-z0-9].
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const PRIORITY_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// ── Types ────────────────────────────────────────────────────────────────────

interface TriageActionRow {
  id: string;
  title: string;
  summary: string;
  priority: "high" | "medium" | "low";
  status: "open" | "snoozed";
  reason_class: string;
  due_by: string | null;
  snoozed_until: string | null;
  source: string | null;
  related_entities: string[];
  suggested_actions: SuggestedActionRow[];
  why_matters_excerpt: string;
  personalization_fit_excerpt: string;
  // Created/updated timestamps surfaced so the component can render
  // "Created X ago / Updated Y ago" lines and offer a sort-by-recency option.
  // `created_at` is read from frontmatter; `updated_at` is the file mtime
  // (frontmatter doesn't carry an `updated_at` for actions, so file mtime
  // is the most accurate signal of recency — captures status flips, body
  // appends, suggested-action edits all without coupling to a writer that
  // remembers to bump a field).
  created_at: string | null;
  updated_at: string | null;
  // Optional team-aware fields. Present only for rows read from a team
  // or leader-view scope; omitted (undefined → not serialized) for
  // personal rows so the JSON of a solo-only payload stays byte-identical
  // to the prior release.
  team_slug?: string;
  team_id?: string;
  source_team?: string;
  member_relevance_class?: string;
  // P9 (9.3.0): the row's relevance-class list — used by the UI's
  // strict-intersection filter against the member's onboarding-time
  // picks. Empty array on personal items (filter is a no-op).
  relevance_classes?: string[];
  // Path to the action file relative to the AgntUX root. Lets the UI
  // call the per-path triage-prefs tool without re-deriving paths from
  // (scope_kind, scope_slug, id). Present on every row in team mode;
  // omitted on solo rows so the byte-identical payload contract holds.
  relative_path?: string;
  // Team-wide done attribution (P9). Visible in the UI's "Recently
  // handled" section as "Done by Alice · 2 days ago". Present on team /
  // leader-view rows that have been marked done; absent on open items
  // and on personal items.
  done_by_user_slug?: string;
  done_by_user_id?: string;
  done_at?: string;
}

interface TriageHandledRow {
  id: string;
  title: string;
  priority: "high" | "medium" | "low";
  status: "done" | "dismissed";
  handled_at: string;
  outcome: string | null;
  team_slug?: string;
}

interface TriageCounts {
  open: number;
  snoozed: number;
  handled_recent: number;
  truncated: boolean;
}

interface TriageTeamSection {
  team_slug: string;
  team_id: string | null;
  display_name: string;
  actions: TriageActionRow[];
  handled_recent: TriageHandledRow[];
  // P9: the current member's relevance-class picks from
  // `teams/{slug}/data/members/{self_user_slug}.md`. Used by the UI's
  // strict-intersection filter. Empty array when the user has no picks
  // yet (the UI shows a "Set your relevance picks…" empty state) OR
  // when the public plugin can't determine the self user-slug (no
  // filter applied; defensive default).
  member_relevance_classes?: string[];
}

interface TriageLeaderSection {
  view_slug: string;
  view_id: string | null;
  display_name: string;
  actions: TriageActionRow[];
  handled_recent: TriageHandledRow[];
}

interface TriageStructuredContent {
  actions: TriageActionRow[];
  handled_recent: TriageHandledRow[];
  counts: TriageCounts;
  last_updated_at: string;
  bootstrap_mode: boolean;
  // Team-mode-only fields. These keys are entirely absent from the
  // serialized payload when team mode is inactive — the byte-identical
  // solo guarantee depends on it.
  schema_version?: 2;
  personal?: {
    actions: TriageActionRow[];
    handled_recent: TriageHandledRow[];
  };
  teams?: TriageTeamSection[];
  leader_views?: TriageLeaderSection[];
  // P9 (9.3.0): user-controlled UI state (filter chips, relevance
  // picks, sort, show-done/snoozed/dismissed toggles, per-path snooze
  // and dismiss state). Read server-side from
  // `<root>/.agntux/triage-prefs.json` and passed to the iframe so the
  // component can render filters and apply them without re-fetching.
  // Present only in team mode; absent in solo mode so the
  // byte-identical contract holds.
  triage_prefs?: TriagePrefsV2;
  // P9: the current member's identity, when available. The public
  // plugin reads `self_user_slug` from teams.json (set by the
  // proprietary `agntux-teams` plugin during member onboarding) and
  // surfaces it so the UI can pass it back as `user_slug` on a
  // mark-done call. `null` when the user-slug hasn't been established
  // — mark-done still works but doesn't carry attribution.
  self_user_slug?: string | null;
  self_user_id?: string | null;
}

interface TriageStructuredError {
  error: "actions_index_missing";
}

interface ViewToolMeta {
  ui: {
    resourceUri: typeof TRIAGE_RESOURCE_URI;
  };
  "ui/resourceUri": typeof TRIAGE_RESOURCE_URI;
}

interface ViewToolSuccess {
  structuredContent: TriageStructuredContent;
  content: Array<{ type: "text"; text: string }>;
  _meta: ViewToolMeta;
}

interface ViewToolError {
  structuredContent: TriageStructuredError;
  content: Array<{ type: "text"; text: string }>;
  _meta: ViewToolMeta;
}

type ViewToolResult = ViewToolSuccess | ViewToolError;

// Shape of a single membership / leader-view entry inside teams.json. The
// gate file is owned by the agntux-teams plugin (P3 v2); the public
// plugin reads only the structural fields it needs.
interface TeamsJsonMembership {
  team_slug: string;
  team_id?: string | null;
  display_name?: string | null;
}
interface TeamsJsonLeaderView {
  view_slug: string;
  view_id?: string | null;
  display_name?: string | null;
}
interface ParsedTeamsJson {
  memberships: TeamsJsonMembership[];
  leader_views: TeamsJsonLeaderView[];
  // P9: the user-slug / user-id this machine's user maps to. Read
  // defensively — absent fields stay null and the triage UI falls
  // back to no relevance filter (every team item visible to every
  // member of every team). Owned by agntux-teams during member
  // onboarding.
  self_user_slug: string | null;
  self_user_id: string | null;
}

// Tags added to TriageActionRow / TriageHandledRow rows when they're read
// from a non-personal scope. Threaded through processActionsDir so the
// scope decoration lives in one place.
interface ScopeTag {
  team_slug?: string;
  team_id?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  // Reserve one char for the ellipsis so the returned string never exceeds `max`.
  const slice = s.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + "…";
}

function asPriority(v: string): "high" | "medium" | "low" {
  return v === "high" || v === "medium" || v === "low" ? v : "low";
}

function asActionStatus(v: string): "open" | "snoozed" {
  return v === "snoozed" ? "snoozed" : "open";
}

function asHandledStatus(v: string): "done" | "dismissed" {
  return v === "dismissed" ? "dismissed" : "done";
}

function deriveTitle(fm: ActionFrontmatter, why: string): string {
  // Prefer the parenthetical-stripped reason_detail; fall back to first
  // sentence of why_matters; fall back to the action ID.
  if (fm.reason_detail) {
    const stripped = fm.reason_detail.replace(/^\[[^\]]+\]\s*/, "").trim();
    if (stripped) return truncate(stripped, MAX_TITLE_CHARS);
  }
  if (why) {
    const firstSentence = why.split(/[.!?]\s/, 1)[0] || why;
    return truncate(firstSentence.trim(), MAX_TITLE_CHARS);
  }
  return truncate(fm.id || "untitled", MAX_TITLE_CHARS);
}

function firstParagraph(s: string): string {
  if (!s) return "";
  const idx = s.indexOf("\n\n");
  return (idx >= 0 ? s.slice(0, idx) : s).trim();
}

function listActionFiles(actionsDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(actionsDir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    if (name === "_index.md") continue;
    if (name.startsWith("_")) continue;
    out.push(join(actionsDir, name));
  }
  return out;
}

function indexLastUpdated(actionsDir: string): string {
  // Read frontmatter `updated_at` from _index.md if present; otherwise return
  // the most-recent action file's mtime as ISO. Falls back to "" if neither is
  // available. Never throws. Guards against `_index.md` accidentally being a
  // directory (statSync succeeds on dirs and would return a misleading mtime).
  try {
    const indexPath = join(actionsDir, "_index.md");
    const stat = statSync(indexPath);
    if (!stat.isFile()) return "";
    return new Date(stat.mtimeMs).toISOString();
  } catch {
    return "";
  }
}

// Best-effort read of teams.json. The file may be absent (solo user — the
// common case), unparseable (don't crash), or missing the expected
// top-level arrays (treat as empty). Any of those return an "empty"
// ParsedTeamsJson — the caller decides whether that counts as team mode.
function readTeamsJson(root: string): ParsedTeamsJson | null {
  const path = join(root, ".agntux", "teams.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed JSON: fail open (solo). Authoring is owned by agntux-teams;
    // a corrupt file here means the proprietary plugin is mid-write or
    // something has gone wrong, and we'd rather show the user their
    // personal triage than refuse to render.
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const self_user_slug =
    typeof obj.self_user_slug === "string" && SLUG_RE.test(obj.self_user_slug.trim())
      ? obj.self_user_slug.trim()
      : null;
  const self_user_id =
    typeof obj.self_user_id === "string" && obj.self_user_id.trim().length > 0
      ? obj.self_user_id.trim()
      : null;

  const memberships: TeamsJsonMembership[] = [];
  if (Array.isArray(obj.memberships)) {
    for (const m of obj.memberships) {
      if (!m || typeof m !== "object" || Array.isArray(m)) continue;
      const r = m as Record<string, unknown>;
      const team_slug = typeof r.team_slug === "string" ? r.team_slug.trim() : "";
      if (!team_slug || !SLUG_RE.test(team_slug)) continue;
      memberships.push({
        team_slug,
        team_id: typeof r.team_id === "string" ? r.team_id : null,
        display_name:
          typeof r.display_name === "string" && r.display_name.trim().length > 0
            ? r.display_name.trim()
            : null,
      });
      if (memberships.length >= MAX_TEAMS) break;
    }
  }

  const leader_views: TeamsJsonLeaderView[] = [];
  if (Array.isArray(obj.leader_views)) {
    for (const v of obj.leader_views) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const r = v as Record<string, unknown>;
      const view_slug = typeof r.view_slug === "string" ? r.view_slug.trim() : "";
      if (!view_slug || !SLUG_RE.test(view_slug)) continue;
      leader_views.push({
        view_slug,
        view_id: typeof r.view_id === "string" ? r.view_id : null,
        display_name:
          typeof r.display_name === "string" && r.display_name.trim().length > 0
            ? r.display_name.trim()
            : null,
      });
      if (leader_views.length >= MAX_LEADER_VIEWS) break;
    }
  }

  return { memberships, leader_views, self_user_slug, self_user_id };
}

// Read a team-member file at `<root>/teams/{slug}/data/members/{user_slug}.md`
// and return the member's `relevance_classes[]` from frontmatter. Returns
// the empty array when the file is absent, unreadable, or carries no
// classes — the triage UI treats an empty array as "no filter set" and
// shows a help-text empty state per P9 §"Empty / wait states".
//
// Failures are silent: the public plugin doesn't own the member-file
// schema (agntux-teams does), so an unknown / partially-written file
// can't surface as a render error. Defensive parse, defensive return.
function readMemberRelevanceClasses(
  root: string,
  team_slug: string,
  user_slug: string,
): string[] {
  if (!SLUG_RE.test(team_slug) || !SLUG_RE.test(user_slug)) return [];
  const path = join(
    root,
    "teams",
    team_slug,
    "data",
    "members",
    `${user_slug}.md`,
  );
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  // We only need frontmatter; reuse the action parser since it tolerates
  // missing fields and returns a normalized shape. The member-file
  // schema is owned by agntux-teams; we read defensively. The
  // `relevance_classes` array field is shared across action files and
  // member files (both promote the same slug list).
  let classes: string[];
  try {
    classes = parseFrontmatter(raw).frontmatter.relevance_classes;
  } catch {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of classes) {
    const trimmed = c.trim();
    if (!trimmed || !SLUG_RE.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= 64) break;
  }
  return out;
}

// Process all .md files in an actions/ directory and return open + handled
// rows plus a snoozed count. Shared by the personal scan and every
// team/leader-view scan. `scope` decorates each row with team_slug /
// team_id when reading from a non-personal directory; pass null for the
// personal scan to keep the row JSON byte-identical to the prior release.
// `relativePathPrefix` is the path of the actions directory relative to
// the AgntUX root (e.g. `actions`, `teams/platform/actions`); when set,
// rows gain a `relative_path` of `<prefix>/<basename>` so the UI can
// call the per-path triage-prefs tool without re-deriving the path. Pass
// `null` to omit `relative_path` from every row (the solo-mode personal
// scan does this so the JSON stays byte-identical to 9.0.0).
function processActionsDir(
  actionsDir: string,
  handledCutoffMs: number,
  scope: ScopeTag | null,
  relativePathPrefix: string | null,
): { open: TriageActionRow[]; handled: TriageHandledRow[]; snoozedCount: number } {
  const files = listActionFiles(actionsDir);
  const open: TriageActionRow[] = [];
  const handled: TriageHandledRow[] = [];
  let snoozedCount = 0;

  for (const filePath of files) {
    let parsed;
    let fileMtime: string | null = null;
    try {
      parsed = parseActionFile(filePath);
      try {
        fileMtime = new Date(statSync(filePath).mtimeMs).toISOString();
      } catch {
        fileMtime = null;
      }
    } catch {
      // Skip malformed files; never crash the whole render.
      continue;
    }
    const fm = parsed.frontmatter;
    if (!fm.id) continue;
    // Use the filename (not fm.id) so a malicious frontmatter `id` field
    // can't redirect the prefs tool to a different file. `listActionFiles`
    // only returns *.md entries, so the slice is safe.
    const basename = filePath.split("/").pop() ?? `${fm.id}.md`;
    const relativePath = relativePathPrefix
      ? `${relativePathPrefix}/${basename}`
      : null;

    if (fm.status === "open" || fm.status === "snoozed") {
      if (fm.status === "snoozed") snoozedCount++;
      const why = parsed.why_matters;
      const fitRaw = parsed.personalization_fit;
      const row: TriageActionRow = {
        id: fm.id,
        title: deriveTitle(fm, why),
        summary: truncate(firstParagraph(why), MAX_SUMMARY_CHARS),
        priority: asPriority(fm.priority),
        status: asActionStatus(fm.status),
        reason_class: fm.reason_class || "",
        due_by: fm.due_by || null,
        snoozed_until: fm.snoozed_until || null,
        source: fm.source || null,
        related_entities: fm.related_entities.slice(0, MAX_RELATED_ENTITIES),
        suggested_actions: fm.suggested_actions.slice(
          0,
          MAX_SUGGESTED_ACTIONS,
        ),
        why_matters_excerpt: truncate(why, MAX_EXCERPT_CHARS),
        personalization_fit_excerpt: truncate(fitRaw, MAX_EXCERPT_CHARS),
        created_at: fm.created_at || null,
        updated_at: fileMtime,
      };
      // Optional team-aware fields are added only when this is a
      // non-personal scope OR the file's own frontmatter carries them.
      // Frontmatter wins over scope-inferred values so an action lifted
      // by agntux-teams from a different source team retains its
      // `source_team` distinction.
      decorateRow(row, fm, scope);
      if (relativePath) row.relative_path = relativePath;
      // P9: copy the action's relevance_classes when present. Done in
      // decorateRow's adjacent scope so the solo byte-identical contract
      // still holds — personal rows with no frontmatter classes don't
      // gain the field.
      if (fm.relevance_classes.length > 0) {
        row.relevance_classes = fm.relevance_classes.slice(0, 32);
      }
      open.push(row);
      continue;
    }
    if (fm.status === "done" || fm.status === "dismissed") {
      // `done_at` is the team-wide field (P9); `completed_at` is the
      // personal field. Prefer `done_at` when both are set so the UI's
      // "Recently handled" timestamp reflects when the team-wide mark
      // happened, not when the original author's local clock said so.
      const handledAt =
        fm.status === "done"
          ? fm.done_at || fm.completed_at
          : fm.dismissed_at;
      if (!handledAt) continue;
      const t = new Date(handledAt).getTime();
      if (!Number.isFinite(t) || t < handledCutoffMs) continue;
      const hrow: TriageHandledRow = {
        id: fm.id,
        title: deriveTitle(fm, parsed.why_matters),
        priority: asPriority(fm.priority),
        status: asHandledStatus(fm.status),
        handled_at: handledAt,
        outcome: null, // outcome history lives in body; v1 omits.
      };
      if (scope?.team_slug) hrow.team_slug = scope.team_slug;
      handled.push(hrow);
    }
  }

  return { open, handled, snoozedCount };
}

function decorateRow(
  row: TriageActionRow,
  fm: ActionFrontmatter,
  scope: ScopeTag | null,
): void {
  // Personal scope + no team frontmatter ⇒ leave the row untouched. This
  // is the byte-identical solo path; even adding `team_slug: undefined`
  // would risk JSON-stringify drift if a future change set it explicitly.
  if (
    !scope &&
    !fm.team_slug &&
    !fm.team_id &&
    !fm.source_team &&
    !fm.member_relevance_class &&
    !fm.done_by_user_slug &&
    !fm.done_by_user_id &&
    !fm.done_at
  ) {
    return;
  }
  const team_slug = fm.team_slug ?? scope?.team_slug ?? undefined;
  if (team_slug) row.team_slug = team_slug;
  const team_id = fm.team_id ?? scope?.team_id ?? undefined;
  if (team_id) row.team_id = team_id;
  if (fm.source_team) row.source_team = fm.source_team;
  if (fm.member_relevance_class) row.member_relevance_class = fm.member_relevance_class;
  // P9 team-wide mark-done attribution. Surfaced even on open rows when
  // a previous done-then-reopen left the fields set (the set-status
  // tool clears them on re-open, but a hand-edited file might not).
  if (fm.done_by_user_slug) row.done_by_user_slug = fm.done_by_user_slug;
  if (fm.done_by_user_id) row.done_by_user_id = fm.done_by_user_id;
  if (fm.done_at) row.done_at = fm.done_at;
}

function sortOpen(open: TriageActionRow[]): void {
  open.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 99;
    const pb = PRIORITY_RANK[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return (a.due_by ?? "z").localeCompare(b.due_by ?? "z");
  });
}

function sortHandled(handled: TriageHandledRow[]): void {
  handled.sort((a, b) =>
    a.handled_at < b.handled_at ? 1 : a.handled_at > b.handled_at ? -1 : 0,
  );
}

// ── Tool descriptor ──────────────────────────────────────────────────────────

export const triageViewTool = {
  name: "agntux_core_triage_view",
  description:
    "Render the AgntUX triage UI populated with priority-sorted open " +
    "action items and the most recently-handled items. Reads the local " +
    "AgntUX knowledge store server-side. Zero arguments — call with `{}`. " +
    "Use when the user types `/agntux triage-digest`, or asks any of: 'show " +
    "triage' / 'what's hot' / 'what should I look at' / 'what's on my " +
    "plate' / 'triage me' / 'show me my action items' / 'what should I " +
    "do today' / 'what do I need to handle'. Returns _meta.ui.resourceUri " +
    "= ui://triage.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
  // outputSchema is what tells the host "this tool returns structuredContent
  // that should be passed to the iframe as toolOutput, not surfaced to the
  // model as chat text." Without it, Claude Cowork (and per the upstream
  // app project's c023186 fix, ChatGPT) silently text-render the
  // structuredContent — the iframe never opens. Mirrors the official
  // ext-apps `scenario-modeler-server` example, which declares both
  // `_meta.ui.resourceUri` and `outputSchema` for the same combination of
  // structuredContent + iframe. No `required` fields: both the success
  // payload and the structured-error envelope (`{error: ...}`) need to
  // validate, and in team mode additional keys (`personal`, `teams`,
  // `leader_views`, `schema_version`) join the success shape.
  outputSchema: {
    type: "object" as const,
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            priority: { type: "string" },
            status: { type: "string" },
            reason_class: { type: "string" },
            due_by: {},
            snoozed_until: {},
            source: {},
            related_entities: { type: "array", items: { type: "string" } },
            suggested_actions: { type: "array" },
            why_matters_excerpt: { type: "string" },
            personalization_fit_excerpt: { type: "string" },
            created_at: {},
            updated_at: {},
            team_slug: { type: "string" },
            team_id: { type: "string" },
            source_team: { type: "string" },
            member_relevance_class: { type: "string" },
            relevance_classes: { type: "array", items: { type: "string" } },
            relative_path: { type: "string" },
            done_by_user_slug: { type: "string" },
            done_by_user_id: { type: "string" },
            done_at: { type: "string" },
          },
        },
      },
      handled_recent: { type: "array" },
      counts: {
        type: "object",
        properties: {
          open: { type: "number" },
          snoozed: { type: "number" },
          handled_recent: { type: "number" },
          truncated: { type: "boolean" },
        },
      },
      last_updated_at: { type: "string" },
      bootstrap_mode: { type: "boolean" },
      error: { type: "string" },
      schema_version: { type: "number" },
      personal: { type: "object" },
      teams: { type: "array" },
      leader_views: { type: "array" },
      triage_prefs: { type: "object" },
      self_user_slug: { type: "string" },
      self_user_id: { type: "string" },
    },
  },
  // The MCP Apps spec defines two synonymous keys for declaring a tool's
  // associated UI resource: the modern nested `_meta.ui.resourceUri` and the
  // legacy flat `_meta["ui/resourceUri"]`. The official `registerAppTool`
  // helper in @modelcontextprotocol/ext-apps emits both, so we do too —
  // defensive against any host that only reads one of them.
  _meta: {
    ui: {
      resourceUri: TRIAGE_RESOURCE_URI,
    },
    "ui/resourceUri": TRIAGE_RESOURCE_URI,
  },
} as const;

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleTriageView(
  _args: Record<string, unknown>,
): Promise<ViewToolResult> {
  const handledDays = DEFAULT_HANDLED_DAYS;
  const limit = DEFAULT_LIMIT;
  const handledCutoffMs = Date.now() - handledDays * 86_400_000;

  const root = expectedAgntuxRoot();
  const personalActionsDir = join(root, "actions");
  const teamsJson = readTeamsJson(root);
  const teamModeActive =
    !!teamsJson &&
    (teamsJson.memberships.length > 0 || teamsJson.leader_views.length > 0);

  // The `actions_index_missing` error path preserves the prior contract
  // exactly: solo users without a personal actions/ directory see the
  // onboarding pointer. In team mode a missing personal directory is no
  // longer a hard error — the team and leader sections may still have
  // useful content. We surface it as an empty personal scope instead.
  let personalDirOk = true;
  try {
    const dirStat = statSync(personalActionsDir);
    if (!dirStat.isDirectory()) personalDirOk = false;
  } catch {
    personalDirOk = false;
  }
  if (!personalDirOk && !teamModeActive) {
    return structuredError(
      "actions_index_missing",
      `triage_view: ${personalActionsDir} does not exist.`,
    );
  }

  // Personal scope. The relative-path prefix is omitted in solo mode
  // (no team mode) so the byte-identical-to-9.0.0 contract holds —
  // rows never carry `relative_path`. In team mode the personal scan
  // gets `actions` as its prefix so the per-path prefs tool can target
  // personal items too.
  const personalScan = personalDirOk
    ? processActionsDir(
        personalActionsDir,
        handledCutoffMs,
        null,
        teamModeActive ? "actions" : null,
      )
    : { open: [], handled: [], snoozedCount: 0 };
  sortOpen(personalScan.open);
  sortHandled(personalScan.handled);
  const personalTruncated = personalScan.open.length > limit;
  const personalActionsCapped = personalTruncated
    ? personalScan.open.slice(0, limit)
    : personalScan.open;
  const personalHandledCapped = personalScan.handled.slice(0, MAX_HANDLED_RECENT);

  // Track aggregate counts + the global truncation flag across every
  // scope. counts.open is "all open across all visible scopes" so the
  // UI's badge reflects the user's real queue size when team mode is
  // active.
  let aggregateOpenCount = personalScan.open.filter(
    (a) => a.status === "open",
  ).length;
  let aggregateSnoozedCount = personalScan.snoozedCount;
  let aggregateHandledCount = personalHandledCapped.length;
  let aggregateTruncated = personalTruncated;

  // Solo branch: short-circuit. The payload below is BYTE-IDENTICAL to
  // the prior release — no schema_version, no personal/teams/leader_views
  // keys. Tested by the byte-identical regression in the suite.
  if (!teamModeActive) {
    const lastUpdatedAt =
      indexLastUpdated(personalActionsDir) || new Date().toISOString();
    const bootstrapMode =
      personalScan.open.length === 0 && personalScan.handled.length === 0;
    const payload: TriageStructuredContent = {
      actions: personalActionsCapped,
      handled_recent: personalHandledCapped,
      counts: {
        open: aggregateOpenCount,
        snoozed: aggregateSnoozedCount,
        handled_recent: aggregateHandledCount,
        truncated: aggregateTruncated,
      },
      last_updated_at: lastUpdatedAt,
      bootstrap_mode: bootstrapMode,
    };
    return {
      structuredContent: payload,
      content: [
        {
          type: "text",
          text: bootstrapMode
            ? "Triage rendered. No items yet — bootstrap mode."
            : `Triage rendered. ${personalActionsCapped.length} open, ${personalHandledCapped.length} recently handled.`,
        },
      ],
      _meta: {
        ui: {
          resourceUri: TRIAGE_RESOURCE_URI,
        },
        "ui/resourceUri": TRIAGE_RESOURCE_URI,
      },
    };
  }

  // Team-mode branch.
  const selfUserSlug = teamsJson!.self_user_slug;
  const teamSections: TriageTeamSection[] = [];
  for (const m of teamsJson!.memberships) {
    const teamActionsDir = join(root, "teams", m.team_slug, "actions");
    const scan = processActionsDir(
      teamActionsDir,
      handledCutoffMs,
      { team_slug: m.team_slug, team_id: m.team_id ?? null },
      `teams/${m.team_slug}/actions`,
    );
    sortOpen(scan.open);
    sortHandled(scan.handled);
    const truncated = scan.open.length > limit;
    if (truncated) aggregateTruncated = true;
    const actionsCapped = truncated ? scan.open.slice(0, limit) : scan.open;
    const handledCapped = scan.handled.slice(0, MAX_HANDLED_RECENT);
    aggregateOpenCount += scan.open.filter((a) => a.status === "open").length;
    aggregateSnoozedCount += scan.snoozedCount;
    aggregateHandledCount += handledCapped.length;
    // P9: member relevance picks for this team. Empty when the user
    // hasn't onboarded as a member of this team yet — the UI shows the
    // "Set your relevance picks for {Team}" empty state.
    const memberRelevanceClasses = selfUserSlug
      ? readMemberRelevanceClasses(root, m.team_slug, selfUserSlug)
      : [];
    teamSections.push({
      team_slug: m.team_slug,
      team_id: m.team_id ?? null,
      display_name: m.display_name ?? m.team_slug,
      actions: actionsCapped,
      handled_recent: handledCapped,
      member_relevance_classes: memberRelevanceClasses,
    });
  }

  // Leader views: prefer the explicit list in teams.json (it carries
  // display names); fall back to directory scan for any leftover dirs
  // the user has but didn't register in teams.json. Per P3 v2 §1, we
  // also "Read /leader-views/ if present" — so unregistered views still
  // surface, just without a friendly display name.
  const leaderSections: TriageLeaderSection[] = [];
  const seenViewSlugs = new Set<string>();
  for (const v of teamsJson!.leader_views) {
    const scan = readLeaderViewScope(root, v.view_slug, handledCutoffMs);
    if (scan === null) continue;
    if (scan.truncated) aggregateTruncated = true;
    aggregateOpenCount += scan.openTotal;
    aggregateSnoozedCount += scan.snoozedCount;
    aggregateHandledCount += scan.handledCapped.length;
    leaderSections.push({
      view_slug: v.view_slug,
      view_id: v.view_id ?? null,
      display_name: v.display_name ?? v.view_slug,
      actions: scan.actionsCapped,
      handled_recent: scan.handledCapped,
    });
    seenViewSlugs.add(v.view_slug);
  }
  // Directory-scan fallback for any leader-view dirs not listed in
  // teams.json. Caps at MAX_LEADER_VIEWS total combined.
  //
  // Sort the entries before iterating so the *which dirs we keep* decision
  // (when total > MAX_LEADER_VIEWS) is deterministic across filesystems —
  // `readdirSync` order is unspecified (inode order on ext4 / HFS+,
  // alphabetical on btrfs / APFS), and unrelated runs over the same data
  // shouldn't surface different views.
  if (leaderSections.length < MAX_LEADER_VIEWS) {
    const leaderViewsRoot = join(root, "leader-views");
    let dirEntries: string[];
    try {
      dirEntries = readdirSync(leaderViewsRoot).slice().sort();
    } catch {
      dirEntries = [];
    }
    for (const name of dirEntries) {
      if (leaderSections.length >= MAX_LEADER_VIEWS) break;
      if (!SLUG_RE.test(name)) continue;
      if (seenViewSlugs.has(name)) continue;
      const scan = readLeaderViewScope(root, name, handledCutoffMs);
      if (scan === null) continue;
      if (scan.truncated) aggregateTruncated = true;
      aggregateOpenCount += scan.openTotal;
      aggregateSnoozedCount += scan.snoozedCount;
      aggregateHandledCount += scan.handledCapped.length;
      leaderSections.push({
        view_slug: name,
        view_id: null,
        display_name: name,
        actions: scan.actionsCapped,
        handled_recent: scan.handledCapped,
      });
    }
  }

  // last_updated_at picks the most-recent _index.md mtime across every
  // scope so the UI's "Updated X ago" line reflects the actual freshest
  // signal in the user's data, not just the personal index. Falls back
  // to now() when no _index.md exists anywhere.
  const lastUpdatedAt =
    pickLatestIso(
      indexLastUpdated(personalActionsDir),
      ...teamsJson!.memberships.map((m) =>
        indexLastUpdated(join(root, "teams", m.team_slug, "actions")),
      ),
      ...leaderSections.map((s) =>
        indexLastUpdated(join(root, "leader-views", s.view_slug, "actions")),
      ),
    ) || new Date().toISOString();

  // bootstrap_mode is true iff every scope is empty.
  const anyContent =
    personalScan.open.length > 0 ||
    personalScan.handled.length > 0 ||
    teamSections.some(
      (t) => t.actions.length > 0 || t.handled_recent.length > 0,
    ) ||
    leaderSections.some(
      (v) => v.actions.length > 0 || v.handled_recent.length > 0,
    );
  const bootstrapMode = !anyContent;

  // P9: read the user's filter / sort / per-path snooze+dismiss state
  // server-side. The UI applies the filters; the server doesn't filter
  // rows by relevance picks (the UI can toggle the chips at runtime
  // without round-tripping). triage-prefs.json is read defensively —
  // an absent / malformed file returns the v2 default shape.
  const triagePrefs = readTriagePrefs();

  const payload: TriageStructuredContent = {
    // Legacy keys: personal scope only, so an older bundle that doesn't
    // know about teams still renders a sensible personal-only view.
    actions: personalActionsCapped,
    handled_recent: personalHandledCapped,
    counts: {
      open: aggregateOpenCount,
      snoozed: aggregateSnoozedCount,
      handled_recent: aggregateHandledCount,
      truncated: aggregateTruncated,
    },
    last_updated_at: lastUpdatedAt,
    bootstrap_mode: bootstrapMode,
    // Team-mode keys.
    schema_version: 2,
    personal: {
      actions: personalActionsCapped,
      handled_recent: personalHandledCapped,
    },
    teams: teamSections,
    leader_views: leaderSections,
    triage_prefs: triagePrefs,
    self_user_slug: teamsJson!.self_user_slug,
    self_user_id: teamsJson!.self_user_id,
  };

  const summaryLines: string[] = [
    `${personalActionsCapped.length} personal`,
  ];
  if (teamSections.length > 0) {
    const teamOpen = teamSections.reduce((n, t) => n + t.actions.length, 0);
    summaryLines.push(`${teamOpen} across ${teamSections.length} team(s)`);
  }
  if (leaderSections.length > 0) {
    const leaderOpen = leaderSections.reduce(
      (n, v) => n + v.actions.length,
      0,
    );
    summaryLines.push(`${leaderOpen} across ${leaderSections.length} leader view(s)`);
  }
  return {
    structuredContent: payload,
    content: [
      {
        type: "text",
        text: bootstrapMode
          ? "Triage rendered (team mode). No items yet — bootstrap mode."
          : `Triage rendered (team mode). ${summaryLines.join(", ")}.`,
      },
    ],
    _meta: {
      ui: {
        resourceUri: TRIAGE_RESOURCE_URI,
      },
      "ui/resourceUri": TRIAGE_RESOURCE_URI,
    },
  };
}

function readLeaderViewScope(
  root: string,
  view_slug: string,
  handledCutoffMs: number,
): {
  actionsCapped: TriageActionRow[];
  handledCapped: TriageHandledRow[];
  truncated: boolean;
  openTotal: number;
  snoozedCount: number;
} | null {
  if (!SLUG_RE.test(view_slug)) return null;
  const dir = join(root, "leader-views", view_slug, "actions");
  let dirStat: ReturnType<typeof statSync>;
  try {
    dirStat = statSync(dir);
  } catch {
    return null;
  }
  if (!dirStat.isDirectory()) return null;
  // Leader-view rows are not team-scoped (`team_slug` stays absent on
  // these rows). The view-slug shows up in the section header instead.
  const scan = processActionsDir(
    dir,
    handledCutoffMs,
    null,
    `leader-views/${view_slug}/actions`,
  );
  sortOpen(scan.open);
  sortHandled(scan.handled);
  const truncated = scan.open.length > DEFAULT_LIMIT;
  const actionsCapped = truncated
    ? scan.open.slice(0, DEFAULT_LIMIT)
    : scan.open;
  const handledCapped = scan.handled.slice(0, MAX_HANDLED_RECENT);
  return {
    actionsCapped,
    handledCapped,
    truncated,
    openTotal: scan.open.filter((a) => a.status === "open").length,
    snoozedCount: scan.snoozedCount,
  };
}

function pickLatestIso(...candidates: string[]): string {
  let best = "";
  let bestT = -Infinity;
  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (!Number.isFinite(t)) continue;
    if (t > bestT) {
      bestT = t;
      best = c;
    }
  }
  return best;
}

function structuredError(
  kind: "actions_index_missing",
  message: string,
): ViewToolError {
  return {
    structuredContent: { error: kind },
    content: [{ type: "text", text: message }],
    _meta: {
      ui: {
        resourceUri: TRIAGE_RESOURCE_URI,
      },
      "ui/resourceUri": TRIAGE_RESOURCE_URI,
    },
  };
}
