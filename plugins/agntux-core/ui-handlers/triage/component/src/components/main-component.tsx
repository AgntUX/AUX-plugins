/**
 * Triage MainComponent
 *
 * Inline-budget MCP App for AgntUX action-item triage. Rendering rules are
 * inherited from briefing-learnings.md §1: every field defaults defensively
 * (parsePayload + safe-accessors), every external link goes through
 * openLink (suggested actions with a `url` dispatch through the host's
 * openLink primitive; ones with only `host_prompt` fall back to
 * sendFollowUpMessage), every interactive control is gated by
 * <fieldset disabled={isStreaming}>.
 *
 * Source-agnostic: this component never branches on which plugin authored an
 * action. Reason-class styling falls back to a neutral default for unknown
 * classes; `source` is displayed as plain text (no icons, no per-source UX).
 *
 * v6.1.0: replaced modals with inline expansion panels and replaced toast
 * notifications with in-list feedback rows that take the slot of the
 * resolved item. Reason: in a 400–600px iframe, modals were either centred
 * (yanking focus away from the row the user clicked) or anchored
 * imperfectly (clamped to ~1/3 down by the height-overflow guard). Inline
 * expansions sidestep the positioning math entirely; feedback rows
 * preserve the user's place in the list when an action resolves the card.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AgntuxLogo,
  Spinner,
  safeArray,
  safeBoolean,
  safeEnum,
  safeNumber,
  safeObject,
  safeString,
} from '@agntux/ui-primitives';

// =============================================================================
// Types
// =============================================================================

const PRIORITY_VALUES = ['high', 'medium', 'low'] as const;
type Priority = (typeof PRIORITY_VALUES)[number];

const ACTION_STATUS_VALUES = ['open', 'snoozed'] as const;
type ActionStatus = (typeof ACTION_STATUS_VALUES)[number];

const HANDLED_STATUS_VALUES = ['done', 'dismissed'] as const;
type HandledStatus = (typeof HANDLED_STATUS_VALUES)[number];

const ERROR_KINDS = ['actions_index_missing'] as const;
type ErrorKind = (typeof ERROR_KINDS)[number];

const PRIORITY_FILTER_VALUES = ['all', 'high', 'medium', 'low'] as const;
type PriorityFilter = (typeof PRIORITY_FILTER_VALUES)[number];

// 'created' was added in v6.0.0 to support the new "Most recently created"
// dropdown option (replaces the priority↔due toggle). P9 (9.3.0) added
// 'team-then-priority' + 'due-then-priority' for the team-mode triage view.
const SORT_VALUES = [
  'priority',
  'due',
  'created',
  'team-then-priority',
  'due-then-priority',
] as const;
type SortKey = (typeof SORT_VALUES)[number];

const SORT_LABELS: Record<SortKey, string> = {
  priority: 'Priority',
  due: 'Due date',
  created: 'Most recently created',
  'team-then-priority': 'Team, then priority',
  'due-then-priority': 'Due date, then priority',
};

const DISMISS_OUTCOMES = [
  'completed-externally',
  'noise',
  'irrelevant',
  'other',
] as const;
type DismissOutcome = (typeof DISMISS_OUTCOMES)[number];

type ExpandedKind =
  | 'details'
  | 'snooze'
  | 'dismiss'
  | 'do-something-else';

interface ExpandedState {
  id: string;
  kind: ExpandedKind;
}

// Replaces toasts as of v6.1.0: when a terminal action (done / snooze /
// dismiss / stop-raising) resolves a row, the row is replaced *in its slot*
// by a feedback card so the user keeps their place in the list. Auto-fades
// after FEEDBACK_FADE_MS, at which point the row is also dropped from the
// optimistically-hidden set so any future re-fetch reconciles cleanly.
interface FeedbackState {
  kind: 'done' | 'snoozed' | 'dismissed' | 'stopped-raising';
  title: string;
  message: string;
}

const FEEDBACK_FADE_MS = 5000;

interface SuggestedAction {
  label: string;
  host_prompt: string;
  url: string | null;
}

interface Action {
  id: string;
  title: string;
  summary: string;
  priority: Priority;
  status: ActionStatus;
  reason_class: string;
  due_by: string | null;
  snoozed_until: string | null;
  source: string | null;
  related_entities: string[];
  suggested_actions: SuggestedAction[];
  why_matters_excerpt: string;
  personalization_fit_excerpt: string;
  // Surfaced in v6.0.0 so the card can render "Created … / Updated …" lines
  // and the new sort dropdown can offer "Most recently created".
  created_at: string | null;
  updated_at: string | null;
  // Optional team-aware fields (9.2.0 / P3 v2 §1). Present on rows that
  // came from a team or leader-view scope; absent on personal rows so the
  // solo render path stays byte-identical to 9.0.0.
  team_slug?: string;
  team_id?: string;
  source_team?: string;
  member_relevance_class?: string;
  // P9 (9.3.0): the row's relevance-class list for strict-intersection
  // filter. Empty array on personal items. Path of the action file
  // relative to AgntUX root — load-bearing for `set_triage_pref` and
  // for keying snooze/dismiss state in `prefs.triage_state`.
  relevance_classes?: string[];
  relative_path?: string;
  // Team-wide mark-done attribution (P9). Visible in the UI's "Recently
  // handled" section as "Done by Alice".
  done_by_user_slug?: string;
  done_by_user_id?: string;
  done_at?: string;
  // Scope the row is being rendered IN. Differs from `team_slug` for
  // leader-view rows where the source is a team but the rendering scope
  // is the leader view. The mutator tools route on this pair, not on
  // the row's `team_slug`. Set by parsePayload from the section's
  // section-kind, not from frontmatter.
  scope_kind?: 'personal' | 'team' | 'leader';
  scope_slug?: string;
}

interface HandledAction {
  id: string;
  title: string;
  priority: Priority;
  status: HandledStatus;
  handled_at: string;
  outcome: string | null;
}

interface Counts {
  open: number;
  snoozed: number;
  handled_recent: number;
  truncated: boolean;
}

interface TeamSection {
  team_slug: string;
  team_id: string | null;
  display_name: string;
  actions: Action[];
  handled_recent: HandledAction[];
  // P9 (9.3.0): the current member's onboarding-time relevance picks
  // for this team. Empty array when not set yet — UI shows the
  // "Set your relevance picks…" empty state.
  member_relevance_classes: string[];
}

// P9 triage-prefs (9.3.0): user-controlled UI state read from
// `<root>/.agntux/triage-prefs.json` and surfaced server-side on the
// payload. The UI mirrors this into local state for snappy interactions
// and writes back via the agntux_core_save_triage_prefs /
// agntux_core_set_triage_pref tools.
interface TriagePrefs {
  schema_version: 2;
  team_filters: Record<string, 'shown' | 'hidden'>;
  view_filters: Record<string, 'shown' | 'hidden'>;
  relevance_class_filters: Record<string, string[]>;
  sort: SortKey;
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

const EMPTY_PREFS: TriagePrefs = {
  schema_version: 2,
  team_filters: {},
  view_filters: {},
  relevance_class_filters: {},
  sort: 'priority',
  show_done: false,
  show_snoozed: false,
  show_dismissed: false,
  triage_state: {},
};

interface LeaderSection {
  view_slug: string;
  view_id: string | null;
  display_name: string;
  actions: Action[];
  handled_recent: HandledAction[];
}

interface TriageData {
  // In team mode, this is the personal-scope subset (decorated as
  // `scope_kind: 'personal'`); in solo mode, it is the only list and the
  // shape is byte-identical to 9.0.0. The legacy field name is preserved
  // so older callers and tests keep working.
  actions: Action[];
  handled_recent: HandledAction[];
  counts: Counts;
  last_updated_at: string;
  bootstrap_mode: boolean;
  error: ErrorKind | null;
  // Team mode flips when the payload carries `personal` / `teams[]` /
  // `leader_views[]` keys (schema_version === 2). When false, all
  // team-mode UI is hidden and rendering is identical to 9.0.0.
  team_mode: boolean;
  teams: TeamSection[];
  leader_views: LeaderSection[];
  // P9 (9.3.0): user-controlled UI state. Default v2 shape when
  // absent (solo mode or fresh team mode without a saved prefs file).
  triage_prefs: TriagePrefs;
  // The current user's identity, when established (set by agntux-teams
  // during member onboarding). Null in solo mode and during the
  // pre-onboarding window. The UI passes these as `user_slug` /
  // `user_id` on mark-done so the team-wide audit fields get written.
  self_user_slug: string | null;
  self_user_id: string | null;
}

interface WidgetUiState {
  priority_filter: PriorityFilter;
  sort: SortKey;
  hide_done: boolean;
  handled_expanded: boolean;
  // Team-mode filter chips: slugs hidden in the current member's view.
  // Mirrors the data the save_triage_prefs tool writes to
  // `<root>/.agntux/triage-prefs.json`. Solo users have these empty
  // arrays and the chips never render.
  muted_team_slugs: string[];
  muted_view_slugs: string[];
}

const DEFAULT_WIDGET_STATE: WidgetUiState = {
  priority_filter: 'all',
  sort: 'priority',
  hide_done: false,
  handled_expanded: false,
  muted_team_slugs: [],
  muted_view_slugs: [],
};

// =============================================================================
// Public component contract — kept stable for App.tsx
// =============================================================================

export interface MainComponentProps {
  toolOutput?: Record<string, unknown> | undefined;
  toolInput?: Record<string, unknown>;
  isStreaming?: boolean;
  widgetState: Record<string, unknown>;
  setWidgetState: (
    next:
      | Record<string, unknown>
      | ((prev: Record<string, unknown>) => Record<string, unknown>),
  ) => void;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  sendFollowUpMessage: (prompt: string) => Promise<void>;
  openLink: (url: string) => Promise<void>;
  displayMode: string;
  availableDisplayModes: string[];
  requestDisplayMode: (mode: 'inline' | 'fullscreen' | 'pip') => Promise<void>;
  theme: string;
  locale: string;
  safeArea: { top: number; right: number; bottom: number; left: number };
  viewport: { width: number; height: number };
  platform: string;
}

// =============================================================================
// parsePayload — defensive coercion at the parse boundary (briefing-learnings §1.1–1.2)
// =============================================================================

function normalizeSuggestedAction(raw: unknown): SuggestedAction {
  const r = safeObject(raw);
  const url = safeString(r.url);
  return {
    label: safeString(r.label),
    host_prompt: safeString(r.host_prompt),
    url: url ? url : null,
  };
}

function normalizeAction(raw: unknown): Action {
  const r = safeObject(raw);
  const out: Action = {
    id: safeString(r.id),
    title: safeString(r.title),
    summary: safeString(r.summary),
    priority: safeEnum(r.priority, PRIORITY_VALUES, 'low'),
    status: safeEnum(r.status, ACTION_STATUS_VALUES, 'open'),
    reason_class: safeString(r.reason_class),
    due_by: typeof r.due_by === 'string' ? r.due_by : null,
    snoozed_until:
      typeof r.snoozed_until === 'string' ? r.snoozed_until : null,
    source: typeof r.source === 'string' ? r.source : null,
    related_entities: safeArray<unknown>(r.related_entities)
      .map((e) => safeString(e))
      .filter(Boolean),
    suggested_actions: safeArray<unknown>(r.suggested_actions).map(
      normalizeSuggestedAction,
    ),
    why_matters_excerpt: safeString(r.why_matters_excerpt),
    personalization_fit_excerpt: safeString(r.personalization_fit_excerpt),
    created_at: typeof r.created_at === 'string' ? r.created_at : null,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
  };
  // Optional team-aware fields: only attach when the source string has
  // actual content so a solo-mode payload (which never sets them) parses
  // into an object with the exact same keys as 9.0.0.
  if (typeof r.team_slug === 'string' && r.team_slug.length > 0) {
    out.team_slug = r.team_slug;
  }
  if (typeof r.team_id === 'string' && r.team_id.length > 0) {
    out.team_id = r.team_id;
  }
  if (typeof r.source_team === 'string' && r.source_team.length > 0) {
    out.source_team = r.source_team;
  }
  if (
    typeof r.member_relevance_class === 'string' &&
    r.member_relevance_class.length > 0
  ) {
    out.member_relevance_class = r.member_relevance_class;
  }
  // P9 (9.3.0): per-row strict-intersection inputs and team-wide audit
  // fields. Conditionally attached so solo rows (which never set them
  // server-side) parse into an object with the exact same keys as 9.0.0.
  const rc = safeArray<unknown>(r.relevance_classes)
    .map((c) => safeString(c))
    .filter(Boolean);
  if (rc.length > 0) out.relevance_classes = rc;
  if (typeof r.relative_path === 'string' && r.relative_path.length > 0) {
    out.relative_path = r.relative_path;
  }
  if (typeof r.done_by_user_slug === 'string' && r.done_by_user_slug.length > 0) {
    out.done_by_user_slug = r.done_by_user_slug;
  }
  if (typeof r.done_by_user_id === 'string' && r.done_by_user_id.length > 0) {
    out.done_by_user_id = r.done_by_user_id;
  }
  if (typeof r.done_at === 'string' && r.done_at.length > 0) {
    out.done_at = r.done_at;
  }
  return out;
}

function decorateActions(
  actions: Action[],
  scope_kind: 'personal' | 'team' | 'leader',
  scope_slug: string,
): Action[] {
  // Threads the rendering scope onto each row so the mutation handlers
  // can read `scope_kind` / `scope_slug` directly without re-deriving
  // from `team_slug` (which is absent on leader-view rows). The Action
  // shape is preserved across the JSON boundary; this only adds in-memory
  // fields the component owns.
  return actions.map((a) => ({ ...a, scope_kind, scope_slug }));
}

function normalizeTeamSection(raw: unknown): TeamSection | null {
  const r = safeObject(raw);
  const team_slug = safeString(r.team_slug);
  if (!team_slug) return null;
  return {
    team_slug,
    team_id: typeof r.team_id === 'string' ? r.team_id : null,
    display_name: safeString(r.display_name) || team_slug,
    actions: decorateActions(
      safeArray<unknown>(r.actions)
        .map(normalizeAction)
        .filter((a) => a.id),
      'team',
      team_slug,
    ),
    handled_recent: safeArray<unknown>(r.handled_recent)
      .map(normalizeHandled)
      .filter((h) => h.id),
    member_relevance_classes: safeArray<unknown>(r.member_relevance_classes)
      .map((c) => safeString(c))
      .filter(Boolean),
  };
}

function normalizeLeaderSection(raw: unknown): LeaderSection | null {
  const r = safeObject(raw);
  const view_slug = safeString(r.view_slug);
  if (!view_slug) return null;
  return {
    view_slug,
    view_id: typeof r.view_id === 'string' ? r.view_id : null,
    display_name: safeString(r.display_name) || view_slug,
    actions: decorateActions(
      safeArray<unknown>(r.actions)
        .map(normalizeAction)
        .filter((a) => a.id),
      'leader',
      view_slug,
    ),
    handled_recent: safeArray<unknown>(r.handled_recent)
      .map(normalizeHandled)
      .filter((h) => h.id),
  };
}

function normalizeHandled(raw: unknown): HandledAction {
  const r = safeObject(raw);
  return {
    id: safeString(r.id),
    title: safeString(r.title),
    priority: safeEnum(r.priority, PRIORITY_VALUES, 'low'),
    status: safeEnum(r.status, HANDLED_STATUS_VALUES, 'done'),
    handled_at: safeString(r.handled_at),
    outcome: typeof r.outcome === 'string' ? r.outcome : null,
  };
}

function parsePayload(toolOutput?: Record<string, unknown>): TriageData {
  const meta = safeObject(toolOutput?._meta);
  const payload = safeObject(meta.payload ?? toolOutput);
  const counts = safeObject(payload.counts);
  const error =
    typeof payload.error === 'string' &&
    (ERROR_KINDS as readonly string[]).includes(payload.error)
      ? (payload.error as ErrorKind)
      : null;

  // Detect team mode. The server emits `schema_version: 2` plus a
  // `personal` object and `teams` / `leader_views` arrays when team
  // mode is active. We treat any of those signals as a positive
  // detection so a forward-compatible server (3 → 4 etc.) still
  // routes to the new render path. The legacy `actions` field stays
  // populated as personal-only in team mode for backward compat with
  // older bundles, so we read `personal` first and fall back to
  // `actions` when only the legacy shape is present.
  const teams: TeamSection[] = safeArray<unknown>(payload.teams)
    .map(normalizeTeamSection)
    .filter((s): s is TeamSection => s !== null);
  const leader_views: LeaderSection[] = safeArray<unknown>(payload.leader_views)
    .map(normalizeLeaderSection)
    .filter((s): s is LeaderSection => s !== null);

  const schemaVersion = safeNumber(payload.schema_version);
  const team_mode =
    schemaVersion >= 2 || teams.length > 0 || leader_views.length > 0;

  let personalActions: Action[];
  let personalHandled: HandledAction[];
  if (team_mode && payload.personal && typeof payload.personal === 'object') {
    const personal = safeObject(payload.personal);
    personalActions = safeArray<unknown>(personal.actions)
      .map(normalizeAction)
      .filter((a) => a.id);
    personalHandled = safeArray<unknown>(personal.handled_recent)
      .map(normalizeHandled)
      .filter((h) => h.id);
  } else {
    personalActions = safeArray<unknown>(payload.actions)
      .map(normalizeAction)
      .filter((a) => a.id);
    personalHandled = safeArray<unknown>(payload.handled_recent)
      .map(normalizeHandled)
      .filter((h) => h.id);
  }
  // Only decorate with `scope_kind: 'personal'` when team mode is
  // active; in solo mode we want the Action objects unchanged so
  // mutation handlers take the legacy code path without ever looking
  // at `scope_kind`.
  if (team_mode) {
    personalActions = decorateActions(personalActions, 'personal', '');
  }

  return {
    actions: personalActions,
    handled_recent: personalHandled,
    counts: {
      open: safeNumber(counts.open),
      snoozed: safeNumber(counts.snoozed),
      handled_recent: safeNumber(counts.handled_recent),
      truncated: safeBoolean(counts.truncated),
    },
    last_updated_at: safeString(payload.last_updated_at),
    // Default false — when toolOutput is undefined or malformed, the component
    // should render the loading skeleton, NOT the bootstrap empty state. The
    // server emits `bootstrap_mode: true` explicitly when the user has
    // onboarded but no ingest plugin has fired yet.
    bootstrap_mode: safeBoolean(payload.bootstrap_mode, false),
    error,
    team_mode,
    teams,
    leader_views,
    triage_prefs: normalizeTriagePrefs(payload.triage_prefs),
    self_user_slug:
      typeof payload.self_user_slug === 'string' && payload.self_user_slug.length > 0
        ? payload.self_user_slug
        : null,
    self_user_id:
      typeof payload.self_user_id === 'string' && payload.self_user_id.length > 0
        ? payload.self_user_id
        : null,
  };
}

function normalizeTriagePrefs(raw: unknown): TriagePrefs {
  const r = safeObject(raw);
  // Defensive read: every field falls back to its v2 default. The server
  // emits the full v2 shape in team mode and omits the key entirely in
  // solo mode (handled below by EMPTY_PREFS).
  if (!raw) return { ...EMPTY_PREFS };
  const team_filters: Record<string, 'shown' | 'hidden'> = {};
  for (const [k, v] of Object.entries(safeObject(r.team_filters))) {
    if (v === 'shown' || v === 'hidden') team_filters[k] = v;
  }
  const view_filters: Record<string, 'shown' | 'hidden'> = {};
  for (const [k, v] of Object.entries(safeObject(r.view_filters))) {
    if (v === 'shown' || v === 'hidden') view_filters[k] = v;
  }
  const relevance_class_filters: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(safeObject(r.relevance_class_filters))) {
    relevance_class_filters[k] = safeArray<unknown>(v)
      .map((s) => safeString(s))
      .filter(Boolean);
  }
  const triage_state: TriagePrefs['triage_state'] = {};
  for (const [k, v] of Object.entries(safeObject(r.triage_state))) {
    const entry = safeObject(v);
    triage_state[k] = {
      snoozed_until:
        typeof entry.snoozed_until === 'string' ? entry.snoozed_until : null,
      dismissed_at:
        typeof entry.dismissed_at === 'string' ? entry.dismissed_at : null,
    };
  }
  return {
    schema_version: 2,
    team_filters,
    view_filters,
    relevance_class_filters,
    sort: safeEnum(r.sort, SORT_VALUES, 'priority'),
    show_done: safeBoolean(r.show_done, false),
    show_snoozed: safeBoolean(r.show_snoozed, false),
    show_dismissed: safeBoolean(r.show_dismissed, false),
    triage_state,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function readWidgetState(raw: Record<string, unknown>): WidgetUiState {
  return {
    priority_filter: safeEnum(
      raw.priority_filter,
      PRIORITY_FILTER_VALUES,
      'all',
    ),
    sort: safeEnum(raw.sort, SORT_VALUES, 'priority'),
    hide_done: safeBoolean(raw.hide_done, false),
    handled_expanded: safeBoolean(raw.handled_expanded, false),
    muted_team_slugs: safeArray<unknown>(raw.muted_team_slugs)
      .map((v) => safeString(v))
      .filter(Boolean),
    muted_view_slugs: safeArray<unknown>(raw.muted_view_slugs)
      .map((v) => safeString(v))
      .filter(Boolean),
  };
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function priorityPillClass(priority: Priority): string {
  switch (priority) {
    case 'high':
      return 'bg-red-50 text-red-700';
    case 'medium':
      return 'bg-amber-50 text-amber-700';
    case 'low':
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

// Reason-class palette — known classes get a tinted variant; unknown classes
// fall back to the neutral slate badge. Source-agnostic: the component never
// assumes any particular set of reason_class values.
const REASON_PALETTE: Record<string, string> = {
  'production-incident': 'bg-red-50 text-red-700',
  outage: 'bg-red-50 text-red-700',
  risk: 'bg-red-50 text-red-700',
  'response-needed': 'bg-blue-50 text-blue-700',
  'deal-movement': 'bg-amber-50 text-amber-700',
  'knowledge-update': 'bg-slate-100 text-slate-600',
};

function reasonBadgeClass(reasonClass: string): string {
  return REASON_PALETTE[reasonClass] ?? 'bg-slate-100 text-slate-600';
}

function formatDueDate(iso: string | null, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
    }).format(d);
  } catch {
    return '';
  }
}

function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return false;
  return d.getTime() < Date.now();
}

function formatRelative(iso: string, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const deltaMs = Date.now() - d.getTime();
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
    }).format(d);
  } catch {
    return '—';
  }
}

function nowPlus24hISO(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function nowPlus3dISO(): string {
  return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
}

// Regex match-guard for status-mutating host_prompts so the optimistic
// hide path is scoped to terminating verbs only — a `ux: ...open the reply
// composer for action {id}` prompt opens an iframe and must NOT hide the
// row. Module-scope constant so it isn't reallocated per render.
const TERMINATING_PROMPT_PATTERNS: readonly RegExp[] = [
  /set action ([\w-]+) status to done/i,
  /snooze action item ([\w-]+)/i,
  /dismiss action item ([\w-]+)/i,
];

function nextMondayMorningISO(): string {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun
  const offset = ((1 - day + 7) % 7) || 7;
  const next = new Date(d.getTime() + offset * 24 * 60 * 60 * 1000);
  next.setHours(9, 0, 0, 0);
  return next.toISOString();
}

// Truncate a string to N chars (visible width), preserving word boundaries.
// Reserves one char for the ellipsis so the result never exceeds `max`.
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice) + '…';
}

function toLocalDatetimeInputValue(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function fromLocalDatetimeInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

// =============================================================================
// Sub-components — small badges
// =============================================================================

function PriorityPill({ priority }: { priority: Priority }) {
  const label = priority.charAt(0).toUpperCase() + priority.slice(1);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider ${priorityPillClass(
        priority,
      )}`}
      data-testid={`priority-pill-${priority}`}
    >
      {label}
    </span>
  );
}

function ReasonBadge({ reasonClass }: { reasonClass: string }) {
  if (!reasonClass) return null;
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[0.6875rem] font-medium ${reasonBadgeClass(
        reasonClass,
      )}`}
      data-testid={`reason-badge-${reasonClass}`}
    >
      {reasonClass}
    </span>
  );
}

function ChipDue({ iso, locale }: { iso: string; locale: string }) {
  const overdue = isOverdue(iso);
  const formatted = formatDueDate(iso, locale);
  if (!formatted) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[0.6875rem] ${
        overdue
          ? 'border-red-600 text-red-700'
          : 'border-border text-muted-foreground'
      }`}
      aria-label={overdue ? `Overdue ${formatted}` : `Due ${formatted}`}
    >
      Due <time dateTime={iso}>{formatted}</time>
    </span>
  );
}

function EntityBadge({ entity }: { entity: string }) {
  const slashIdx = entity.indexOf('/');
  const subtype = slashIdx >= 0 ? entity.slice(0, slashIdx + 1) : '';
  const slug = slashIdx >= 0 ? entity.slice(slashIdx + 1) : entity;
  return (
    <span
      className="inline-flex select-none items-center rounded border border-border bg-muted px-2 py-0.5 text-[0.6875rem] text-muted-foreground"
      // Non-interactive in v1 — clickable in v1.1.
    >
      {subtype && <span className="text-slate-400">{subtype}</span>}
      {slug}
    </span>
  );
}

function TeamChip({ label }: { label: string }) {
  // Subtle indigo so it reads as "scope label" alongside the priority/reason
  // pills without competing for attention. The team-name chip is the
  // primary visual signal that this row is team-scoped, not personal.
  return (
    <span
      className="inline-flex items-center rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[0.6875rem] font-medium text-indigo-700"
      data-testid={`team-chip-${label}`}
      title={`Team scope: ${label}`}
    >
      {label}
    </span>
  );
}

function StatusBadge({
  status,
  outcome,
}: {
  status: HandledStatus;
  outcome: string | null;
}) {
  if (status === 'done') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-green-700">
        Done
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground"
      title={outcome ? `Outcome: ${outcome}` : undefined}
    >
      Dismissed
    </span>
  );
}

// =============================================================================
// Inline expansion panels
// =============================================================================
//
// Each panel renders below the action card's button row when the user clicks
// the corresponding action button. They share a section divider style so the
// expansion reads as part of the card, not as a separate element.

function PanelSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-3 mt-1 -mb-3 rounded-b-md border-t border-dashed border-border bg-muted/40 px-3 py-3">
      {children}
    </div>
  );
}

interface DetailsPanelProps {
  action: Action;
  pending: boolean;
  rowError: string | null;
  onClose: () => void;
  onSuggested: (action: SuggestedAction, actionId: string) => void;
  onSnoozeOpen: (id: string) => void;
  onDismissOpen: (id: string) => void;
  onDone: (id: string) => void;
  onDoSomethingElse: (id: string) => void;
  onStopRaising: (action: Action) => void;
}

function DetailsPanel({
  action,
  pending,
  rowError,
  onClose,
  onSuggested,
  onSnoozeOpen,
  onDismissOpen,
  onDone,
  onDoSomethingElse,
  onStopRaising,
}: DetailsPanelProps) {
  return (
    <PanelSection>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Details
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close details"
          data-testid={`details-close-${action.id}`}
        >
          ×
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-4">
        {action.why_matters_excerpt && (
          <section>
            <h5 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">
              Why this matters
            </h5>
            <p className="whitespace-pre-line text-[0.8125rem] leading-relaxed text-muted-foreground">
              {action.why_matters_excerpt}
            </p>
          </section>
        )}
        {action.personalization_fit_excerpt && (
          <section>
            <h5 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">
              Personalization fit
            </h5>
            <p className="whitespace-pre-line text-[0.8125rem] leading-relaxed text-muted-foreground">
              {action.personalization_fit_excerpt}
            </p>
          </section>
        )}
        {action.suggested_actions.length > 0 && (
          <section>
            <h5 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">
              Suggested actions
            </h5>
            <div className="flex flex-wrap gap-2">
              {action.suggested_actions.map((sa, idx) => (
                <button
                  key={`detail-sa-${idx}`}
                  type="button"
                  onClick={() => {
                    onSuggested(sa, action.id);
                    onClose();
                  }}
                  className={
                    idx === 0
                      ? 'inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-[0.8125rem] text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      : 'inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-[0.8125rem] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  }
                  data-testid={`detail-suggested-${idx}`}
                >
                  {sa.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  onDoSomethingElse(action.id);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-[0.8125rem] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="detail-do-something-else"
              >
                Do something else…
              </button>
            </div>
          </section>
        )}
        {action.related_entities.length > 0 && (
          <section>
            <h5 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">
              Related entities
            </h5>
            <div className="flex flex-wrap gap-1">
              {action.related_entities.map((e) => (
                <EntityBadge key={e} entity={e} />
              ))}
            </div>
            <p className="mt-2 text-[0.6875rem] text-slate-400">
              Tap-through to entity details ships in a follow-up.
            </p>
          </section>
        )}
        {rowError && (
          <p className="text-xs text-red-700" role="alert">
            {rowError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onStopRaising(action)}
            className="mr-auto rounded-md px-3 py-1.5 text-[0.8125rem] text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="stop-raising"
          >
            Stop raising items like this
          </button>
          <button
            type="button"
            onClick={() => onSnoozeOpen(action.id)}
            disabled={pending}
            className="rounded-md px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            Snooze
          </button>
          <button
            type="button"
            onClick={() => onDismissOpen(action.id)}
            disabled={pending}
            className="rounded-md px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => onDone(action.id)}
            disabled={pending}
            aria-busy={pending ? 'true' : 'false'}
            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-[0.8125rem] text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {pending ? (
              <>
                <Spinner size={12} />
                Marking…
              </>
            ) : (
              'Mark done'
            )}
          </button>
        </div>
      </div>
    </PanelSection>
  );
}

interface SnoozePanelProps {
  action: Action;
  pending: boolean;
  rowError: string | null;
  onClose: () => void;
  onSubmit: (id: string, untilISO: string) => void;
}

function SnoozePanel({
  action,
  pending,
  rowError,
  onClose,
  onSubmit,
}: SnoozePanelProps) {
  const [pickedISO, setPickedISO] = useState<string>(nowPlus24hISO());
  const localValue = toLocalDatetimeInputValue(pickedISO);
  const submit = () => onSubmit(action.id, pickedISO);
  return (
    <PanelSection>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Snooze
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close snooze panel"
          data-testid={`snooze-close-${action.id}`}
        >
          ×
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          Will reappear when the snooze ends.
        </p>
        <div>
          <h5 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">
            Quick presets
          </h5>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-[0.8125rem] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setPickedISO(nowPlus24hISO())}
              data-testid="snooze-preset-24h"
            >
              24 hours
            </button>
            <button
              type="button"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-[0.8125rem] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setPickedISO(nowPlus3dISO())}
              data-testid="snooze-preset-3d"
            >
              3 days
            </button>
            <button
              type="button"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-[0.8125rem] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setPickedISO(nextMondayMorningISO())}
              data-testid="snooze-preset-monday"
            >
              Next Monday 9am
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`snooze-until-${action.id}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Custom date &amp; time
          </label>
          <input
            id={`snooze-until-${action.id}`}
            type="datetime-local"
            value={localValue}
            onChange={(e) => {
              const iso = fromLocalDatetimeInputValue(e.target.value);
              if (iso) setPickedISO(iso);
            }}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus-visible:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="snooze-input"
          />
        </div>
        {rowError && (
          <p className="text-xs text-red-700" role="alert">
            {rowError}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="snooze-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !pickedISO}
            aria-busy={pending ? 'true' : 'false'}
            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-[0.8125rem] text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            data-testid="snooze-confirm"
          >
            {pending ? (
              <>
                <Spinner size={12} />
                Snoozing…
              </>
            ) : (
              'Snooze'
            )}
          </button>
        </div>
      </div>
    </PanelSection>
  );
}

interface DismissPanelProps {
  action: Action;
  pending: boolean;
  rowError: string | null;
  onClose: () => void;
  onSubmit: (id: string, outcome: string, note: string) => void;
}

function DismissPanel({
  action,
  pending,
  rowError,
  onClose,
  onSubmit,
}: DismissPanelProps) {
  const [outcome, setOutcome] = useState<DismissOutcome>(DISMISS_OUTCOMES[0]);
  const [note, setNote] = useState<string>('');
  const submit = () => onSubmit(action.id, outcome, note.trim());
  return (
    <PanelSection>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Dismiss
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close dismiss panel"
          data-testid={`dismiss-close-${action.id}`}
        >
          ×
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          Capturing why you dismissed this helps AgntUX learn what's signal vs
          noise for you.
        </p>
        <fieldset
          className="flex flex-col gap-2"
          aria-labelledby={`dismiss-outcome-label-${action.id}`}
        >
          <span
            id={`dismiss-outcome-label-${action.id}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Outcome
          </span>
          <DismissOption
            value="completed-externally"
            current={outcome}
            onChange={setOutcome}
            title="Completed externally."
            body="I already handled this in the source app."
          />
          <DismissOption
            value="noise"
            current={outcome}
            onChange={setOutcome}
            title="Noise."
            body="Items like this aren't worth surfacing."
          />
          <DismissOption
            value="irrelevant"
            current={outcome}
            onChange={setOutcome}
            title="Irrelevant."
            body="Useful sometimes, but not for me."
          />
          <DismissOption
            value="other"
            current={outcome}
            onChange={setOutcome}
            title="Other"
            body="— describe below."
          />
        </fieldset>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`dismiss-note-${action.id}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Note (optional)
          </label>
          <textarea
            id={`dismiss-note-${action.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="One line of context AgntUX can use to learn from this."
            className="min-h-[60px] resize-y rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus-visible:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="dismiss-note"
          />
        </div>
        {rowError && (
          <p className="text-xs text-red-700" role="alert">
            {rowError}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="dismiss-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            aria-busy={pending ? 'true' : 'false'}
            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-[0.8125rem] text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            data-testid="dismiss-confirm"
          >
            {pending ? (
              <>
                <Spinner size={12} />
                Dismissing…
              </>
            ) : (
              'Dismiss action'
            )}
          </button>
        </div>
      </div>
    </PanelSection>
  );
}

function DismissOption({
  value,
  current,
  onChange,
  title,
  body,
}: {
  value: DismissOutcome;
  current: DismissOutcome;
  onChange: (next: DismissOutcome) => void;
  title: string;
  body: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[0.8125rem]">
      <input
        type="radio"
        name={`dismiss-outcome-${value}`}
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
        className="mt-1"
        data-testid={`dismiss-outcome-${value}`}
      />
      <span className="text-foreground">
        <strong className="font-semibold">{title}</strong>{' '}
        <span className="text-muted-foreground">{body}</span>
      </span>
    </label>
  );
}

interface DoSomethingElsePanelProps {
  action: Action;
  onClose: () => void;
  onSubmit: (action: Action, prompt: string) => void;
}

function DoSomethingElsePanel({
  action,
  onClose,
  onSubmit,
}: DoSomethingElsePanelProps) {
  const [prompt, setPrompt] = useState<string>('');
  const trimmed = prompt.trim();
  const submit = () => {
    if (!trimmed) return;
    onSubmit(action, trimmed);
  };
  return (
    <PanelSection>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Do something else
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close do something else panel"
          data-testid={`do-something-else-close-${action.id}`}
        >
          ×
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          Tell the host what to do. Your prompt will be sent back to chat with
          the action's full context attached, so the host can act on it
          without losing the details.
        </p>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`do-something-else-prompt-${action.id}`}
            className="text-xs font-medium text-muted-foreground"
          >
            What should we do?
          </label>
          <textarea
            id={`do-something-else-prompt-${action.id}`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Draft a Linear ticket for this and assign it to me."
            className="min-h-[100px] resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="do-something-else-prompt"
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="do-something-else-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!trimmed}
            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-[0.8125rem] text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            data-testid="do-something-else-submit"
          >
            Send prompt
          </button>
        </div>
      </div>
    </PanelSection>
  );
}

// =============================================================================
// Action card — collapsed by default; renders a panel inline when expandedKind
// is set for this action.
// =============================================================================

interface ActionCardProps {
  action: Action;
  pending: boolean;
  rowError: string | null;
  expandedKind: ExpandedKind | null;
  onSuggested: (action: SuggestedAction, actionId: string) => void;
  onExpand: (id: string, kind: ExpandedKind) => void;
  onCollapse: () => void;
  onDone: (id: string) => void;
  onSnoozeSubmit: (id: string, untilISO: string) => void;
  onDismissSubmit: (id: string, outcome: string, note: string) => void;
  onDoSomethingElseSubmit: (action: Action, prompt: string) => void;
  onStopRaising: (action: Action) => void;
  locale: string;
}

const MAX_ENTITIES_INLINE = 6;
const MAX_SUGGESTED_INLINE = 6;

function ActionCard({
  action,
  pending,
  rowError,
  expandedKind,
  onSuggested,
  onExpand,
  onCollapse,
  onDone,
  onSnoozeSubmit,
  onDismissSubmit,
  onDoSomethingElseSubmit,
  onStopRaising,
  locale,
}: ActionCardProps) {
  const titleId = `card-${action.id}-title`;
  const entitiesShown = action.related_entities.slice(0, MAX_ENTITIES_INLINE);
  const entitiesHidden =
    action.related_entities.length - entitiesShown.length;
  const suggestedShown = action.suggested_actions.slice(
    0,
    MAX_SUGGESTED_INLINE,
  );
  // Show updated_at only when meaningfully different from created_at
  // (>1 day apart) — most actions stay at created_at == updated_at until a
  // status flip or body append. Same-day edits (the user toggling sorts /
  // filters within the same render cycle) stay collapsed into "Created X".
  const createdMs = action.created_at
    ? new Date(action.created_at).getTime()
    : NaN;
  const updatedMs = action.updated_at
    ? new Date(action.updated_at).getTime()
    : NaN;
  const showSeparateUpdated =
    Number.isFinite(createdMs) &&
    Number.isFinite(updatedMs) &&
    Math.abs(updatedMs - createdMs) > 24 * 60 * 60 * 1000;

  const toggle = (kind: ExpandedKind) => {
    if (expandedKind === kind) onCollapse();
    else onExpand(action.id, kind);
  };

  // Team-aware visuals (P3 v2 §1):
  //   - team-name chip: surfaced when the row carries a `team_slug`. Solo
  //     rows (no team_slug) render without the chip — byte-identical UX.
  //   - left-edge ribbon: when `member_relevance_class` is set, a vertical
  //     accent bar sits inside the card edge so the user can scan a long
  //     list and pick out the categories they care about. Implemented as
  //     an absolutely-positioned span so the card's existing flex layout
  //     isn't disrupted; falls back to no-ribbon for rows without the
  //     field. Card adds `relative` + `pl-3.5` only when the ribbon
  //     renders so the solo card layout stays unchanged.
  const hasRibbon = !!action.member_relevance_class;
  const cardClass = hasRibbon
    ? 'relative flex flex-col gap-2 rounded-md border border-border bg-card p-3 pl-3.5 shadow-sm'
    : 'flex flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-sm';
  return (
    <article
      className={cardClass}
      role="listitem"
      aria-labelledby={titleId}
      data-testid={`action-card-${action.id}`}
    >
      {hasRibbon && (
        <span
          aria-hidden="true"
          data-testid={`relevance-ribbon-${action.id}`}
          title={`Relevance: ${action.member_relevance_class}`}
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md bg-indigo-400"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PriorityPill priority={action.priority} />
        <ReasonBadge reasonClass={action.reason_class} />
        {action.team_slug && <TeamChip label={action.team_slug} />}
        {action.due_by && <ChipDue iso={action.due_by} locale={locale} />}
        {action.status === 'snoozed' && action.snoozed_until && (
          <span className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[0.6875rem] text-muted-foreground">
            Snoozed until{' '}
            <time dateTime={action.snoozed_until}>
              {formatDueDate(action.snoozed_until, locale)}
            </time>
          </span>
        )}
        {action.source && (
          <span className="text-[0.6875rem] text-slate-400">
            via {action.source}
          </span>
        )}
      </div>
      <h3
        id={titleId}
        className="text-[0.9375rem] font-semibold leading-snug tracking-tight text-foreground"
      >
        {action.title}
      </h3>
      {action.summary && (
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          {action.summary}
        </p>
      )}
      {(action.created_at || action.updated_at) && (
        <p
          className="text-[0.6875rem] text-slate-400"
          data-testid={`timestamps-${action.id}`}
        >
          {action.created_at && (
            <>
              Created{' '}
              <time dateTime={action.created_at}>
                {formatRelative(action.created_at, locale)}
              </time>
            </>
          )}
          {showSeparateUpdated && action.updated_at && (
            <>
              {' · '}Updated{' '}
              <time dateTime={action.updated_at}>
                {formatRelative(action.updated_at, locale)}
              </time>
            </>
          )}
        </p>
      )}
      {entitiesShown.length > 0 && (
        <div
          className="mt-1 flex flex-wrap gap-1"
          aria-label="Related entities"
        >
          {entitiesShown.map((e) => (
            <EntityBadge key={e} entity={e} />
          ))}
          {entitiesHidden > 0 && (
            <span
              className="inline-flex items-center rounded border border-border bg-muted px-2 py-0.5 text-[0.6875rem] text-muted-foreground"
              title={`${entitiesHidden} more`}
            >
              +{entitiesHidden}
            </span>
          )}
        </div>
      )}
      {suggestedShown.length > 0 && (
        <div
          className="mt-1 flex flex-wrap gap-2"
          aria-label="Suggested actions"
        >
          {suggestedShown.map((sa, idx) => (
            <button
              key={`${action.id}-sa-${idx}`}
              type="button"
              className={
                idx === 0
                  ? 'inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-[0.8125rem] text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  : 'inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-[0.8125rem] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              }
              onClick={() => onSuggested(sa, action.id)}
              data-testid={`suggested-${action.id}-${idx}`}
            >
              {sa.label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-2">
        <button
          type="button"
          onClick={() => toggle('details')}
          aria-expanded={expandedKind === 'details'}
          className={
            expandedKind === 'details'
              ? 'rounded-md bg-muted px-3 py-1.5 text-[0.8125rem] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              : 'rounded-md px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          }
          aria-label={`Expand details for ${action.title}`}
          data-testid={`details-${action.id}`}
        >
          Details
        </button>
        <button
          type="button"
          onClick={() => toggle('do-something-else')}
          aria-expanded={expandedKind === 'do-something-else'}
          disabled={pending}
          className={
            expandedKind === 'do-something-else'
              ? 'rounded-md bg-muted px-3 py-1.5 text-[0.8125rem] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'
              : 'rounded-md px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'
          }
          data-testid={`do-something-else-${action.id}`}
        >
          Do something else…
        </button>
        {rowError && (
          <span
            className="text-xs text-red-700"
            role="alert"
            data-testid={`row-error-${action.id}`}
          >
            {rowError}
          </span>
        )}
        <span className="ml-auto" />
        <button
          type="button"
          onClick={() => toggle('snooze')}
          aria-expanded={expandedKind === 'snooze'}
          disabled={pending}
          className={
            expandedKind === 'snooze'
              ? 'rounded-md bg-muted px-3 py-1.5 text-[0.8125rem] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'
              : 'rounded-md px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'
          }
          data-testid={`snooze-${action.id}`}
        >
          Snooze
        </button>
        <button
          type="button"
          onClick={() => toggle('dismiss')}
          aria-expanded={expandedKind === 'dismiss'}
          disabled={pending}
          className={
            expandedKind === 'dismiss'
              ? 'rounded-md bg-muted px-3 py-1.5 text-[0.8125rem] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'
              : 'rounded-md px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'
          }
          data-testid={`dismiss-${action.id}`}
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => onDone(action.id)}
          disabled={pending}
          aria-busy={pending ? 'true' : 'false'}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-[0.8125rem] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          data-testid={`done-${action.id}`}
        >
          {pending ? (
            <>
              <Spinner size={12} />
              Marking…
            </>
          ) : (
            'Done'
          )}
        </button>
      </div>
      {expandedKind === 'details' && (
        <DetailsPanel
          action={action}
          pending={pending}
          rowError={rowError}
          onClose={onCollapse}
          onSuggested={onSuggested}
          onSnoozeOpen={(id) => onExpand(id, 'snooze')}
          onDismissOpen={(id) => onExpand(id, 'dismiss')}
          onDone={onDone}
          onDoSomethingElse={(id) => onExpand(id, 'do-something-else')}
          onStopRaising={onStopRaising}
        />
      )}
      {expandedKind === 'snooze' && (
        <SnoozePanel
          action={action}
          pending={pending}
          rowError={rowError}
          onClose={onCollapse}
          onSubmit={onSnoozeSubmit}
        />
      )}
      {expandedKind === 'dismiss' && (
        <DismissPanel
          action={action}
          pending={pending}
          rowError={rowError}
          onClose={onCollapse}
          onSubmit={onDismissSubmit}
        />
      )}
      {expandedKind === 'do-something-else' && (
        <DoSomethingElsePanel
          action={action}
          onClose={onCollapse}
          onSubmit={onDoSomethingElseSubmit}
        />
      )}
    </article>
  );
}

// =============================================================================
// Feedback row — replaces an action card in its slot when a terminal action
// resolves the row. Auto-fades after FEEDBACK_FADE_MS, at which point the
// row is dropped from the optimistically-hidden set. Keeps the user's place
// in the list and gives them a moment to register what just happened.
// =============================================================================

function FeedbackRow({
  id,
  state,
}: {
  id: string;
  state: FeedbackState;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`feedback-${id}`}
      className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-[0.8125rem] text-green-800"
    >
      <span aria-hidden="true">✓</span>
      <span className="font-medium">{state.message}</span>
      {state.title && (
        <span className="truncate text-green-900/70">
          · {truncate(state.title, 60)}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// Empty / degraded states
// =============================================================================

function BootstrapEmpty() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground"
      role="status"
      aria-live="polite"
      data-testid="bootstrap-empty"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="h-9 w-9 text-slate-400"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <h3 className="m-0 text-base font-semibold text-foreground">
        We're listening.
      </h3>
      <p className="m-0 max-w-[36ch] leading-relaxed">
        Your first action items will arrive here as your ingest plugins fire.
        AgntUX is set up — nothing to do but get back to work.
      </p>
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-600" />
        Observing — first 7 days
      </span>
    </div>
  );
}

function ActionsIndexMissing({
  onOnboard,
}: {
  onOnboard: () => void;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground"
      role="status"
      aria-live="polite"
      data-testid="actions-index-missing"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="h-9 w-9 text-slate-400"
        aria-hidden="true"
      >
        <path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" />
        <path d="M3 7l9 4 9-4M12 11v10" />
      </svg>
      <h3 className="m-0 text-base font-semibold text-foreground">
        Nothing to triage yet.
      </h3>
      <p className="m-0 max-w-[36ch] leading-relaxed">
        Your knowledge store hasn't been initialised. Walk through onboarding to
        set up your profile — then your ingest plugins start populating triage
        automatically.
      </p>
      <button
        type="button"
        onClick={onOnboard}
        className="rounded-md bg-foreground px-3 py-1.5 text-[0.8125rem] text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="run-onboard"
      >
        Run /agntux onboard
      </button>
    </div>
  );
}

// =============================================================================
// P9 prefs helpers
// =============================================================================

// Merge fresh server-side prefs over the local state, preserving any
// keys the user has touched this session (tracked by the dirty set).
// Without this, a slow MCP roundtrip could let a stale server snapshot
// reset a fresh toggle. Each dirty key is restored from the local
// mirror onto the server-merged base.
function mergeServerPrefs(
  local: TriagePrefs,
  server: TriagePrefs,
  dirty: Set<string>,
): TriagePrefs {
  const base: TriagePrefs = {
    schema_version: 2,
    team_filters: { ...server.team_filters },
    view_filters: { ...server.view_filters },
    relevance_class_filters: { ...server.relevance_class_filters },
    sort: server.sort,
    show_done: server.show_done,
    show_snoozed: server.show_snoozed,
    show_dismissed: server.show_dismissed,
    triage_state: { ...server.triage_state },
  };
  for (const key of dirty) {
    if (key === 'sort') base.sort = local.sort;
    else if (key === 'show_done') base.show_done = local.show_done;
    else if (key === 'show_snoozed') base.show_snoozed = local.show_snoozed;
    else if (key === 'show_dismissed') base.show_dismissed = local.show_dismissed;
    else if (key.startsWith('team_filters:')) {
      const slug = key.slice('team_filters:'.length);
      if (local.team_filters[slug] !== undefined) {
        base.team_filters[slug] = local.team_filters[slug];
      } else {
        delete base.team_filters[slug];
      }
    } else if (key.startsWith('view_filters:')) {
      const slug = key.slice('view_filters:'.length);
      if (local.view_filters[slug] !== undefined) {
        base.view_filters[slug] = local.view_filters[slug];
      } else {
        delete base.view_filters[slug];
      }
    } else if (key.startsWith('relevance_class_filters:')) {
      const slug = key.slice('relevance_class_filters:'.length);
      if (local.relevance_class_filters[slug] !== undefined) {
        base.relevance_class_filters[slug] = local.relevance_class_filters[slug];
      } else {
        delete base.relevance_class_filters[slug];
      }
    } else if (key.startsWith('triage_state:')) {
      const path = key.slice('triage_state:'.length);
      if (local.triage_state[path] !== undefined) {
        base.triage_state[path] = local.triage_state[path];
      } else {
        delete base.triage_state[path];
      }
    }
  }
  return base;
}

// Read the effective snooze / dismiss for a row, preferring the prefs
// entry over the action-frontmatter fields. Per P9, prefs.triage_state
// is the new authority on personal preferences; the action-frontmatter
// `snoozed_until` / `dismissed_at` fields are deprecated in 1.2.0 but
// kept readable for legacy files during the 90-day transition window.
function effectivePersonalState(
  action: Action,
  prefs: TriagePrefs,
): { snoozed_until: string | null; dismissed_at: string | null } {
  const path = action.relative_path;
  const fromPrefs = path ? prefs.triage_state[path] : undefined;
  if (fromPrefs) return fromPrefs;
  // Legacy fallback: frontmatter fields. ONLY the personal scope wrote
  // these historically. Team-scoped action files MUST NOT influence one
  // member's view of a team item — a hand-edited team-scoped action with
  // `snoozed_until` on its frontmatter would otherwise leak as a personal
  // snooze. Gate the fallback to personal scope (or solo, where
  // scope_kind is undefined and the legacy field is the only signal).
  if (action.scope_kind && action.scope_kind !== 'personal') {
    return { snoozed_until: null, dismissed_at: null };
  }
  return {
    snoozed_until: action.snoozed_until,
    dismissed_at: null,
  };
}

// Strict-intersection filter for team-scope rows. Renders an item iff
// member.relevance_classes ∩ item.relevance_classes ≠ ∅, AND it's not
// snoozed (or "Show snoozed" toggled), AND it's not dismissed (or
// "Show dismissed" toggled), AND status is open (or "Show done"
// toggled — but the row list here is open-only by definition; the
// done items live in handled_recent).
//
// Selected filters: when the user has narrowed their relevance picks
// via the chips inside the section (`prefs.relevance_class_filters`),
// that array further narrows the intersection. Empty selected →
// the user wants all their picks.
function passesStrictIntersection(
  itemClasses: string[],
  selectedClasses: string[],
  memberClasses: string[],
): boolean {
  // No member picks AND no explicit chip narrowing → fall through to
  // "show all". This is the pre-onboarding compatibility path: a
  // user who hasn't run member-onboarding for this team still sees
  // every team item alongside the "Set your relevance picks…" CTA.
  // Once they've picked something, the strict filter kicks in.
  if (memberClasses.length === 0 && selectedClasses.length === 0) return true;
  // The active filter set is `selectedClasses` when the user has
  // narrowed via chips; otherwise the member's onboarding picks.
  const effective = selectedClasses.length > 0 ? selectedClasses : memberClasses;
  // If the active filter is empty (user un-checked every chip),
  // nothing matches.
  if (effective.length === 0) return false;
  // No item classes on the row → defensively show. Older items
  // (pre-9.3.0) lack `relevance_classes`; hiding them would surprise
  // users. The explicit narrowing only filters rows that DO declare
  // classes.
  if (itemClasses.length === 0) return true;
  for (const c of itemClasses) {
    if (effective.includes(c)) return true;
  }
  return false;
}

// Now() in milliseconds; pulled out as a helper so tests can pin it
// without monkey-patching globalThis.Date inside the component.
function nowMs(): number {
  return Date.now();
}

// Synthesize the action's `relative_path` from (scope_kind, scope_slug, id)
// when an older mcp-server didn't emit it. Returns null for solo-mode
// personal rows (which lack scope_kind entirely) so the caller can fall
// back to the legacy frontmatter-snooze tool — that path is safe for
// solo because the personal action file is private to the user.
function synthesizeRelativePath(
  action: Action | undefined,
  id: string,
): string | null {
  if (!action) return null;
  if (action.scope_kind === 'team' && action.scope_slug) {
    return `teams/${action.scope_slug}/actions/${id}.md`;
  }
  if (action.scope_kind === 'leader' && action.scope_slug) {
    return `leader-views/${action.scope_slug}/actions/${id}.md`;
  }
  if (action.scope_kind === 'personal') {
    return `actions/${id}.md`;
  }
  return null;
}

// =============================================================================
// Main
// =============================================================================

export function MainComponent(props: MainComponentProps) {
  const {
    toolOutput,
    isStreaming,
    widgetState,
    setWidgetState,
    callTool,
    sendFollowUpMessage,
    openLink,
    locale,
  } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);
  const ui = useMemo(() => readWidgetState(widgetState), [widgetState]);

  // Transient UI state.
  const [expanded, setExpanded] = useState<ExpandedState | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, FeedbackState>>({});
  // Track auto-fade timers so we can clean up on unmount and replace stale
  // ones if the same id resolves twice in quick succession.
  const feedbackTimersRef = useRef(new Map<string, number>());

  // P9: local mirror of `data.triage_prefs` for snappy UI updates. On
  // every payload refresh the mirror seeds from the server-side state;
  // user toggles update the mirror optimistically and fire the
  // agntux_core_save_triage_prefs MCP tool in parallel. The mirror
  // lives in component state (not widgetState) because it can be
  // recomputed from the next render's `data.triage_prefs` — no need to
  // persist it through an iframe remount.
  const [prefs, setPrefs] = useState<TriagePrefs>(() => data.triage_prefs);
  // Track which prefs keys the user has touched this session so a slow
  // tool call doesn't blow away a fresh toggle when the next payload
  // arrives. Keys: 'team_filters:{slug}', 'view_filters:{slug}',
  // 'relevance_class_filters:{slug}', 'sort', 'show_done',
  // 'show_snoozed', 'show_dismissed', 'triage_state:{path}'.
  const dirtyPrefsRef = useRef(new Set<string>());

  // Re-seed local prefs from the server-side state when the payload
  // refreshes, but preserve any keys the user has touched this session.
  // A naive `setPrefs(data.triage_prefs)` would clobber a toggle the
  // user made before the save_triage_prefs roundtrip completed.
  useEffect(() => {
    setPrefs((cur) => mergeServerPrefs(cur, data.triage_prefs, dirtyPrefsRef.current));
  }, [data.triage_prefs]);

  // After a successful save roundtrip, drop the matching dirty flags so
  // a subsequent cross-device update can win the next merge. Without
  // this, the dirty set grows monotonically and `mergeServerPrefs`
  // would keep favoring the local mirror over server state from
  // another machine until iframe remount.
  const clearDirtyAfter = useCallback(
    (promise: unknown, ...keys: string[]): void => {
      if (
        promise &&
        typeof (promise as { then?: unknown }).then === 'function'
      ) {
        (promise as Promise<unknown>).then(
          () => {
            for (const k of keys) dirtyPrefsRef.current.delete(k);
          },
          () => {
            // Leave the dirty flags set on failure so the next refresh
            // keeps the optimistic value. The user's next interaction
            // (or a retry of the same toggle) will reconverge.
          },
        );
      }
    },
    [],
  );

  // Optimistic-hide set: ids the user has just resolved client-side. Plain
  // useState (not widgetState) — should not survive an iframe remount or
  // persist across host re-invokes. Reconciled per-id against fresh
  // toolOutput below: keep an id while the server still lists it as open
  // (slow-write race), drop it once the server agrees it's gone OR has
  // moved it to handled_recent.
  const [optimisticallyHidden, setOptimisticallyHidden] = useState<
    Set<string>
  >(() => new Set());

  useEffect(() => {
    setOptimisticallyHidden((prev) => {
      if (prev.size === 0) return prev;
      // In team mode every scope contributes open ids; in solo mode this is
      // exactly the personal list. The reconciliation rule is unchanged
      // ("keep ids the server still considers open; drop ids the server has
      // moved to handled / removed"), but we widen the "still open" set so
      // a team-scoped mutation reconciles too.
      const stillOpen = new Set<string>();
      for (const a of data.actions) stillOpen.add(a.id);
      for (const t of data.teams) for (const a of t.actions) stillOpen.add(a.id);
      for (const v of data.leader_views)
        for (const a of v.actions) stillOpen.add(a.id);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (stillOpen.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data.actions, data.handled_recent, data.teams, data.leader_views]);

  const hideOptimistically = useCallback((id: string) => {
    setOptimisticallyHidden((s) => {
      if (s.has(id)) return s;
      const next = new Set(s);
      next.add(id);
      return next;
    });
  }, []);

  // When a feedback row expires (timer fires, or the user re-triggers the
  // same id), drop the feedback entry AND optimistically hide the row.
  // Why both, in this order: the slot-replacement contract is "feedback
  // takes the action card's slot for FEEDBACK_FADE_MS, then both the card
  // and the feedback are gone." If we hid the action immediately on
  // success, `filtered` would no longer contain the id and the feedback
  // would render at the bottom of the list (the orphan-feedback path)
  // instead of in the slot the user clicked.
  const expireFeedback = useCallback(
    (id: string) => {
      setFeedback((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      hideOptimistically(id);
    },
    [hideOptimistically],
  );

  const showFeedback = useCallback(
    (id: string, state: FeedbackState) => {
      setFeedback((prev) => ({ ...prev, [id]: state }));
      const timers = feedbackTimersRef.current;
      const existing = timers.get(id);
      if (existing) window.clearTimeout(existing);
      const handle = window.setTimeout(() => {
        timers.delete(id);
        expireFeedback(id);
      }, FEEDBACK_FADE_MS);
      timers.set(id, handle);
    },
    [expireFeedback],
  );

  // Cleanup all pending fade timers on unmount so we don't leak handles
  // across iframe remounts. (See briefing-learnings §1.12 — never leave
  // setTimeouts dangling when the host can re-render us at any time.)
  useEffect(() => {
    const timers = feedbackTimersRef.current;
    return () => {
      for (const handle of timers.values()) {
        window.clearTimeout(handle);
      }
      timers.clear();
    };
  }, []);

  // Skeleton: shown while no renderable data yet — gates on
  // hasAnyRenderableData per briefing-learnings §1.12.
  const hasAnyRenderableData =
    data.actions.length > 0 ||
    data.handled_recent.length > 0 ||
    data.bootstrap_mode ||
    data.error !== null;
  const isLoading = !toolOutput && !hasAnyRenderableData;

  // `visibleActions` is the source for both the rendered list AND the
  // count chips. We hide optimistic-hidden ids here. Feedback'd ids stay
  // in `visibleActions` so the row renders as a feedback row IN its slot
  // (the alternative — hiding immediately on success — pushes feedback to
  // the bottom of the list, the exact UX the v6.1.0 change was meant to
  // fix). The count chips below subtract feedback'd ids so "All · N" is
  // honest about what's still actionable.
  const visibleActions = useMemo(
    () => data.actions.filter((a) => !optimisticallyHidden.has(a.id)),
    [data.actions, optimisticallyHidden],
  );
  const visibleHandled = useMemo(
    () =>
      data.handled_recent.filter((h) => !optimisticallyHidden.has(h.id)),
    [data.handled_recent, optimisticallyHidden],
  );

  // Filter + sort helper. Pulled out of the original `filtered` memo so
  // each section in team mode can apply the same priority filter + sort
  // independently to its own action list. Solo mode still drives the
  // existing `filtered` memo below.
  //
  // P9 (9.3.0): also honors `prefs.show_snoozed` / `prefs.show_dismissed`
  // for personal preference filtering. Items with prefs.triage_state
  // snooze in the future are hidden unless `show_snoozed` is on; items
  // with a `dismissed_at` are hidden unless `show_dismissed` is on.
  // Sort honors prefs.sort over the legacy widgetState.sort.
  const sortKey: SortKey = prefs.sort;
  const now = nowMs();
  const applyFilterSort = useCallback(
    (actions: Action[]): Action[] => {
      const filteredByPriority =
        ui.priority_filter === 'all'
          ? actions
          : actions.filter((a) => a.priority === ui.priority_filter);
      const filteredByPrefs = filteredByPriority.filter((a) => {
        const state = effectivePersonalState(a, prefs);
        if (state.dismissed_at) {
          return prefs.show_dismissed;
        }
        const snoozedUntilMs = state.snoozed_until
          ? Date.parse(state.snoozed_until)
          : NaN;
        if (Number.isFinite(snoozedUntilMs) && snoozedUntilMs > now) {
          return prefs.show_snoozed;
        }
        return true;
      });
      const sorted = [...filteredByPrefs].sort((a, b) => {
        if (sortKey === 'priority') {
          const cmp = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
          if (cmp !== 0) return cmp;
          return (a.due_by ?? 'z').localeCompare(b.due_by ?? 'z');
        }
        if (sortKey === 'created') {
          const at = a.created_at ? Date.parse(a.created_at) : NaN;
          const bt = b.created_at ? Date.parse(b.created_at) : NaN;
          const av = Number.isFinite(at) ? (at as number) : -Infinity;
          const bv = Number.isFinite(bt) ? (bt as number) : -Infinity;
          return bv - av;
        }
        if (sortKey === 'team-then-priority') {
          const tcmp = (a.team_slug ?? '').localeCompare(b.team_slug ?? '');
          if (tcmp !== 0) return tcmp;
          return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        }
        if (sortKey === 'due-then-priority') {
          const dcmp = (a.due_by ?? 'z').localeCompare(b.due_by ?? 'z');
          if (dcmp !== 0) return dcmp;
          return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        }
        return (a.due_by ?? 'z').localeCompare(b.due_by ?? 'z');
      });
      return sorted;
    },
    [
      ui.priority_filter,
      prefs,
      sortKey,
      now,
    ],
  );

  // Solo path: `filtered` is the existing single list rendered under the
  // header. Stays defined in team mode too — the legacy `actions` field
  // carries personal-only data so this list is "My items" by definition.
  const filtered = useMemo(
    () => applyFilterSort(visibleActions),
    [visibleActions, applyFilterSort],
  );

  // Team-mode section lists. In solo mode these arrays stay empty and
  // every team-aware branch in the JSX collapses to nothing, leaving
  // the solo render exactly as it was in 9.0.0.
  //
  // P9 (9.3.0): apply strict-intersection filter (member's onboarding
  // picks ∩ item's relevance_classes, narrowed by any explicit chip
  // selection in `prefs.relevance_class_filters[teamSlug]`).
  // Team-filter prefs (`prefs.team_filters[slug] === 'hidden'`) hide a
  // section entirely. Legacy `ui.muted_team_slugs` is also honored for
  // back-compat with widgetState-only callers.
  const teamSectionLists = useMemo(() => {
    if (!data.team_mode) return [] as Array<{
      team_slug: string;
      display_name: string;
      visible: Action[];
      hasAny: boolean;
      hasMatchingButFiltered: boolean;
      member_relevance_classes: string[];
      selected_relevance_classes: string[];
      no_relevance_picks: boolean;
    }>;
    return data.teams
      .filter((t) => {
        if (ui.muted_team_slugs.includes(t.team_slug)) return false;
        if (prefs.team_filters[t.team_slug] === 'hidden') return false;
        return true;
      })
      .map((t) => {
        const visibleTeamActions = t.actions.filter(
          (a) => !optimisticallyHidden.has(a.id),
        );
        const memberClasses = t.member_relevance_classes;
        // Selected: user's explicit chip narrowing (defaults to member's full picks)
        const selectedClasses =
          prefs.relevance_class_filters[t.team_slug] ?? memberClasses;
        const intersected = visibleTeamActions.filter((a) =>
          passesStrictIntersection(
            a.relevance_classes ?? [],
            selectedClasses,
            memberClasses,
          ),
        );
        const visible = applyFilterSort(intersected);
        return {
          team_slug: t.team_slug,
          display_name: t.display_name,
          visible,
          hasAny: t.actions.length > 0,
          // hasMatchingButFiltered surfaces "Nothing matches this filter"
          // when the intersection has items but priority/show-toggle drops them.
          hasMatchingButFiltered:
            intersected.length > 0 && visible.length === 0,
          member_relevance_classes: memberClasses,
          selected_relevance_classes: selectedClasses,
          no_relevance_picks: memberClasses.length === 0,
        };
      });
  }, [
    data.team_mode,
    data.teams,
    ui.muted_team_slugs,
    prefs.team_filters,
    prefs.relevance_class_filters,
    optimisticallyHidden,
    applyFilterSort,
  ]);

  const leaderSectionLists = useMemo(() => {
    if (!data.team_mode) return [] as Array<{
      view_slug: string;
      display_name: string;
      visible: Action[];
      hasAny: boolean;
    }>;
    return data.leader_views
      .filter((v) => {
        if (ui.muted_view_slugs.includes(v.view_slug)) return false;
        if (prefs.view_filters[v.view_slug] === 'hidden') return false;
        return true;
      })
      .map((v) => {
        const visibleViewActions = v.actions.filter(
          (a) => !optimisticallyHidden.has(a.id),
        );
        return {
          view_slug: v.view_slug,
          display_name: v.display_name,
          visible: applyFilterSort(visibleViewActions),
          hasAny: v.actions.length > 0,
        };
      });
  }, [
    data.team_mode,
    data.leader_views,
    ui.muted_view_slugs,
    prefs.view_filters,
    optimisticallyHidden,
    applyFilterSort,
  ]);

  // Counts per priority filter chip. Excludes ids with active feedback —
  // a row showing "✓ Marked done" is no longer actionable, so counting it
  // toward "All · N" overstates the open queue.
  const priorityCounts = useMemo(() => {
    const counts = {
      all: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const a of visibleActions) {
      if (a.id in feedback) continue;
      counts.all += 1;
      counts[a.priority] += 1;
    }
    return counts;
  }, [visibleActions, feedback]);

  const setPriorityFilter = useCallback(
    (next: PriorityFilter) => {
      setWidgetState((prev) => ({ ...prev, priority_filter: next }));
    },
    [setWidgetState],
  );

  const setSort = useCallback(
    (next: SortKey) => {
      dirtyPrefsRef.current.add('sort');
      setPrefs((p) => ({ ...p, sort: next }));
      setWidgetState((prev) => ({ ...prev, sort: next }));
      clearDirtyAfter(
        callTool('agntux_core_save_triage_prefs', { sort: next }),
        'sort',
      );
    },
    [setWidgetState, callTool, clearDirtyAfter],
  );

  const setHandledExpanded = useCallback(
    (next: boolean) => {
      setWidgetState((prev) => ({ ...prev, handled_expanded: next }));
    },
    [setWidgetState],
  );

  // Toggle a team's visibility. Two-step persistence (P9 / 9.3.0):
  //   1. Optimistically patch the local prefs mirror so the UI updates
  //      synchronously. The dirty-set entry keeps the toggle through
  //      the MCP roundtrip without a flicker if a fresh payload
  //      arrives mid-call.
  //   2. Fire `agntux_core_save_triage_prefs` so the on-disk
  //      `triage-prefs.json` reflects the user's choice. The MCP call
  //      is fire-and-forget; the UI never blocks on it.
  //   3. Keep the legacy `widgetState.muted_team_slugs` in sync so
  //      existing tests and pre-9.3.0 host code that reads widgetState
  //      directly still see the same array. New code reads from
  //      `prefs.team_filters` directly.
  const toggleTeamMuted = useCallback(
    (team_slug: string) => {
      const wasHidden = prefs.team_filters[team_slug] === 'hidden';
      const nextState: 'shown' | 'hidden' = wasHidden ? 'shown' : 'hidden';
      const nextMuted = wasHidden
        ? ui.muted_team_slugs.filter((s) => s !== team_slug)
        : Array.from(new Set([...ui.muted_team_slugs, team_slug]));
      dirtyPrefsRef.current.add(`team_filters:${team_slug}`);
      setPrefs((p) => ({
        ...p,
        team_filters: { ...p.team_filters, [team_slug]: nextState },
      }));
      setWidgetState((prev) => ({ ...prev, muted_team_slugs: nextMuted }));
      clearDirtyAfter(
        callTool('agntux_core_save_triage_prefs', {
          muted_team_slugs: nextMuted,
          muted_view_slugs: ui.muted_view_slugs,
          team_filters: { [team_slug]: nextState },
        }),
        `team_filters:${team_slug}`,
      );
    },
    [
      prefs.team_filters,
      ui.muted_team_slugs,
      ui.muted_view_slugs,
      setWidgetState,
      callTool,
      clearDirtyAfter,
    ],
  );

  const toggleViewMuted = useCallback(
    (view_slug: string) => {
      const wasHidden = prefs.view_filters[view_slug] === 'hidden';
      const nextState: 'shown' | 'hidden' = wasHidden ? 'shown' : 'hidden';
      const nextMuted = wasHidden
        ? ui.muted_view_slugs.filter((s) => s !== view_slug)
        : Array.from(new Set([...ui.muted_view_slugs, view_slug]));
      dirtyPrefsRef.current.add(`view_filters:${view_slug}`);
      setPrefs((p) => ({
        ...p,
        view_filters: { ...p.view_filters, [view_slug]: nextState },
      }));
      setWidgetState((prev) => ({ ...prev, muted_view_slugs: nextMuted }));
      clearDirtyAfter(
        callTool('agntux_core_save_triage_prefs', {
          muted_team_slugs: ui.muted_team_slugs,
          muted_view_slugs: nextMuted,
          view_filters: { [view_slug]: nextState },
        }),
        `view_filters:${view_slug}`,
      );
    },
    [
      prefs.view_filters,
      ui.muted_team_slugs,
      ui.muted_view_slugs,
      setWidgetState,
      callTool,
      clearDirtyAfter,
    ],
  );

  // P9: toggle a relevance-class chip inside a team section. UI-only
  // refinement; this does NOT modify the member's `members/{user_slug}.md`
  // file (that's the onboarding-time authority — UI toggles are session
  // refinements). Persists to prefs.relevance_class_filters[teamSlug].
  // Default selected set is the member's full picks until the user
  // explicitly narrows it.
  const toggleRelevanceClassFilter = useCallback(
    (team_slug: string, relevance_class: string) => {
      const fallback =
        data.teams.find((t) => t.team_slug === team_slug)?.member_relevance_classes ?? [];
      const currentSelected =
        prefs.relevance_class_filters[team_slug] ?? fallback;
      const nextSelected = currentSelected.includes(relevance_class)
        ? currentSelected.filter((c) => c !== relevance_class)
        : [...currentSelected, relevance_class];
      dirtyPrefsRef.current.add(`relevance_class_filters:${team_slug}`);
      setPrefs((p) => ({
        ...p,
        relevance_class_filters: {
          ...p.relevance_class_filters,
          [team_slug]: nextSelected,
        },
      }));
      clearDirtyAfter(
        callTool('agntux_core_save_triage_prefs', {
          relevance_class_filters: { [team_slug]: nextSelected },
        }),
        `relevance_class_filters:${team_slug}`,
      );
    },
    [prefs.relevance_class_filters, data.teams, callTool, clearDirtyAfter],
  );

  // P9: show-done / show-snoozed / show-dismissed toggles.
  const togglePrefsBoolean = useCallback(
    (key: 'show_done' | 'show_snoozed' | 'show_dismissed') => {
      const nextVal = !prefs[key];
      dirtyPrefsRef.current.add(key);
      setPrefs((p) => ({ ...p, [key]: nextVal }));
      clearDirtyAfter(
        callTool('agntux_core_save_triage_prefs', { [key]: nextVal }),
        key,
      );
    },
    [prefs, callTool, clearDirtyAfter],
  );

  const handleExpand = useCallback((id: string, kind: ExpandedKind) => {
    setExpanded({ id, kind });
  }, []);

  const handleCollapse = useCallback(() => {
    setExpanded(null);
  }, []);

  // Tool-call wrappers.
  const runMutation = useCallback(
    async (
      id: string,
      tool: string,
      args: Record<string, unknown>,
      onSuccess?: () => void,
    ) => {
      setPendingId(id);
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      try {
        await callTool(tool, args);
        if (onSuccess) onSuccess();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Try again.';
        setRowErrors((prev) => ({ ...prev, [id]: message }));
      } finally {
        setPendingId(null);
      }
    },
    [callTool],
  );


  // Terminal-action handlers: on success, show feedback in the row's slot
  // and collapse any inline panel. We deliberately do NOT call
  // hideOptimistically here — that would remove the row from `filtered`
  // immediately and force the feedback row to render at the bottom (the
  // orphan-feedback path) instead of the slot. hideOptimistically fires
  // when the feedback fades, in expireFeedback.

  // Look up an action across every scope. Team-mode actions live in
  // `data.teams[].actions` / `data.leader_views[].actions`; the legacy
  // `data.actions` carries only personal in team mode. We search all
  // scopes so handlers triggered by id (the suggested-action regex
  // path) still find the row regardless of scope.
  const findActionAcrossScopes = useCallback(
    (id: string): Action | undefined => {
      const personal = data.actions.find((a) => a.id === id);
      if (personal) return personal;
      for (const t of data.teams) {
        const m = t.actions.find((a) => a.id === id);
        if (m) return m;
      }
      for (const v of data.leader_views) {
        const m = v.actions.find((a) => a.id === id);
        if (m) return m;
      }
      return undefined;
    },
    [data.actions, data.teams, data.leader_views],
  );

  // Decorate mutator-tool args with team_slug / view_slug when the action
  // belongs to a non-personal scope. In solo mode (or for personal rows
  // in team mode), no extra keys are added, so the tool call shape is
  // byte-identical to 9.0.0.
  const scopeArgs = useCallback(
    (action: Action | undefined): Record<string, string> => {
      if (!action || !action.scope_kind || action.scope_kind === 'personal') {
        return {};
      }
      if (action.scope_kind === 'team' && action.scope_slug) {
        return { team_slug: action.scope_slug };
      }
      if (action.scope_kind === 'leader' && action.scope_slug) {
        return { view_slug: action.scope_slug };
      }
      return {};
    },
    [],
  );

  // Mark-done writes status to the action file. For team / leader-view
  // scopes, includes user_slug + user_id so the team-wide
  // `done_by_user_slug` / `done_by_user_id` / `done_at` fields are
  // written and visible to every member after sync. Personal mark-done
  // remains a byte-identical call (no user_* args).
  const handleDone = useCallback(
    (id: string) => {
      const action = findActionAcrossScopes(id);
      const scope = scopeArgs(action);
      const args: Record<string, unknown> = {
        id,
        status: 'done',
        ...scope,
      };
      const isTeamOrLeader = 'team_slug' in scope || 'view_slug' in scope;
      if (isTeamOrLeader) {
        if (data.self_user_slug) args.user_slug = data.self_user_slug;
        if (data.self_user_id) args.user_id = data.self_user_id;
      }
      void runMutation(id, 'agntux_core_set_status', args, () => {
        setExpanded((cur) => (cur && cur.id === id ? null : cur));
        showFeedback(id, {
          kind: 'done',
          title: action?.title ?? '',
          message: 'Marked done',
        });
      });
    },
    [
      findActionAcrossScopes,
      runMutation,
      showFeedback,
      scopeArgs,
      data.self_user_slug,
      data.self_user_id,
    ],
  );

  // Snooze + dismiss in P9: write to triage-prefs.json (per-path
  // personal state) instead of the action file's frontmatter. This is
  // the migration described in personal schema 1.2.0 — the action
  // file's `snoozed_until` / `dismissed_at` fields are deprecated,
  // and team-scoped items don't have those fields at all (snooze /
  // dismiss are personal even for team rows). When `relative_path`
  // is absent on the row (legacy solo bundle), fall back to the old
  // frontmatter tools so the user still gets a working snooze /
  // dismiss.
  const handleSnoozeSubmit = useCallback(
    (id: string, untilISO: string) => {
      const action = findActionAcrossScopes(id);
      // Prefer the server-emitted `relative_path`; synthesize one from
      // (scope_kind, scope_slug, id) when an older mcp-server didn't
      // emit it. Critical: never fall through to the legacy
      // frontmatter snooze for team / leader scopes — that would
      // leak the snooze to every other member of the team after sync.
      // The legacy frontmatter path is reserved for personal-scope
      // solo bundles that emit rows without `relative_path` (pre-9.3.0).
      const path =
        action?.relative_path ?? synthesizeRelativePath(action, id);
      if (path) {
        // Optimistically patch the local prefs so the row hides
        // immediately, then save to the on-disk prefs file.
        dirtyPrefsRef.current.add(`triage_state:${path}`);
        setPrefs((p) => ({
          ...p,
          triage_state: {
            ...p.triage_state,
            [path]: {
              snoozed_until: untilISO,
              dismissed_at: p.triage_state[path]?.dismissed_at ?? null,
            },
          },
        }));
        void runMutation(
          id,
          'agntux_core_set_triage_pref',
          { path, snoozed_until: untilISO },
          () => {
            // Server now reflects the snooze; the dirty flag is no
            // longer needed to protect the optimistic value.
            dirtyPrefsRef.current.delete(`triage_state:${path}`);
            setExpanded((cur) => (cur && cur.id === id ? null : cur));
            const formatted = formatDueDate(untilISO, locale);
            showFeedback(id, {
              kind: 'snoozed',
              title: action?.title ?? '',
              message: formatted ? `Snoozed until ${formatted}` : 'Snoozed',
            });
          },
        );
        return;
      }
      // Legacy path: no relative_path → use the old frontmatter snooze.
      void runMutation(
        id,
        'agntux_core_snooze',
        { id, until: untilISO, ...scopeArgs(action) },
        () => {
          setExpanded((cur) => (cur && cur.id === id ? null : cur));
          const formatted = formatDueDate(untilISO, locale);
          showFeedback(id, {
            kind: 'snoozed',
            title: action?.title ?? '',
            message: formatted ? `Snoozed until ${formatted}` : 'Snoozed',
          });
        },
      );
    },
    [findActionAcrossScopes, runMutation, showFeedback, scopeArgs, locale],
  );

  const handleDismissSubmit = useCallback(
    (id: string, outcome: string, note: string) => {
      const action = findActionAcrossScopes(id);
      // Synthesize the path for team / leader scope when the older
      // mcp-server didn't emit `relative_path`. See handleSnoozeSubmit
      // for the rationale — keeps the personal-only dismiss semantic
      // intact for team-scoped rows.
      const path =
        action?.relative_path ?? synthesizeRelativePath(action, id);
      if (path) {
        // Personal dismiss → prefs only. The action file is untouched
        // so other team members still see the item.
        const dismissedAt = new Date().toISOString();
        dirtyPrefsRef.current.add(`triage_state:${path}`);
        setPrefs((p) => ({
          ...p,
          triage_state: {
            ...p.triage_state,
            [path]: {
              snoozed_until: p.triage_state[path]?.snoozed_until ?? null,
              dismissed_at: dismissedAt,
            },
          },
        }));
        void runMutation(
          id,
          'agntux_core_set_triage_pref',
          { path, dismissed_at: dismissedAt },
          () => {
            dirtyPrefsRef.current.delete(`triage_state:${path}`);
            setExpanded((cur) => (cur && cur.id === id ? null : cur));
            showFeedback(id, {
              kind: 'dismissed',
              title: action?.title ?? '',
              message: 'Dismissed',
            });
          },
        );
        // outcome + note are P5-era pattern-feedback signals that
        // belong on the action file body. We surface them by also
        // calling the legacy dismiss tool, but with a no-op status
        // transition — the body append remains useful even when the
        // primary state lives in prefs. The legacy call is
        // fire-and-forget; UI feedback comes from the prefs path.
        if (outcome) {
          const args: Record<string, unknown> = {
            id,
            outcome,
            ...scopeArgs(action),
          };
          if (note) args.outcome_note = note;
          void callTool('agntux_core_dismiss', args);
        }
        return;
      }
      // Legacy path: no relative_path → use the old frontmatter dismiss.
      const args: Record<string, unknown> = {
        id,
        outcome,
        ...scopeArgs(action),
      };
      if (note) args.outcome_note = note;
      void runMutation(id, 'agntux_core_dismiss', args, () => {
        setExpanded((cur) => (cur && cur.id === id ? null : cur));
        showFeedback(id, {
          kind: 'dismissed',
          title: action?.title ?? '',
          message: 'Dismissed',
        });
      });
    },
    [findActionAcrossScopes, runMutation, showFeedback, scopeArgs, callTool],
  );

  const handleDoSomethingElseSubmit = useCallback(
    (action: Action, userPrompt: string) => {
      // Build a context-rich prompt the host can act on without re-fetching
      // the action file. Keep the lead line stable so the host's tool-router
      // can short-circuit to the right lane.
      const lines: string[] = [
        'Please take the following action based on the action item below:',
        '',
        userPrompt,
        '',
        '---',
        `Action ID: ${action.id}`,
        `Title: ${action.title}`,
        `Priority: ${action.priority}`,
      ];
      if (action.reason_class) lines.push(`Reason class: ${action.reason_class}`);
      if (action.due_by) lines.push(`Due by: ${action.due_by}`);
      if (action.source) lines.push(`Source: ${action.source}`);
      if (action.created_at)
        lines.push(`Created at: ${action.created_at}`);
      if (action.related_entities.length > 0)
        lines.push(`Related entities: ${action.related_entities.join(', ')}`);
      if (action.summary) {
        lines.push('', 'Summary:', action.summary);
      }
      if (action.why_matters_excerpt) {
        lines.push('', 'Why it matters:', action.why_matters_excerpt);
      }
      if (action.personalization_fit_excerpt) {
        lines.push(
          '',
          'Personalization fit:',
          action.personalization_fit_excerpt,
        );
      }
      void sendFollowUpMessage(lines.join('\n'));
      setExpanded(null);
    },
    [sendFollowUpMessage],
  );

  const handleSuggested = useCallback(
    (action: SuggestedAction, actionId: string) => {
      // url wins over host_prompt: the host's openLink primitive opens the
      // target directly (browser / native client deep link) without routing
      // through the LLM. host_prompt is the legacy chat-mediated path and
      // remains the fallback for actions a plugin couldn't pre-resolve.
      if (action.url) {
        const target = action.url;
        openLink(target).catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : `Couldn't open ${target}.`;
          setRowErrors((prev) => ({ ...prev, [actionId]: message }));
        });
        return;
      }
      if (action.host_prompt) {
        for (const pattern of TERMINATING_PROMPT_PATTERNS) {
          const match = pattern.exec(action.host_prompt);
          if (match && match[1]) {
            hideOptimistically(match[1]);
            break;
          }
        }
        void sendFollowUpMessage(action.host_prompt);
      }
    },
    [openLink, sendFollowUpMessage, hideOptimistically],
  );

  const handleStopRaising = useCallback(
    (action: Action) => {
      const prompt = `ux: Use the agntux-core plugin to engage the user-feedback subagent so the user can capture a \`# Never raise\` rule for items like ${action.id} (reason_class: ${action.reason_class || 'unknown'}, source: ${action.source ?? 'unknown'}).`;
      void sendFollowUpMessage(prompt);
      setExpanded((cur) => (cur && cur.id === action.id ? null : cur));
      showFeedback(action.id, {
        kind: 'stopped-raising',
        title: action.title,
        message: 'Asked AgntUX to stop raising items like this',
      });
    },
    [sendFollowUpMessage, showFeedback],
  );

  const handleOnboard = useCallback(() => {
    void sendFollowUpMessage('/agntux onboard');
  }, [sendFollowUpMessage]);

  // ---- Render branches ----

  if (isLoading) {
    return (
      <div
        className="flex h-full flex-col bg-background p-4"
        data-testid="loading-skeleton"
      >
        <div className="mb-4 h-5 w-24 animate-pulse rounded-md bg-muted" />
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-md border border-border bg-card p-3"
            >
              <div className="mb-2 h-4 w-3/5 animate-pulse rounded-md bg-muted" />
              <div className="mb-1 h-3 w-full animate-pulse rounded-md bg-muted" />
              <div className="h-3 w-4/5 animate-pulse rounded-md bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (data.error === 'actions_index_missing') {
    return (
      <div className="flex h-full flex-col bg-background">
        <ActionsIndexMissing onOnboard={handleOnboard} />
      </div>
    );
  }
  if (data.bootstrap_mode) {
    return (
      <div className="flex h-full flex-col bg-background">
        <BootstrapEmpty />
      </div>
    );
  }

  // Render strategy: walk the filtered list. For each id, if a feedback
  // state exists, render FeedbackRow in that slot — keeps the user's place
  // even after we've optimistically hidden the row from `visibleActions`.
  // Feedback ids that no longer correspond to a previously-visible row
  // (rare — e.g., the action was already gone before feedback fired) are
  // appended after the visible items so the user still sees them.
  //
  // In team mode every section's render goes through the same path: each
  // section's `visible` list is walked, IDs that have feedback show a
  // FeedbackRow in their slot, the rest render an ActionCard. Orphan
  // feedback (a successful mutation whose id we can't find in any list)
  // surfaces once at the bottom of the entire body, not per-section, so
  // the user sees it even if the row's underlying scope has disappeared.
  const allRenderedIds = new Set<string>(filtered.map((a) => a.id));
  for (const s of teamSectionLists)
    for (const a of s.visible) allRenderedIds.add(a.id);
  for (const s of leaderSectionLists)
    for (const a of s.visible) allRenderedIds.add(a.id);
  const orphanFeedbackIds = Object.keys(feedback).filter(
    (id) => !allRenderedIds.has(id),
  );

  // Single source of truth for rendering an action card or its feedback
  // row. Used by every section in team mode and by the legacy single
  // list in solo mode.
  const renderActionOrFeedback = (a: Action) => {
    const fb = feedback[a.id];
    if (fb) return <FeedbackRow key={a.id} id={a.id} state={fb} />;
    const expandedKind =
      expanded && expanded.id === a.id ? expanded.kind : null;
    return (
      <ActionCard
        key={a.id}
        action={a}
        pending={pendingId === a.id}
        rowError={rowErrors[a.id] ?? null}
        expandedKind={expandedKind}
        onSuggested={handleSuggested}
        onExpand={handleExpand}
        onCollapse={handleCollapse}
        onDone={handleDone}
        onSnoozeSubmit={handleSnoozeSubmit}
        onDismissSubmit={handleDismissSubmit}
        onDoSomethingElseSubmit={handleDoSomethingElseSubmit}
        onStopRaising={handleStopRaising}
        locale={locale}
      />
    );
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-background text-foreground"
      aria-busy={isStreaming ? 'true' : 'false'}
    >
      <fieldset disabled={isStreaming} className="contents">
        <header className="sticky top-0 z-[5] flex flex-col gap-3 border-b border-border bg-background px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AgntuxLogo height={20} />
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <h2
                className="m-0 text-base font-semibold tracking-tight"
                data-testid="triage-title"
              >
                Action Item Triage
              </h2>
            </div>
            {data.last_updated_at && (
              <span className="text-xs text-slate-400">
                Updated{' '}
                <time dateTime={data.last_updated_at}>
                  {formatRelative(data.last_updated_at, locale)}
                </time>
              </span>
            )}
          </div>
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Filter actions by priority"
          >
            <FilterChip
              label={`All · ${priorityCounts.all}`}
              pressed={ui.priority_filter === 'all'}
              onClick={() => setPriorityFilter('all')}
              testId="filter-all"
            />
            <FilterChip
              label={`High · ${priorityCounts.high}`}
              pressed={ui.priority_filter === 'high'}
              onClick={() => setPriorityFilter('high')}
              testId="filter-high"
            />
            <FilterChip
              label={`Medium · ${priorityCounts.medium}`}
              pressed={ui.priority_filter === 'medium'}
              onClick={() => setPriorityFilter('medium')}
              testId="filter-medium"
            />
            <FilterChip
              label={`Low · ${priorityCounts.low}`}
              pressed={ui.priority_filter === 'low'}
              onClick={() => setPriorityFilter('low')}
              testId="filter-low"
            />
            <span className="ml-auto" />
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="sr-only">Sort actions by</span>
              Sort
              <select
                value={prefs.sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="sort-select"
                aria-label="Sort actions by"
              >
                {SORT_VALUES.map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {data.team_mode && (data.teams.length > 0 || data.leader_views.length > 0) && (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Show or hide team and leader-view sections"
              data-testid="team-filter-bar"
            >
              <span className="text-[0.6875rem] uppercase tracking-wider text-slate-400">
                Scopes
              </span>
              {data.teams.map((t) => (
                <MuteChip
                  key={`team-${t.team_slug}`}
                  label={t.display_name}
                  visible={!ui.muted_team_slugs.includes(t.team_slug)}
                  onClick={() => toggleTeamMuted(t.team_slug)}
                  testId={`team-mute-${t.team_slug}`}
                />
              ))}
              {data.leader_views.map((v) => (
                <MuteChip
                  key={`view-${v.view_slug}`}
                  label={v.display_name}
                  visible={!ui.muted_view_slugs.includes(v.view_slug)}
                  onClick={() => toggleViewMuted(v.view_slug)}
                  testId={`view-mute-${v.view_slug}`}
                />
              ))}
            </div>
          )}
        </header>
        <div
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 pb-6"
          role="list"
          aria-label="Open action items"
        >
          {data.team_mode ? (
            <>
              {/* "My items" section. Always rendered in team mode, even
                  empty, so the user has a stable landmark for personal
                  items in the layout. */}
              <SectionHeader
                title="My items"
                testId="section-header-personal"
                count={filtered.length}
              />
              {filtered.length === 0 && data.actions.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No personal items yet.
                </p>
              )}
              {filtered.length === 0 &&
                data.actions.length > 0 &&
                Object.keys(feedback).length === 0 && (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    Nothing matches this filter.
                  </p>
                )}
              {filtered.map(renderActionOrFeedback)}
              {teamSectionLists.map((s) => (
                <Fragment key={`team-section-${s.team_slug}`}>
                  <SectionHeader
                    title={s.display_name}
                    testId={`section-header-team-${s.team_slug}`}
                    count={s.visible.length}
                  />
                  {/* P9: relevance-class filter chips inside each team
                      section, pre-selected from the member's onboarding
                      picks. Hidden when the member has no picks (the
                      empty state below covers that case). Toggling a
                      chip does NOT modify the member file — it's a
                      session refinement persisted in
                      prefs.relevance_class_filters[teamSlug]. */}
                  {s.member_relevance_classes.length > 0 && (
                    <div
                      className="flex flex-wrap items-center gap-2 px-1"
                      role="group"
                      aria-label={`Relevance classes for ${s.display_name}`}
                      data-testid={`relevance-filter-bar-${s.team_slug}`}
                    >
                      <span className="text-[0.6875rem] uppercase tracking-wider text-slate-400">
                        Classes
                      </span>
                      {s.member_relevance_classes.map((c) => (
                        <RelevanceClassChip
                          key={`${s.team_slug}-rc-${c}`}
                          label={c}
                          pressed={s.selected_relevance_classes.includes(c)}
                          onClick={() =>
                            toggleRelevanceClassFilter(s.team_slug, c)
                          }
                          testId={`relevance-chip-${s.team_slug}-${c}`}
                        />
                      ))}
                    </div>
                  )}
                  {/* P9: "Set your relevance picks" CTA when the
                      member hasn't onboarded for this team yet. The CTA
                      shows BEFORE the item list so the user sees it
                      without scrolling past their items. */}
                  {s.no_relevance_picks && (
                    <p
                      className="px-2 py-3 text-center text-xs text-muted-foreground"
                      data-testid={`empty-no-picks-${s.team_slug}`}
                    >
                      Set your relevance picks for {s.display_name} in{' '}
                      <code className="text-foreground">
                        /agntux-teams onboard:member {s.team_slug}
                      </code>
                      .
                    </p>
                  )}
                  {s.visible.length === 0 && (
                    <p
                      className="px-2 py-3 text-center text-xs text-muted-foreground"
                      data-testid={`empty-team-${s.team_slug}`}
                    >
                      {s.hasMatchingButFiltered
                        ? 'Nothing matches this filter.'
                        : s.hasAny
                        ? `All caught up for ${s.display_name}.`
                        : 'No items for this team yet.'}
                    </p>
                  )}
                  {s.visible.map(renderActionOrFeedback)}
                </Fragment>
              ))}
              {leaderSectionLists.map((s) => (
                <Fragment key={`leader-section-${s.view_slug}`}>
                  <SectionHeader
                    title={s.display_name}
                    testId={`section-header-leader-${s.view_slug}`}
                    count={s.visible.length}
                  />
                  {s.visible.length === 0 && (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                      {s.hasAny
                        ? 'Nothing matches this filter.'
                        : 'No items for this leader view yet.'}
                    </p>
                  )}
                  {s.visible.map(renderActionOrFeedback)}
                </Fragment>
              ))}
              {/* P9: bottom "Show done / snoozed / dismissed" toggles —
                  surface the items the strict-intersection filter is
                  hiding. The toggles persist to prefs.show_done /
                  prefs.show_snoozed / prefs.show_dismissed. */}
              <div
                className="mt-2 flex flex-wrap items-center justify-center gap-3 border-t border-dashed border-border pt-3 text-xs text-muted-foreground"
                role="group"
                aria-label="Visibility toggles"
                data-testid="show-toggles-bar"
              >
                <ShowToggle
                  label="Show done"
                  pressed={prefs.show_done}
                  onClick={() => togglePrefsBoolean('show_done')}
                  testId="toggle-show-done"
                />
                <ShowToggle
                  label="Show snoozed"
                  pressed={prefs.show_snoozed}
                  onClick={() => togglePrefsBoolean('show_snoozed')}
                  testId="toggle-show-snoozed"
                />
                <ShowToggle
                  label="Show dismissed"
                  pressed={prefs.show_dismissed}
                  onClick={() => togglePrefsBoolean('show_dismissed')}
                  testId="toggle-show-dismissed"
                />
              </div>
            </>
          ) : (
            <>
              {filtered.length === 0 &&
                data.actions.length > 0 &&
                Object.keys(feedback).length === 0 && (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    Nothing matches this filter.
                  </p>
                )}
              {filtered.map(renderActionOrFeedback)}
            </>
          )}
          {orphanFeedbackIds.map((id) => (
            <FeedbackRow
              key={`orphan-${id}`}
              id={id}
              state={feedback[id]}
            />
          ))}
          {data.counts.truncated && (
            <div className="rounded-md border border-border bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
              More items available — ask in chat for the full list.
            </div>
          )}
          {visibleHandled.length > 0 && (
            <HandledAccordion
              items={visibleHandled}
              counts={data.counts}
              expanded={ui.handled_expanded}
              setExpanded={setHandledExpanded}
              locale={locale}
            />
          )}
        </div>
      </fieldset>
    </div>
  );
}

