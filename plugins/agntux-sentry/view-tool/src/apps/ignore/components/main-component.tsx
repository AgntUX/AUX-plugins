// Layout: quoted issue card → "Ignore until…" select + conditional inputs → Send footer.
// Design rules: light mode only, semantic tokens, one Send button, ScrollablePanel, no modals.

import { useMemo, useState } from 'react';
import { safeString, ScrollablePanel } from "@agntux/ui-primitives";
import { useAppsClient } from '../../../lib/apps-react/index.js';
import { buildEnvelope, type IgnoreMode } from '../lib/build-envelope.js';

// ── Types ────────────────────────────────────────────────────────────────────

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
  displayMode: string;
  availableDisplayModes: string[];
  requestDisplayMode: (mode: 'inline' | 'fullscreen' | 'pip') => Promise<void>;
  theme: string;
  locale: string;
  safeArea: { top: number; right: number; bottom: number; left: number };
  viewport: { width: number; height: number };
  platform: string;
}

type SendState = 'idle' | 'loading' | 'success' | 'error';

const IGNORE_MODES: { value: IgnoreMode; label: string }[] = [
  { value: 'untilEscalating', label: 'it escalates again (default)' },
  { value: 'forever', label: 'forever' },
  { value: 'forDuration', label: 'a set amount of time' },
  { value: 'untilOccurrenceCount', label: 'it happens N more times' },
];

// ── parsePayload ─────────────────────────────────────────────────────────────

function parsePayload(toolOutput?: Record<string, unknown>) {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;

  const rawMode = safeString(payload.ignore_mode);
  const validModes: IgnoreMode[] = ['untilEscalating', 'forever', 'forDuration', 'untilOccurrenceCount'];
  const ignoreMode: IgnoreMode = (validModes.includes(rawMode as IgnoreMode) ? rawMode : 'untilEscalating') as IgnoreMode;

  return {
    issue_url: safeString(payload.issue_url),
    issue_short_id: safeString(payload.issue_short_id),
    issue_title: safeString(payload.issue_title),
    level: safeString(payload.level),
    project: safeString(payload.project),
    events_count: typeof payload.events_count === 'number' ? payload.events_count : 0,
    users_affected: typeof payload.users_affected === 'number' ? payload.users_affected : 0,
    ignore_mode: ignoreMode,
    ignore_duration_minutes: typeof payload.ignore_duration_minutes === 'number' ? payload.ignore_duration_minutes : 0,
    ignore_count: typeof payload.ignore_count === 'number' ? payload.ignore_count : 0,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function MainComponent(props: MainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const client = useAppsClient();

  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // User-controlled ignore mode — seeds from structuredContent.
  const [ignoreMode, setIgnoreMode] = useState<IgnoreMode>('untilEscalating');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [occurrenceCount, setOccurrenceCount] = useState(10);
  const [seeded, setSeeded] = useState(false);
  if (!seeded && toolOutput !== undefined) {
    setIgnoreMode(data.ignore_mode);
    if (data.ignore_duration_minutes > 0) setDurationMinutes(data.ignore_duration_minutes);
    if (data.ignore_count > 0) setOccurrenceCount(data.ignore_count);
    setSeeded(true);
  }

  const [sendState, setSendState] = useState<SendState>('idle');
  const [sendErrorMsg, setSendErrorMsg] = useState('');

  const hasData = !!data.issue_short_id || !!data.issue_title;
  if (!hasData && !isStreaming) {
    return <LoadingSkeleton />;
  }

  const isSending = sendState === 'loading';
  const sendSuccess = sendState === 'success';

  async function handleSend() {
    if (isSending || sendSuccess) return;
    setSendState('loading');
    setSendErrorMsg('');
    try {
      const envelope = buildEnvelope({
        issueUrl: data.issue_url,
        ignoreMode,
        ignoreDurationMinutes: ignoreMode === 'forDuration' ? durationMinutes : undefined,
        ignoreCount: ignoreMode === 'untilOccurrenceCount' ? occurrenceCount : undefined,
      });
      await sendFollowUpMessage(envelope);
      setSendState('success');
    } catch (err) {
      setSendState('error');
      setSendErrorMsg(err instanceof Error ? err.message : 'Failed to ignore issue');
    }
  }

  function handleOpenInSentry() {
    if (data.issue_url) void client.openLink(data.issue_url);
  }

  const levelBadgeClass = levelBadge(data.level);

  return (
    <ScrollablePanel
      title={
        <IssueHeader
          shortId={data.issue_short_id}
          title={data.issue_title}
          level={data.level}
          levelBadgeClass={levelBadgeClass}
          onOpen={handleOpenInSentry}
          hasUrl={!!data.issue_url}
        />
      }
      footer={
        <SendFooter
          sendState={sendState}
          sendErrorMsg={sendErrorMsg}
          onSend={handleSend}
          isStreaming={!!isStreaming}
        />
      }
    >
      <fieldset
        disabled={!!isStreaming || isSending || sendSuccess}
        className="contents"
        aria-busy={isStreaming ? 'true' : 'false'}
      >
        <StreamingIndicator visible={!!isStreaming} />

        {/* Quoted issue card */}
        <section
          aria-label="Issue details"
          className="mx-4 mt-3 rounded-md border border-border bg-muted/40 px-3 py-2.5"
        >
          <p className="text-xs text-muted-foreground">
            <span className="font-mono font-semibold">{data.issue_short_id || '—'}</span>
            {data.project && <> &middot; {data.project}</>}
            {data.events_count > 0 && (
              <> &middot; {data.events_count.toLocaleString()} events</>
            )}
            {data.users_affected > 0 && (
              <> &middot; {data.users_affected.toLocaleString()} users affected</>
            )}
          </p>
        </section>

        {/* Ignore mode selector */}
        <section aria-label="Ignore options" className="mx-4 mt-3">
          <label htmlFor="sentry-ignore-mode" className="mb-1.5 block text-xs font-medium text-foreground">
            Ignore until…
          </label>
          <select
            id="sentry-ignore-mode"
            value={ignoreMode}
            onChange={(e) => setIgnoreMode(e.target.value as IgnoreMode)}
            className={[
              'w-full rounded-md border border-input bg-background px-3 py-2',
              'text-sm text-foreground',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:opacity-50',
            ].join(' ')}
          >
            {IGNORE_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          {/* Conditional: duration input */}
          {ignoreMode === 'forDuration' && (
            <div className="mt-2.5">
              <label htmlFor="sentry-ignore-duration" className="mb-1 block text-xs font-medium text-foreground">
                Duration (minutes)
              </label>
              <input
                id="sentry-ignore-duration"
                type="number"
                min={1}
                value={durationMinutes}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v > 0) setDurationMinutes(v);
                }}
                className={[
                  'w-full rounded-md border border-input bg-background px-3 py-2',
                  'text-sm text-foreground',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:opacity-50',
                ].join(' ')}
              />
            </div>
          )}

          {/* Conditional: occurrence count input */}
          {ignoreMode === 'untilOccurrenceCount' && (
            <div className="mt-2.5">
              <label htmlFor="sentry-ignore-count" className="mb-1 block text-xs font-medium text-foreground">
                Occurrence count
              </label>
              <input
                id="sentry-ignore-count"
                type="number"
                min={1}
                value={occurrenceCount}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v > 0) setOccurrenceCount(v);
                }}
                className={[
                  'w-full rounded-md border border-input bg-background px-3 py-2',
                  'text-sm text-foreground',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:opacity-50',
                ].join(' ')}
              />
            </div>
          )}
        </section>

        {/* Success banner */}
        {sendSuccess && (
          <div
            role="status"
            aria-live="polite"
            className="mx-4 mt-3 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground"
          >
            {data.issue_short_id || 'Issue'} ignored.
          </div>
        )}
      </fieldset>
    </ScrollablePanel>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function levelBadge(level: string): string {
  switch (level.toLowerCase()) {
    case 'fatal':
      return 'border-destructive bg-destructive/10 text-destructive';
    case 'error':
      return 'border-orange-500 bg-orange-50 text-orange-700';
    case 'warning':
      return 'border-yellow-500 bg-yellow-50 text-yellow-700';
    case 'info':
      return 'border-blue-500 bg-blue-50 text-blue-700';
    default:
      return 'border-border bg-secondary text-secondary-foreground';
  }
}

