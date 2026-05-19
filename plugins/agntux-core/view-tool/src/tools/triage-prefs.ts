// Triage UI filter-state persistence — `agntux_core_save_triage_prefs`
// (whole-object patch) and `agntux_core_set_triage_pref` (per-path patch).
//
// Ported from `mcp-server/src/tools/triage-prefs.ts`. The on-disk file lives
// at `.agntux/triage-prefs.json` relative to the agntux project root; on the
// remote side that's the same key in S3 (after dropping it from
// EXCLUDED_PATH_PREFIXES). Read-modify-write happens via `ctx.fs.update()`
// so concurrent toggles from two devices get clean CAS retries.

import type {
  MutationTool,
  ViewToolContext,
} from "@agntux/plugin-runtime";

const PREFS_PATH = ".agntux/triage-prefs.json";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_MUTED_SLUGS = 256;
const MAX_TRIAGE_STATE_ENTRIES = 4096;
const TRIAGE_STATE_PATH_RE =
  /^(actions|teams\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\/actions|leader-views\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\/actions)\/[^/\\\0]{1,200}\.md$/;

const VALID_SORTS = new Set([
  "priority",
  "due",
  "created",
  "team-then-priority",
  "due-then-priority",
]);
const VALID_FILTER_STATES = new Set(["shown", "hidden"]);

const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

interface TriagePrefsV2 {
  schema_version: 2;
  muted_team_slugs: string[];
  muted_view_slugs: string[];
  team_filters: Record<string, "shown" | "hidden">;
  view_filters: Record<string, "shown" | "hidden">;
  relevance_class_filters: Record<string, string[]>;
  sort: string;
  show_done: boolean;
  show_snoozed: boolean;
  show_dismissed: boolean;
  triage_state: Record<
    string,
    { snoozed_until: string | null; dismissed_at: string | null }
  >;
}

function emptyPrefs(): TriagePrefsV2 {
  return {
    schema_version: 2,
    muted_team_slugs: [],
    muted_view_slugs: [],
    team_filters: {},
    view_filters: {},
    relevance_class_filters: {},
    sort: "priority",
    show_done: false,
    show_snoozed: false,
    show_dismissed: false,
    triage_state: {},
  };
}

function sanitizeSlugList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t || !SLUG_RE.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_MUTED_SLUGS) break;
  }
  return out;
}

function sanitizeFilterMap(raw: unknown): Record<string, "shown" | "hidden"> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, "shown" | "hidden"> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !SLUG_RE.test(k)) continue;
    if (typeof v !== "string" || !VALID_FILTER_STATES.has(v)) continue;
    out[k] = v as "shown" | "hidden";
    count++;
    if (count >= MAX_MUTED_SLUGS) break;
  }
  return out;
}

function sanitizeRelevanceClassFilters(
  raw: unknown,
): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !SLUG_RE.test(k)) continue;
    out[k] = sanitizeSlugList(v);
    count++;
    if (count >= MAX_MUTED_SLUGS) break;
  }
  return out;
}

function sanitizeIsoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (t.length > 64) return null;
  if (!ISO_TIMESTAMP_RE.test(t)) return null;
  if (!Number.isFinite(Date.parse(t))) return null;
  return t;
}

function isValidTriageStatePath(p: unknown): p is string {
  if (typeof p !== "string") return false;
  if (p.length === 0 || p.length > 512) return false;
  if (p.includes("..")) return false;
  return TRIAGE_STATE_PATH_RE.test(p);
}

function sanitizeTriageState(
  raw: unknown,
): Record<string, { snoozed_until: string | null; dismissed_at: string | null }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<
    string,
    { snoozed_until: string | null; dismissed_at: string | null }
  > = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidTriageStatePath(k)) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const entry = v as Record<string, unknown>;
    out[k] = {
      snoozed_until: sanitizeIsoOrNull(entry.snoozed_until),
      dismissed_at: sanitizeIsoOrNull(entry.dismissed_at),
    };
    count++;
    if (count >= MAX_TRIAGE_STATE_ENTRIES) break;
  }
  return out;
}

/**
 * Parse the on-disk prefs file. Returns the v2 default shape when the
 * file is absent, unreadable, malformed, or carries a v1 shape. v1
 * files migrate their `muted_team_slugs` / `muted_view_slugs` into the
 * v2 filter maps as `'hidden'` entries.
 */