// Mute-chip for a team or leader-view. Pressed === visible (default);
// un-pressed === muted (excluded from the rendered list). Mirrors the
// data-direction of the priority filter chips so the visual language is
// consistent across the header (pressed = active filter). The
// `aria-pressed` semantics are flipped relative to the priority chips —
// "is this section currently shown?" — so screen readers describe state,
// not intent.
function MuteChip({
  label,
  visible,
  onClick,
  testId,
}: {
  label: string;
  visible: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={visible}
      onClick={onClick}
      className={
        visible
          ? 'rounded-full border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs text-indigo-800 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          : 'rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground line-through hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      }
      data-testid={testId}
    >
      {label}
    </button>
  );
}

// Section header used inside the team-mode body to group action cards
// under "My items" / each team / each leader view. Solo mode never
// renders this — the legacy single-list layout is preserved unchanged.
function SectionHeader({
  title,
  testId,
  count,
}: {
  title: string;
  testId: string;
  count: number;
}) {
  return (
    <div
      className="-mb-1 mt-1 flex items-baseline justify-between border-b border-dashed border-border px-1 pb-1"
      data-testid={testId}
    >
      <h3 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-foreground">
        {title}
      </h3>
      <span className="text-[0.6875rem] text-slate-400">
        {count} {count === 1 ? 'item' : 'items'}
      </span>
    </div>
  );
}

