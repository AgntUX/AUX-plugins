/**
 * Triage MainComponent
 *
 * Inline-budget MCP App for AgntUX action-item triage. Rendering rules are
 * inherited from briefing-learnings.md §1: every field defaults defensively
 * (parsePayload + safe-accessors), every external link goes through
 * openLink (suggested actions with a `url` dispatch through the host's
 * openLink primitive; ones with only `host_prompt` fall back to
 * sendFollowUpMessage), every interactive control is gated by
 * <fieldset disabled={isStreaming}>, modals use ScrollableModal.
 *
 * Source-agnostic: this component never branches on which plugin authored an
 * action. Reason-class styling falls back to a neutral default for unknown
 * classes; `source` is displayed as plain text (no icons, no per-source UX).
 */

import { useCallback, useMemo, useState } from 'react';
import {
  safeArray,
  safeBoolean,
  safeEnum,
  safeNumber,
  safeObject,
  safeString,
} from '../lib/safe-accessors';
import { ScrollableModal } from './scrollable-modal';
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

const SORT_VALUES = ['priority', 'due'] as const;
type SortKey = (typeof SORT_VALUES)[number];

const DISMISS_OUTCOMES = [
  'completed-externally',
  'noise',
  'irrelevant',
  'other',
] as const;
type DismissOutcome = (typeof DISMISS_OUTCOMES)[number];

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

// =============================================================================
// Sub-components
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

interface ActionCardProps {
  action: Action;
  pending: boolean;
  rowError: string | null;
  onSuggested: (action: SuggestedAction, actionId: string) => void;
  onDetails: (id: string) => void;
  onSnoozeOpen: (id: string) => void;
  onDismissOpen: (id: string) => void;
  onDone: (id: string) => void;
  locale: string;
}

const MAX_ENTITIES_INLINE = 6;
const MAX_SUGGESTED_INLINE = 6;

function ActionCard({
  action,
  pending,
  rowError,
  onSuggested,
  onDetails,
  onSnoozeOpen,
  onDismissOpen,
  onDone,
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
          onClick={() => onDetails(action.id)}
          className="rounded-md px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Expand details for ${action.title}`}
          data-testid={`details-${action.id}`}
        >
          Details
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
          onClick={() => onSnoozeOpen(action.id)}
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          data-testid={`snooze-${action.id}`}
        >
          Snooze
        </button>
        <button
          type="button"
          onClick={() => onDismissOpen(action.id)}
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-[0.8125rem] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
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
    </article>
  );
}

// =============================================================================
// Modals
// =============================================================================

interface DetailModalProps {
  action: Action;
  pending: boolean;
  rowError: string | null;
  onClose: () => void;
  onSuggested: (action: SuggestedAction, actionId: string) => void;
  onSnoozeOpen: (id: string) => void;
  onDismissOpen: (id: string) => void;
  onDone: (id: string) => void;
  onStopRaising: (action: Action) => void;
  locale: string;
}