function parsePrefs(raw: string | null): TriagePrefsV2 {
  if (raw === null) return emptyPrefs();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyPrefs();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyPrefs();
  }
  const obj = parsed as Record<string, unknown>;

  const muted_team_slugs = sanitizeSlugList(obj.muted_team_slugs);
  const muted_view_slugs = sanitizeSlugList(obj.muted_view_slugs);

  const team_filters = sanitizeFilterMap(obj.team_filters);
  const view_filters = sanitizeFilterMap(obj.view_filters);
  for (const slug of muted_team_slugs) {
    if (team_filters[slug] === undefined) team_filters[slug] = "hidden";
  }
  for (const slug of muted_view_slugs) {
    if (view_filters[slug] === undefined) view_filters[slug] = "hidden";
  }

  const sort =
    typeof obj.sort === "string" && VALID_SORTS.has(obj.sort)
      ? obj.sort
      : "priority";

  return {
    schema_version: 2,
    muted_team_slugs,
    muted_view_slugs,
    team_filters,
    view_filters,
    relevance_class_filters: sanitizeRelevanceClassFilters(
      obj.relevance_class_filters,
    ),
    sort,
    show_done: obj.show_done === true,
    show_snoozed: obj.show_snoozed === true,
    show_dismissed: obj.show_dismissed === true,
    triage_state: sanitizeTriageState(obj.triage_state),
  };
}

/** Serialise prefs back to JSON with the legacy `muted_*` arrays kept in sync. */
function serialisePrefs(prefs: TriagePrefsV2): string {
  const muted_team_slugs: string[] = [];
  for (const [slug, state] of Object.entries(prefs.team_filters)) {
    if (state === "hidden") muted_team_slugs.push(slug);
  }
  const muted_view_slugs: string[] = [];
  for (const [slug, state] of Object.entries(prefs.view_filters)) {
    if (state === "hidden") muted_view_slugs.push(slug);
  }
  const out = { ...prefs, muted_team_slugs, muted_view_slugs };
  return JSON.stringify(out, null, 2) + "\n";
}

// ── save_triage_prefs ────────────────────────────────────────────────────────

interface SavePrefsArgs {
  muted_team_slugs?: string[];
  muted_view_slugs?: string[];
  team_filters?: Record<string, "shown" | "hidden">;
  view_filters?: Record<string, "shown" | "hidden">;
  relevance_class_filters?: Record<string, string[]>;
  sort?: string;
  show_done?: boolean;
  show_snoozed?: boolean;
  show_dismissed?: boolean;
}

export const savePrefsTool: MutationTool<SavePrefsArgs> = {
  descriptor: {
    name: "agntux_core_save_triage_prefs",
    description:
      "Persist the triage UI's filter state to `.agntux/triage-prefs.json`. Called by the triage MCP App when the user toggles a team filter chip, a relevance-class chip, or a show-done/snoozed/dismissed toggle; not user-facing. MERGES patch fields into the existing file — callers may patch a single field without re-sending the whole state.",
    inputSchema: {
      type: "object",
      properties: {
        muted_team_slugs: {
          type: "array",
          items: { type: "string" },
          description:
            "Legacy v1 field — flat array of team slugs the user has hidden. Translated to `team_filters[slug] = 'hidden'` on write.",
        },
        muted_view_slugs: {
          type: "array",
          items: { type: "string" },
          description:
            "Legacy v1 field — flat array of view slugs the user has hidden. Translated to `view_filters[slug] = 'hidden'` on write.",
        },
        team_filters: {
          type: "object",
          description:
            "Map of team-slug → 'shown' | 'hidden'. Patches the existing map.",
        },
        view_filters: {
          type: "object",
          description:
            "Map of view-slug → 'shown' | 'hidden'. Patches the existing map.",
        },
        relevance_class_filters: {
          type: "object",
          description:
            "Map of team-slug → array of selected relevance-class slugs.",
        },
        sort: {
          type: "string",
          description:
            "Sort key. One of: priority, due, created, team-then-priority, due-then-priority.",
        },
        show_done: { type: "boolean" },
        show_snoozed: { type: "boolean" },
        show_dismissed: { type: "boolean" },
      },
      required: [],
      additionalProperties: false,
    },
  },
  async handle(args, ctx: ViewToolContext) {
    await ctx.fs.update(PREFS_PATH, (current) => {
      const prefs = parsePrefs(current);
      const next: TriagePrefsV2 = {
        ...prefs,
        team_filters: { ...prefs.team_filters },
        view_filters: { ...prefs.view_filters },
        relevance_class_filters: { ...prefs.relevance_class_filters },
        triage_state: { ...prefs.triage_state },
      };

      if (args.muted_team_slugs !== undefined) {
        const muted = sanitizeSlugList(args.muted_team_slugs);
        const filters: Record<string, "shown" | "hidden"> = {};
        for (const slug of muted) filters[slug] = "hidden";
        for (const [slug, state] of Object.entries(next.team_filters)) {
          if (state === "shown" && filters[slug] === undefined)
            filters[slug] = "shown";
        }
        next.team_filters = filters;
      }
      if (args.muted_view_slugs !== undefined) {
        const muted = sanitizeSlugList(args.muted_view_slugs);
        const filters: Record<string, "shown" | "hidden"> = {};
        for (const slug of muted) filters[slug] = "hidden";
        for (const [slug, state] of Object.entries(next.view_filters)) {
          if (state === "shown" && filters[slug] === undefined)
            filters[slug] = "shown";
        }
        next.view_filters = filters;
      }
      if (args.team_filters !== undefined) {
        const patch = sanitizeFilterMap(args.team_filters);
        for (const [k, v] of Object.entries(patch))
          next.team_filters[k] = v;
      }
      if (args.view_filters !== undefined) {
        const patch = sanitizeFilterMap(args.view_filters);
        for (const [k, v] of Object.entries(patch))
          next.view_filters[k] = v;
      }
      if (args.relevance_class_filters !== undefined) {
        const patch = sanitizeRelevanceClassFilters(
          args.relevance_class_filters,
        );
        for (const [k, v] of Object.entries(patch))
          next.relevance_class_filters[k] = v;
      }
      if (typeof args.sort === "string" && VALID_SORTS.has(args.sort)) {
        next.sort = args.sort;
      }
      if (typeof args.show_done === "boolean") next.show_done = args.show_done;
      if (typeof args.show_snoozed === "boolean")
        next.show_snoozed = args.show_snoozed;
      if (typeof args.show_dismissed === "boolean")
        next.show_dismissed = args.show_dismissed;

      return serialisePrefs(next);
    });

    return {
      content: [
        {
          type: "text" as const,
          text: "triage-prefs.json saved.",
        },
      ],
    };
  },
};

