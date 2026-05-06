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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  safeArray,
  safeBoolean,
  safeEnum,
  safeNumber,
  safeObject,
  safeString,
} from '../lib/safe-accessors';
import { AgntuxLogo } from './agntux-logo';
import { Spinner } from './spinner';

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
// dropdown option (replaces the priority↔due toggle).
const SORT_VALUES = ['priority', 'due', 'created'] as const;
type SortKey = (typeof SORT_VALUES)[number];

const SORT_LABELS: Record<SortKey, string> = {
  priority: 'Priority',
  due: 'Due date',
  created: 'Most recently created',
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

interface TriageData {
  actions: Action[];
  handled_recent: HandledAction[];
  counts: Counts;
  last_updated_at: string;
  bootstrap_mode: boolean;
  error: ErrorKind | null;
}

interface WidgetUiState {
  priority_filter: PriorityFilter;
  sort: SortKey;
  hide_done: boolean;
  handled_expanded: boolean;
}

const DEFAULT_WIDGET_STATE: WidgetUiState = {
  priority_filter: 'all',
  sort: 'priority',
  hide_done: false,
  handled_expanded: false,
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
  return {
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
  return {
    actions: safeArray<unknown>(payload.actions)
      .map(normalizeAction)
      .filter((a) => a.id),
    handled_recent: safeArray<unknown>(payload.handled_recent)
      .map(normalizeHandled)
      .filter((h) => h.id),
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

  return (
    <article
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-sm"
      role="listitem"
      aria-labelledby={titleId}
      data-testid={`action-card-${action.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <PriorityPill priority={action.priority} />
        <ReasonBadge reasonClass={action.reason_class} />
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
        Run /agntux-onboard
      </button>
    </div>
  );
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
      const stillOpen = new Set(data.actions.map((a) => a.id));
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
  }, [data.actions, data.handled_recent]);

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

  // Filter + sort.
  const filtered = useMemo(() => {
    const filteredByPriority =
      ui.priority_filter === 'all'
        ? visibleActions
        : visibleActions.filter((a) => a.priority === ui.priority_filter);
    const filteredByDone = ui.hide_done
      ? filteredByPriority.filter((a) => a.status !== 'snoozed' || true)
      : filteredByPriority; // hide_done currently affects handled list, retained for future
    const sorted = [...filteredByDone].sort((a, b) => {
      if (ui.sort === 'priority') {
        const cmp = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (cmp !== 0) return cmp;
        return (a.due_by ?? 'z').localeCompare(b.due_by ?? 'z');
      }
      if (ui.sort === 'created') {
        // Most recently created first; null/missing values sort last.
        const at = a.created_at ? Date.parse(a.created_at) : NaN;
        const bt = b.created_at ? Date.parse(b.created_at) : NaN;
        const av = Number.isFinite(at) ? (at as number) : -Infinity;
        const bv = Number.isFinite(bt) ? (bt as number) : -Infinity;
        return bv - av;
      }
      // 'due'
      return (a.due_by ?? 'z').localeCompare(b.due_by ?? 'z');
    });
    return sorted;
  }, [visibleActions, ui.priority_filter, ui.hide_done, ui.sort]);

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
      setWidgetState((prev) => ({ ...prev, sort: next }));
    },
    [setWidgetState],
  );

  const setHandledExpanded = useCallback(
    (next: boolean) => {
      setWidgetState((prev) => ({ ...prev, handled_expanded: next }));
    },
    [setWidgetState],
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

  const handleDone = useCallback(
    (id: string) => {
      const action = data.actions.find((a) => a.id === id);
      void runMutation(
        id,
        'agntux_core_set_status',
        { id, status: 'done' },
        () => {
          setExpanded((cur) => (cur && cur.id === id ? null : cur));
          showFeedback(id, {
            kind: 'done',
            title: action?.title ?? '',
            message: 'Marked done',
          });
        },
      );
    },
    [data.actions, runMutation, showFeedback],
  );

  const handleSnoozeSubmit = useCallback(
    (id: string, untilISO: string) => {
      const action = data.actions.find((a) => a.id === id);
      void runMutation(
        id,
        'agntux_core_snooze',
        { id, until: untilISO },
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
    [data.actions, runMutation, showFeedback, locale],
  );

  const handleDismissSubmit = useCallback(
    (id: string, outcome: string, note: string) => {
      const action = data.actions.find((a) => a.id === id);
      const args: Record<string, unknown> = { id, outcome };
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
    [data.actions, runMutation, showFeedback],
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
    void sendFollowUpMessage('/agntux-onboard');
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
  const filteredIds = new Set(filtered.map((a) => a.id));
  const orphanFeedbackIds = Object.keys(feedback).filter(
    (id) => !filteredIds.has(id),
  );

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
                value={ui.sort}
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
        </header>
        <div
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 pb-6"
          role="list"
          aria-label="Open action items"
        >
          {filtered.length === 0 &&
            data.actions.length > 0 &&
            Object.keys(feedback).length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                Nothing matches this filter.
              </p>
            )}
          {filtered.map((a) => {
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
          })}
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
