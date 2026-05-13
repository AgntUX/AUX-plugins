// triage-prefs — write the user's UI filter state for the triage view to
// `<root>/.agntux/triage-prefs.json`.
//
// Why a tool, not a host setting:
//   The UI handler lives in an iframe; it has no direct filesystem access
//   and persists state through the MCP server. Per P3 v2 §1, the gate file
//   `<root>/.agntux/teams.json` is a sibling to this file in the same
//   `.agntux/` directory; both are read by the public plugin and written by
//   the appropriate trust boundary (teams.json by agntux-teams, triage-prefs
//   by the public agntux-core UI handler).
//
// Schema versions:
//   - v1 (9.2.0): { schema_version: 1, muted_team_slugs[], muted_view_slugs[] }.
//   - v2 (9.3.0 / P9): extends v1 with per-team filter state, per-team
//     relevance-class picks, sort key, show-done/snoozed/dismissed
//     toggles, and a `triage_state` map keyed by action-file path. The
//     personal snooze / dismiss state (deprecated on action frontmatter
//     in personal schema 1.2.0) lives in `triage_state[path]`. The
//     reader prefers triage-prefs.json over frontmatter when both carry
//     a value for the same path.
//
// Merge semantics:
//   The tool MERGES patch fields into the existing file. Callers may
//   patch a single field without re-sending the whole state — this is
//   load-bearing because per-path triage_state would otherwise require
//   the UI to re-send N path entries on every snooze. Fields not
//   mentioned in args stay untouched. `set_triage_state` is a
//   single-path patch; passing it does not overwrite the whole map.
//
// Atomicity: write to a sibling .tmp file and rename. Matches the snooze
// /dismiss/set-status pattern so the user never sees a half-written
// triage-prefs.json if the process dies mid-write.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectedAgntuxRoot } from "../agntux-root.js";

// Strict slug: 1–64 chars, lowercase + digits + dashes, must start AND end
// with [a-z0-9]. Mirrors the P3 §"Team identifier" rule (no leading or
// trailing dashes, no double dashes is left to authoring to avoid).
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_MUTED_SLUGS = 256;
const MAX_TRIAGE_STATE_ENTRIES = 4096;
// Relative paths must look like `actions/...md` or `teams/{slug}/actions/...md`
// or `leader-views/{slug}/actions/...md`. Bounded length so a buggy caller
// can't balloon the file with absurd keys. Posix separators only — the
// triage UI normalizes to forward slashes regardless of host OS.
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

// Shape exported for the triage-view tool's payload assembly.
export interface TriagePrefsV2 {
  schema_version: 2;
  // Legacy fields kept for back-compat with bundled clients that may still
  // emit them; the v2 tool maps them into team_filters / view_filters
  // automatically. New writers SHOULD prefer the v2 shape.
  muted_team_slugs: string[];
  muted_view_slugs: string[];
  // v2 fields.
  team_filters: Record<string, "shown" | "hidden">;
  view_filters: Record<string, "shown" | "hidden">;
  relevance_class_filters: Record<string, string[]>;
  sort: string;
  show_done: boolean;
  show_snoozed: boolean;
  show_dismissed: boolean;
  triage_state: Record<
    string,
    {
      snoozed_until: string | null;
      dismissed_at: string | null;
    }
  >;
}

const EMPTY_PREFS_V2: TriagePrefsV2 = {
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
    const classes = sanitizeSlugList(v);
    out[k] = classes;
    count++;
    if (count >= MAX_MUTED_SLUGS) break;
  }
  return out;
}

// Strict RFC 3339 / ISO 8601 timestamp shape used by the snooze /
// dismiss state writers. We accept date-only and full-timestamp forms
// (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS(.fff)?(Z|±HH:MM)`) so callers
// don't have to remember which one a given field wants. Anything that
// doesn't parse to a finite Date is rejected — the alternative
// (string-compare against `now`) would silently treat `"tomorrow"` as
// "not snoozed" and the snooze filter would fail-closed.
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

function sanitizeIsoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  // Defense against billion-character poisoning; ISO timestamps are well
  // under 32 chars in practice.
  if (t.length > 64) return null;
  if (!ISO_TIMESTAMP_RE.test(t)) return null;
  // Final correctness check: must parse to a finite Date. The regex
  // accepts e.g. `2026-13-99T99:99:99Z` which is shape-valid but not a
  // real timestamp.
  if (!Number.isFinite(Date.parse(t))) return null;
  return t;
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