// ── set_triage_pref ──────────────────────────────────────────────────────────

interface SetPrefArgs {
  path: string;
  snoozed_until?: string | null;
  dismissed_at?: string | null;
}

export const setPrefTool: MutationTool<SetPrefArgs> = {
  descriptor: {
    name: "agntux_core_set_triage_pref",
    description:
      "Set the per-path triage state (snooze / dismiss) for a specific action file. Writes `.agntux/triage-prefs.json` → `triage_state[path]`. PERSONAL: the action file is untouched, so a team item snoozed by Alice still appears in Bob's triage. Pass `path` (relative to AgntUX root, e.g. `teams/platform/actions/2026-05-12-foo.md`) and at least one of `snoozed_until`, `dismissed_at`. Pass `null` for a field to clear it; both null removes the entry.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Path to the action file, relative to the AgntUX project root.",
        },
        snoozed_until: {
          description:
            "RFC 3339 timestamp when the snooze ends. Pass `null` to clear. Omit to leave unchanged.",
        },
        dismissed_at: {
          description:
            "RFC 3339 timestamp when dismissed. Pass `null` to clear. Omit to leave unchanged.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  async handle(args, ctx: ViewToolContext) {
    const path =
      typeof args.path === "string" ? args.path.trim() : "";
    if (!path) throw new Error("path is required");
    if (!isValidTriageStatePath(path)) {
      throw new Error(
        `Path traversal rejected: invalid triage-prefs path "${path}".`,
      );
    }
    await ctx.fs.update(PREFS_PATH, (current) => {
      const prefs = parsePrefs(current);
      const next: TriagePrefsV2 = {
        ...prefs,
        triage_state: { ...prefs.triage_state },
      };

      const existing = next.triage_state[path] ?? {
        snoozed_until: null,
        dismissed_at: null,
      };
      let snoozed_until = existing.snoozed_until;
      let dismissed_at = existing.dismissed_at;
      if (Object.hasOwn(args, "snoozed_until")) {
        snoozed_until = sanitizeIsoOrNull(args.snoozed_until);
      }
      if (Object.hasOwn(args, "dismissed_at")) {
        dismissed_at = sanitizeIsoOrNull(args.dismissed_at);
      }

      if (snoozed_until === null && dismissed_at === null) {
        delete next.triage_state[path];
      } else {
        next.triage_state[path] = { snoozed_until, dismissed_at };
      }

      return serialisePrefs(next);
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `triage-prefs.json updated for ${path}.`,
        },
      ],
    };
  },
};