function DetailModal({
  action,
  pending,
  rowError,
  onClose,
  onSuggested,
  onSnoozeOpen,
  onDismissOpen,
  onDone,
  onStopRaising,
}: DetailModalProps) {
  return (
    <ScrollableModal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <PriorityPill priority={action.priority} />
          <span className="text-sm font-semibold leading-snug">
            {action.title}
          </span>
        </span>
      }
      footer={
        <>
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
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {action.why_matters_excerpt && (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Why this matters
            </h4>
            <p className="whitespace-pre-line text-[0.8125rem] leading-relaxed text-muted-foreground">
              {action.why_matters_excerpt}
            </p>
          </section>
        )}
        {action.personalization_fit_excerpt && (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Personalization fit
            </h4>
            <p className="whitespace-pre-line text-[0.8125rem] leading-relaxed text-muted-foreground">
              {action.personalization_fit_excerpt}
            </p>
          </section>
        )}
        {action.suggested_actions.length > 0 && (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Suggested actions
            </h4>
            <div className="flex flex-wrap gap-2">
              {action.suggested_actions.map((sa, idx) => (
                <button
                  key={`detail-sa-${idx}`}
                  type="button"
                  onClick={() => onSuggested(sa, action.id)}
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
            </div>
          </section>
        )}
        {action.related_entities.length > 0 && (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Related entities
            </h4>
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
      </div>
    </ScrollableModal>
  );
}

interface SnoozeModalProps {
  action: Action;
  pending: boolean;
  rowError: string | null;
  onClose: () => void;
  onSubmit: (id: string, untilISO: string) => void;
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

function SnoozeModal({
  action,
  pending,
  rowError,
  onClose,
  onSubmit,
}: SnoozeModalProps) {
  const [pickedISO, setPickedISO] = useState<string>(nowPlus24hISO());
  const localValue = toLocalDatetimeInputValue(pickedISO);
  const submit = () => onSubmit(action.id, pickedISO);
  return (
    <ScrollableModal
      open
      onClose={onClose}
      title="Snooze action"
      footer={
        <>
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
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">{truncate(action.title, 70)}</strong>{' '}
          will reappear when the snooze ends.
        </p>
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Quick presets
          </h4>
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
        </section>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="snooze-until"
            className="text-xs font-medium text-muted-foreground"
          >
            Custom date &amp; time
          </label>
          <input
            id="snooze-until"
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
      </div>
    </ScrollableModal>
  );
}

interface DismissModalProps {
  action: Action;
  pending: boolean;
  rowError: string | null;
  onClose: () => void;
  onSubmit: (id: string, outcome: string, note: string) => void;
}

function DismissModal({
  action,
  pending,
  rowError,
  onClose,
  onSubmit,
}: DismissModalProps) {
  const [outcome, setOutcome] = useState<DismissOutcome>('completed-externally');
  const [note, setNote] = useState<string>('');
  const submit = () => onSubmit(action.id, outcome, note.trim());
  return (
    <ScrollableModal
      open
      onClose={onClose}
      title="Dismiss action"
      footer={
        <>
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
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          Capturing why you dismissed{' '}
          <strong className="text-foreground">
            {truncate(action.title, 70)}
          </strong>{' '}
          helps AgntUX learn what's signal vs noise for you.
        </p>
        <fieldset
          className="flex flex-col gap-2"
          aria-labelledby="dismiss-outcome-label"
        >
          <span
            id="dismiss-outcome-label"
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
            htmlFor="dismiss-note"
            className="text-xs font-medium text-muted-foreground"
          >
            Note (optional)
          </label>
          <textarea
            id="dismiss-note"
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
      </div>
    </ScrollableModal>
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
        name="dismiss-outcome"
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
  const [detailId, setDetailId] = useState<string | null>(null);
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const [dismissId, setDismissId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // Skeleton: shown while no renderable data yet — gates on
  // hasAnyRenderableData per briefing-learnings §1.12.
  const hasAnyRenderableData =
    data.actions.length > 0 ||
    data.handled_recent.length > 0 ||
    data.bootstrap_mode ||
    data.error !== null;
  const isLoading = !toolOutput && !hasAnyRenderableData;

  // Filter + sort.
  const filtered = useMemo(() => {
    const filteredByPriority =
      ui.priority_filter === 'all'
        ? data.actions
        : data.actions.filter((a) => a.priority === ui.priority_filter);
    const filteredByDone = ui.hide_done
      ? filteredByPriority.filter((a) => a.status !== 'snoozed' || true)
      : filteredByPriority; // hide_done currently affects handled list, retained for future
    const sorted = [...filteredByDone].sort((a, b) => {
      if (ui.sort === 'priority') {
        const cmp = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (cmp !== 0) return cmp;
        return (a.due_by ?? 'z').localeCompare(b.due_by ?? 'z');
      }
      // 'due'
      return (a.due_by ?? 'z').localeCompare(b.due_by ?? 'z');
    });
    return sorted;
  }, [data.actions, ui.priority_filter, ui.hide_done, ui.sort]);

  // Counts per priority filter chip.
  const priorityCounts = useMemo(() => {
    const counts = { all: data.actions.length, high: 0, medium: 0, low: 0 };
    for (const a of data.actions) counts[a.priority] += 1;
    return counts;
  }, [data.actions]);

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

  const handleDone = useCallback(
    (id: string) => {
      void runMutation(id, 'set_status', { id, status: 'done' });
    },
    [runMutation],
  );

  const handleSnoozeSubmit = useCallback(
    (id: string, untilISO: string) => {
      void runMutation(id, 'snooze', { id, until: untilISO }, () => {
        setSnoozeId(null);
      });
    },
    [runMutation],
  );

  const handleDismissSubmit = useCallback(
    (id: string, outcome: string, note: string) => {
      const args: Record<string, unknown> = { id, outcome };
      if (note) args.outcome_note = note;
      void runMutation(id, 'dismiss', args, () => {
        setDismissId(null);
      });
    },
    [runMutation],
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
        void sendFollowUpMessage(action.host_prompt);
      }
    },
    [openLink, sendFollowUpMessage],
  );

  const handleStopRaising = useCallback(
    (action: Action) => {
      const prompt = `ux: Use the agntux-core plugin to engage the user-feedback subagent so the user can capture a \`# Never raise\` rule for items like ${action.id} (reason_class: ${action.reason_class || 'unknown'}, source: ${action.source ?? 'unknown'}).`;
      void sendFollowUpMessage(prompt);
      setDetailId(null);
    },
    [sendFollowUpMessage],
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

  const detailAction = detailId
    ? data.actions.find((a) => a.id === detailId) ?? null
    : null;
  const snoozeAction = snoozeId
    ? data.actions.find((a) => a.id === snoozeId) ?? null
    : null;
  const dismissAction = dismissId
    ? data.actions.find((a) => a.id === dismissId) ?? null
    : null;

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-background text-foreground"
      aria-busy={isStreaming ? 'true' : 'false'}
    >
      <fieldset disabled={isStreaming} className="contents">
        <header className="sticky top-0 z-[5] flex flex-col gap-3 border-b border-border bg-background px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-base font-semibold tracking-tight">
              Triage
            </h2>
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
            <FilterChip
              label={`Sort · ${ui.sort === 'priority' ? 'priority' : 'due date'}`}
              pressed={false}
              onClick={() =>
                setSort(ui.sort === 'priority' ? 'due' : 'priority')
              }
              testId="sort-toggle"
            />
          </div>
        </header>
        <div
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 pb-6"
          role="list"
          aria-label="Open action items"
        >
          {filtered.length === 0 && data.actions.length > 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Nothing matches this filter.
            </p>
          )}
          {filtered.map((a) => (
            <ActionCard
              key={a.id}
              action={a}
              pending={pendingId === a.id}
              rowError={rowErrors[a.id] ?? null}
              onSuggested={handleSuggested}
              onDetails={setDetailId}
              onSnoozeOpen={setSnoozeId}
              onDismissOpen={setDismissId}
              onDone={handleDone}
              locale={locale}
            />
          ))}
          {data.counts.truncated && (
            <div className="rounded-md border border-border bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
              More items available — ask in chat for the full list.
            </div>
          )}
          {data.handled_recent.length > 0 && (
            <HandledAccordion
              items={data.handled_recent}
              counts={data.counts}
              expanded={ui.handled_expanded}
              setExpanded={setHandledExpanded}
              locale={locale}
            />
          )}
        </div>
      </fieldset>

      {detailAction && (
        <DetailModal
          action={detailAction}
          pending={pendingId === detailAction.id}
          rowError={rowErrors[detailAction.id] ?? null}
          onClose={() => setDetailId(null)}
          onSuggested={handleSuggested}
          onSnoozeOpen={(id) => {
            setDetailId(null);
            setSnoozeId(id);
          }}
          onDismissOpen={(id) => {
            setDetailId(null);
            setDismissId(id);
          }}
          onDone={(id) => {
            handleDone(id);
            setDetailId(null);
          }}
          onStopRaising={handleStopRaising}
          locale={locale}
        />
      )}
      {snoozeAction && (
        <SnoozeModal
          action={snoozeAction}
          pending={pendingId === snoozeAction.id}
          rowError={rowErrors[snoozeAction.id] ?? null}
          onClose={() => setSnoozeId(null)}
          onSubmit={handleSnoozeSubmit}
        />
      )}
      {dismissAction && (
        <DismissModal
          action={dismissAction}
          pending={pendingId === dismissAction.id}
          rowError={rowErrors[dismissAction.id] ?? null}
          onClose={() => setDismissId(null)}
          onSubmit={handleDismissSubmit}
        />
      )}
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