function isValidTriageStatePath(p: unknown): p is string {
  if (typeof p !== "string") return false;
  if (p.length === 0 || p.length > 512) return false;
  if (p.includes("..")) return false;
  return TRIAGE_STATE_PATH_RE.test(p);
}

function prefsPath(): string {
  return join(expectedAgntuxRoot(), ".agntux", "triage-prefs.json");
}

// Read the on-disk prefs file, returning the v2 default shape when the
// file is absent, unreadable, malformed, or carries a v1 shape. A v1
// file's `muted_team_slugs` / `muted_view_slugs` are migrated into
// `team_filters` / `view_filters` as `'hidden'` entries so the v1 →
// v2 transition is silent and lossless from the user's perspective.
export function readTriagePrefs(): TriagePrefsV2 {
  let raw: string;
  try {
    raw = readFileSync(prefsPath(), "utf8");
  } catch {
    return cloneEmpty();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return cloneEmpty();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return cloneEmpty();
  }
  const obj = parsed as Record<string, unknown>;

  // Legacy field reads. v1 files only carried these; v2 keeps them in
  // sync with the new map shape so older bundles that read the legacy
  // arrays continue to honor the user's hidden teams.
  const muted_team_slugs = sanitizeSlugList(obj.muted_team_slugs);
  const muted_view_slugs = sanitizeSlugList(obj.muted_view_slugs);

  const team_filters = sanitizeFilterMap(obj.team_filters);
  const view_filters = sanitizeFilterMap(obj.view_filters);
  // Migrate legacy muted lists into the filter map when the map is
  // absent (typical v1 file). When both are present, the explicit
  // `team_filters` value wins — newer state takes precedence.
  for (const slug of muted_team_slugs) {
    if (team_filters[slug] === undefined) team_filters[slug] = "hidden";
  }
  for (const slug of muted_view_slugs) {
    if (view_filters[slug] === undefined) view_filters[slug] = "hidden";
  }

  const sort =
    typeof obj.sort === "string" && VALID_SORTS.has(obj.sort) ? obj.sort : "priority";

  return {
    schema_version: 2,
    muted_team_slugs,
    muted_view_slugs,
    team_filters,
    view_filters,
    relevance_class_filters: sanitizeRelevanceClassFilters(obj.relevance_class_filters),
    sort,
    show_done: obj.show_done === true,
    show_snoozed: obj.show_snoozed === true,
    show_dismissed: obj.show_dismissed === true,
    triage_state: sanitizeTriageState(obj.triage_state),
  };
}

function cloneEmpty(): TriagePrefsV2 {
  // Structured clone so callers can't accidentally mutate the module-
  // level EMPTY_PREFS_V2 sentinel.
  return {
    schema_version: 2,
    muted_team_slugs: [],
    muted_view_slugs: [],
    team_filters: {},
    view_filters: {},
    relevance_class_filters: {},
    sort: EMPTY_PREFS_V2.sort,
    show_done: false,
    show_snoozed: false,
    show_dismissed: false,
    triage_state: {},
  };
}

function writePrefs(prefs: TriagePrefsV2): void {
  const path = prefsPath();
  const dir = join(expectedAgntuxRoot(), ".agntux");
  mkdirSync(dir, { recursive: true });
  // Keep legacy arrays in sync with the filter map so an older bundle
  // that still reads only `muted_team_slugs` honors the user's hidden
  // teams. The map is authoritative; the legacy array is derived.
  const muted_team_slugs: string[] = [];
  for (const [slug, state] of Object.entries(prefs.team_filters)) {
    if (state === "hidden") muted_team_slugs.push(slug);
  }
  const muted_view_slugs: string[] = [];
  for (const [slug, state] of Object.entries(prefs.view_filters)) {
    if (state === "hidden") muted_view_slugs.push(slug);
  }
  const out: TriagePrefsV2 = {
    ...prefs,
    muted_team_slugs,
    muted_view_slugs,
  };
  const body = JSON.stringify(out, null, 2) + "\n";
  const tmp = path + ".tmp";
  writeFileSync(tmp, body, { mode: 0o644 });
  renameSync(tmp, path);
}