function FilterChip({
  label,
  pressed,
  onClick,
  testId,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={
        pressed
          ? 'rounded-full border border-foreground bg-foreground px-2.5 py-1 text-xs text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          : 'rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      }
      data-testid={testId}
    >
      {label}
    </button>
  );
}

// P9 (9.3.0): relevance-class chip inside a team section. Pressed
// means "this class is in the selected set"; the strict-intersection
// filter renders an item iff its `relevance_classes` intersects the
// selected set. Press-toggle adds / removes the class from the
// selection; it does NOT modify the member's onboarding file.
function RelevanceClassChip({
  label,
  pressed,
  onClick,
  testId,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={
        pressed
          ? 'rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[0.6875rem] text-indigo-800 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          : 'rounded-full border border-border bg-card px-2 py-0.5 text-[0.6875rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      }
      data-testid={testId}
    >
      {label}
    </button>
  );
}

// P9: "Show done / snoozed / dismissed" toggles at the bottom of the
// team-mode body. Single-state buttons — pressed reveals the hidden
// category. Aria-pressed describes the toggle state.
function ShowToggle({
  label,
  pressed,
  onClick,
  testId,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={
        pressed
          ? 'rounded-full border border-foreground bg-foreground px-2.5 py-1 text-xs text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          : 'rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      }
      data-testid={testId}
    >
      {label}
    </button>
  );
}

interface HandledAccordionProps {
  items: HandledAction[];
  counts: Counts;
  expanded: boolean;
  setExpanded: (next: boolean) => void;
  locale: string;
}

function HandledAccordion({
  items,
  expanded,
  setExpanded,
  locale,
}: HandledAccordionProps) {
  const doneCount = items.filter((i) => i.status === 'done').length;
  const dismissedCount = items.filter((i) => i.status === 'dismissed').length;
  return (
    <div className="mt-2 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="handled-list"
        className="flex w-full items-center gap-2 rounded-sm py-1 text-left text-[0.8125rem] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="handled-toggle"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={`h-3.5 w-3.5 transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        Recently handled · Done {doneCount} / Dismissed {dismissedCount} (last 7 days)
      </button>
      {expanded && (
        <div
          id="handled-list"
          className="mt-2 flex flex-col gap-2"
          data-testid="handled-list"
        >
          {items.map((h) => (
            <div
              key={h.id}
              className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-[0.8125rem] text-muted-foreground"
            >
              <StatusBadge status={h.status} outcome={h.outcome} />
              <span className="flex-1 font-medium text-foreground">
                {h.title}
              </span>
              <span
                className="text-[0.6875rem] text-slate-400"
                title={h.outcome ? `Outcome: ${h.outcome}` : undefined}
              >
                {h.outcome ? `${h.outcome} · ` : ''}
                <time dateTime={h.handled_at}>
                  {formatRelative(h.handled_at, locale)}
                </time>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Re-export the parser + DEFAULT_WIDGET_STATE for tests.
export { parsePayload, DEFAULT_WIDGET_STATE };
export type { TriageData, Action, HandledAction, Counts, SuggestedAction };