function IssueHeader({
  shortId,
  title,
  level,
  levelBadgeClass,
  onOpen,
  hasUrl,
}: {
  shortId: string;
  title: string;
  level: string;
  levelBadgeClass: string;
  onOpen: () => void;
  hasUrl: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-muted-foreground">
            {shortId || '—'}
          </span>
          {level && (
            <span
              className={[
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
                levelBadgeClass,
              ].join(' ')}
            >
              {level}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm font-medium text-foreground">
          {title || 'Sentry issue'}
        </p>
      </div>
      {hasUrl && (
        <button
          type="button"
          onClick={onOpen}
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-label="Open in Sentry"
        >
          <svg
            aria-hidden="true"
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          Open in Sentry
        </button>
      )}
    </div>
  );
}

function SendFooter({
  sendState,
  sendErrorMsg,
  onSend,
  isStreaming,
}: {
  sendState: SendState;
  sendErrorMsg: string;
  onSend: () => void;
  isStreaming: boolean;
}) {
  const isSending = sendState === 'loading';
  const sendSuccess = sendState === 'success';

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border bg-background px-4 py-3">
      <p className="text-xs text-muted-foreground">
        {sendSuccess ? 'Issue ignored.' : 'Will ignore the issue with the selected settings.'}
      </p>
      <div className="flex flex-col items-end gap-1">
        {sendState === 'error' && (
          <p role="alert" aria-live="assertive" className="text-xs text-destructive">
            {sendErrorMsg || 'Failed to ignore — try again.'}
          </p>
        )}
        <button
          type="button"
          onClick={onSend}
          disabled={isStreaming || isSending || sendSuccess}
          aria-busy={isSending}
          aria-label="Ignore issue"
          className={[
            'inline-flex items-center gap-2 rounded-md px-4 py-2',
            'bg-primary text-primary-foreground text-sm font-medium',
            'hover:opacity-90 transition-opacity',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          ].join(' ')}
        >
          {isSending && <Spinner className="h-3.5 w-3.5" />}
          {isSending ? 'Ignoring…' : sendSuccess ? 'Ignored' : 'Ignore issue'}
        </button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="h-full overflow-y-auto bg-background p-4" data-testid="loading-skeleton">
      <div className="mb-4 h-5 w-40 animate-pulse rounded-md bg-muted" />
      <div className="mb-2 h-4 w-full animate-pulse rounded-md bg-muted" />
      <div className="mb-6 h-4 w-3/4 animate-pulse rounded-md bg-muted" />
      <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
    </div>
  );
}

function Spinner({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`${className} animate-spin text-current`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function StreamingIndicator({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="sticky top-2 right-2 z-10 flex items-center justify-end px-2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div className="inline-flex items-center gap-1.5 rounded-full bg-muted/80 backdrop-blur px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
        Generating…
      </div>
    </div>
  );
}