export const triagePrefsTool = {
  description:
    "Persist the triage UI's filter state for the current AgntUX project. Writes `<root>/.agntux/triage-prefs.json`. Called by the triage MCP App when the user toggles a team filter chip, a relevance-class chip, or a show-done/snoozed/dismissed toggle; not user-facing. MERGES patch fields into the existing file — callers may patch a single field without re-sending the whole state.",
  inputSchema: {
    type: "object" as const,
    properties: {
      // Legacy v1 fields. Accepted for back-compat with older bundles
      // and translated into `team_filters` / `view_filters` on write.
      muted_team_slugs: {
        type: "array",
        items: { type: "string" },
        description:
          "Legacy v1 field — flat array of team slugs the user has hidden. Translated to `team_filters[slug] = 'hidden'` on write. New callers should prefer `team_filters` directly.",
      },
      muted_view_slugs: {
        type: "array",
        items: { type: "string" },
        description:
          "Legacy v1 field — flat array of view slugs the user has hidden. Translated to `view_filters[slug] = 'hidden'` on write.",
      },
      // v2 fields.
      team_filters: {
        type: "object",
        description:
          "Map of team-slug → 'shown' | 'hidden'. Replaces the legacy `muted_team_slugs` array; missing slugs default to 'shown'. Patches the existing map: keys not in the patch retain their stored value.",
      },
      view_filters: {
        type: "object",
        description:
          "Map of leader-view-slug → 'shown' | 'hidden'. Mirrors `team_filters` for leader views.",
      },
      relevance_class_filters: {
        type: "object",
        description:
          "Map of team-slug → array of selected relevance-class slugs. The triage UI's strict-intersection filter renders an item only when the item's `relevance_classes[]` intersects the selected set. Patches the existing map: keys not in the patch retain their stored value.",
      },
      sort: {
        type: "string",
        description:
          "Sort key. One of: priority, due, created, team-then-priority, due-then-priority. Invalid values are ignored.",
      },
      show_done: { type: "boolean", description: "Toggle: render `status: done` items." },
      show_snoozed: {
        type: "boolean",
        description: "Toggle: render items the user has snoozed via triage-prefs.",
      },
      show_dismissed: {
        type: "boolean",
        description: "Toggle: render items the user has dismissed via triage-prefs.",
      },
    },
    required: [],
  },
  async handler(args: Record<string, unknown>) {
    const current = readTriagePrefs();
    const next: TriagePrefsV2 = {
      ...current,
      team_filters: { ...current.team_filters },
      view_filters: { ...current.view_filters },
      relevance_class_filters: { ...current.relevance_class_filters },
      triage_state: { ...current.triage_state },
    };

    // Legacy field handling. When a caller passes `muted_team_slugs`
    // explicitly, treat it as the full set of hidden teams: shown
    // teams stay shown (map entries get cleared back to default), and
    // listed slugs flip to 'hidden'. This preserves the v1 contract
    // where the array was the authoritative list.
    if (args.muted_team_slugs !== undefined) {
      const muted = sanitizeSlugList(args.muted_team_slugs);
      const filters: Record<string, "shown" | "hidden"> = {};
      for (const slug of muted) filters[slug] = "hidden";
      // Preserve any `shown` entries the caller didn't explicitly mute —
      // an older bundle round-tripping muted_team_slugs shouldn't lose
      // a v2-only `shown` annotation.
      for (const [slug, state] of Object.entries(next.team_filters)) {
        if (state === "shown" && filters[slug] === undefined) filters[slug] = "shown";
      }
      next.team_filters = filters;
    }
    if (args.muted_view_slugs !== undefined) {
      const muted = sanitizeSlugList(args.muted_view_slugs);
      const filters: Record<string, "shown" | "hidden"> = {};
      for (const slug of muted) filters[slug] = "hidden";
      for (const [slug, state] of Object.entries(next.view_filters)) {
        if (state === "shown" && filters[slug] === undefined) filters[slug] = "shown";
      }
      next.view_filters = filters;
    }

    // v2 patch merges. team_filters / view_filters / relevance_class_filters
    // merge per-key — a patch with `{platform: 'shown'}` flips platform
    // without touching infra.
    if (args.team_filters !== undefined) {
      const patch = sanitizeFilterMap(args.team_filters);
      for (const [k, v] of Object.entries(patch)) next.team_filters[k] = v;
    }
    if (args.view_filters !== undefined) {
      const patch = sanitizeFilterMap(args.view_filters);
      for (const [k, v] of Object.entries(patch)) next.view_filters[k] = v;
    }
    if (args.relevance_class_filters !== undefined) {
      const patch = sanitizeRelevanceClassFilters(args.relevance_class_filters);
      for (const [k, v] of Object.entries(patch)) next.relevance_class_filters[k] = v;
    }
    if (typeof args.sort === "string" && VALID_SORTS.has(args.sort)) {
      next.sort = args.sort;
    }
    if (typeof args.show_done === "boolean") next.show_done = args.show_done;
    if (typeof args.show_snoozed === "boolean") next.show_snoozed = args.show_snoozed;
    if (typeof args.show_dismissed === "boolean") {
      next.show_dismissed = args.show_dismissed;
    }

    writePrefs(next);

    const hiddenTeams = Object.values(next.team_filters).filter((s) => s === "hidden").length;
    const hiddenViews = Object.values(next.view_filters).filter((s) => s === "hidden").length;
    return {
      content: [
        {
          type: "text",
          text: `triage-prefs.json saved (${hiddenTeams} team(s) hidden, ${hiddenViews} view(s) hidden, sort=${next.sort}).`,
        },
      ],
    };
  },
};

// Per-path triage state patch. Sets `snoozed_until` and/or `dismissed_at`
// for a specific action-file path. P9 §"Per-member triage state" — snooze
// and dismiss are personal; the action file itself is untouched, which is
// how a team item Alice has dismissed continues to appear in Bob's
// triage. Path is validated against the strict pattern before write so
// callers can't poison the file with traversal-shaped keys; `..` is
// rejected explicitly.
export const setTriagePrefTool = {
  description:
    "Set the per-path triage state (snooze / dismiss) for a specific action file. Writes `<root>/.agntux/triage-prefs.json` → `triage_state[path]`. PERSONAL: the action file is untouched, so a team item snoozed by Alice still appears in Bob's triage. Pass `path` (relative to AgntUX root, e.g. `teams/platform/actions/2026-05-12-foo.md`) and at least one of `snoozed_until`, `dismissed_at`. Pass `null` for a field to clear it. To remove the entry entirely, pass both as null.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description:
          "Path to the action file, relative to the AgntUX project root. Must match `actions/*.md`, `teams/{slug}/actions/*.md`, or `leader-views/{slug}/actions/*.md`.",
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
  },
  async handler(args: Record<string, unknown>) {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) throw new Error("path is required");
    if (!isValidTriageStatePath(path)) {
      throw new Error(
        `Path traversal rejected: invalid triage-prefs path "${path}".`,
      );
    }
    const current = readTriagePrefs();
    const next: TriagePrefsV2 = {
      ...current,
      team_filters: { ...current.team_filters },
      view_filters: { ...current.view_filters },
      relevance_class_filters: { ...current.relevance_class_filters },
      triage_state: { ...current.triage_state },
    };

    const existing = next.triage_state[path] ?? {
      snoozed_until: null,
      dismissed_at: null,
    };
    let snoozed_until = existing.snoozed_until;
    let dismissed_at = existing.dismissed_at;
    if (Object.prototype.hasOwnProperty.call(args, "snoozed_until")) {
      snoozed_until = sanitizeIsoOrNull(args.snoozed_until);
    }
    if (Object.prototype.hasOwnProperty.call(args, "dismissed_at")) {
      dismissed_at = sanitizeIsoOrNull(args.dismissed_at);
    }

    // Drop the entry entirely when both fields are null — keeps the map
    // small and avoids stale snooze records lingering forever.
    if (snoozed_until === null && dismissed_at === null) {
      delete next.triage_state[path];
    } else {
      next.triage_state[path] = { snoozed_until, dismissed_at };
    }

    writePrefs(next);
    return {
      content: [
        {
          type: "text",
          text: `triage-prefs.json updated for ${path} (snoozed_until=${
            snoozed_until ?? "null"
          }, dismissed_at=${dismissed_at ?? "null"}).`,
        },
      ],
    };
  },
};
