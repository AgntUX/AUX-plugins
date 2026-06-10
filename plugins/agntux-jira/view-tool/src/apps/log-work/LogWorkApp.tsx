import { useState, useMemo } from 'react';
import {
  useAppsClient,
  useToolResult,
  useToolInput,
  useOnToolInputPartial,
  useHostContext,
  useWidgetState,
  useDisplayMode,
  useSafeAreaInsets,
  useDocumentTheme,
  useHostStyleVariables,
} from '../../lib/apps-react/index.js';
import { ComponentErrorBoundary, ServerErrorScreen, detectErrorEnvelope, ScrollablePanel } from "@agntux/ui-primitives";
import { IssueHeaderCard } from '../../components/issue-header-card.js';
import { buildLogWorkEnvelope } from './lib/build-envelope.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LogWorkPayload {
  cloud_id: string;
  issue_key: string;
  issue_url: string;
  issue_title: string;
  suggested_time_spent: string;
  suggested_started: string;
  draft_comment: string | null;
  personalization_signals: string[];
  generated_at: string;
}

// Jira shorthand: optional w / d / h / m segments (positive integers).
// At least one segment required. Whitespace allowed between segments.
const TIME_SPENT_RE = /^\s*(?:\d+w\s*)?(?:\d+d\s*)?(?:\d+h\s*)?(?:\d+m)?\s*$/;

function isValidTimeSpent(v: string): boolean {
  const t = v.trim();
  if (!t) return false;
  if (!TIME_SPENT_RE.test(t)) return false;
  // Reject inputs with no segment at all (regex above matches empty inside non-strict).
  return /\d+(w|d|h|m)/.test(t);
}

// ── Payload parsing ───────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function strOrNull(v: unknown): string | null { return typeof v === 'string' ? v : null; }
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function parsePayload(toolOutput?: Record<string, unknown>): { error: string } | LogWorkPayload {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const raw = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  if (typeof raw.error === 'string') return { error: raw.error };
  return {
    cloud_id: str(raw.cloud_id),
    issue_key: str(raw.issue_key),
    issue_url: str(raw.issue_url),
    issue_title: str(raw.issue_title),
    suggested_time_spent: str(raw.suggested_time_spent),
    suggested_started: str(raw.suggested_started),
    draft_comment: strOrNull(raw.draft_comment),
    personalization_signals: strArray(raw.personalization_signals),
    generated_at: str(raw.generated_at),
  };
}

// Convert "2026-06-08T14:30:00.000-07:00" or "2026-06-08T14:30:00Z" to the
// `YYYY-MM-DDTHH:mm` shape <input type="datetime-local"> expects, in the
// browser's local timezone. Falls back to "now" if parsing fails.
function toLocalDatetimeInput(iso: string): string {
  let d: Date;
  if (iso) {
    d = new Date(iso);
    if (Number.isNaN(d.getTime())) d = new Date();
  } else {
    d = new Date();
  }
  // Clamp future timestamps to now.
  if (d.getTime() > Date.now()) d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert "YYYY-MM-DDTHH:mm" (local time) back to an ISO 8601 string with offset
// in the form Jira accepts: "YYYY-MM-DDTHH:mm:ss.000+HHmm".
function toJiraStarted(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  const abs = Math.abs(tz);
  const tzh = pad(Math.floor(abs / 60));
  const tzm = pad(abs % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000${sign}${tzh}${tzm}`;
}

// ── App shell ─────────────────────────────────────────────────────────────────

export function LogWorkApp() {
  useDocumentTheme('light', 'dark');
  useHostStyleVariables();

  const client = useAppsClient();
  const toolResult = useToolResult();
  const toolInput = useToolInput();
  const { mode: displayMode } = useDisplayMode();
  const [widgetState, setWidgetState] = useWidgetState<Record<string, unknown>>({});
  const safeArea = useSafeAreaInsets();
  const hostContext = useHostContext();

  const [partialInput, setPartialInput] = useState<Record<string, unknown> | undefined>(undefined);
  useOnToolInputPartial((input) => setPartialInput(input));

  const toolOutput =
    toolResult && Object.keys(toolResult).length > 0
      ? (Object.values(toolResult)[0] as Record<string, unknown> | undefined)
      : undefined;

  const effectiveToolOutput =
    toolOutput ??
    (partialInput && Object.keys(partialInput).length > 0
      ? ({ _meta: { payload: partialInput } } as Record<string, unknown>)
      : undefined);

  const isStreaming = !toolOutput && !!partialInput;

  const errorEnvelope = detectErrorEnvelope(toolOutput);
  if (errorEnvelope) {
    return (
      <div className="h-full">
        <ComponentErrorBoundary>
          <ServerErrorScreen message={errorEnvelope} />
        </ComponentErrorBoundary>
      </div>
    );
  }

  return (
    <div className="h-full">
      <ComponentErrorBoundary>
        <LogWorkView
          toolOutput={effectiveToolOutput}
          toolInput={toolInput}
          isStreaming={isStreaming}
          widgetState={widgetState}
          setWidgetState={setWidgetState}
          callTool={client.callTool.bind(client)}
          sendFollowUpMessage={client.sendFollowUpMessage.bind(client)}
          displayMode={displayMode}
          safeArea={safeArea}
          platform={hostContext.platform}
        />
      </ComponentErrorBoundary>
    </div>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────

interface LogWorkViewProps {
  toolOutput?: Record<string, unknown>;
  toolInput?: Record<string, unknown>;
  isStreaming?: boolean;
  widgetState: Record<string, unknown>;
  setWidgetState: (next: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  sendFollowUpMessage: (prompt: string) => Promise<void>;
  displayMode: string;
  safeArea: { top: number; right: number; bottom: number; left: number };
  platform: string;
}

function LogWorkView({ toolOutput, isStreaming, callTool }: LogWorkViewProps) {
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [timeSpent, setTimeSpent] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [discarded, setDiscarded] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Local datetime-local value for the Started picker.
  const effStarted = useMemo(() => {
    if (started !== null) return started;
    if (!toolOutput || 'error' in data) return '';
    return toLocalDatetimeInput((data as LogWorkPayload).suggested_started);
  }, [started, toolOutput, data]);

  if (!toolOutput) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4" data-testid="loading-skeleton">
        <div className="mx-auto max-w-xl">
          <div className="mb-4 h-16 animate-pulse rounded-lg bg-muted" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if ('error' in data) {
    const msgs: Record<string, string> = {
      action_not_found: 'This action item could not be found.',
      action_already_handled: 'This action has already been completed.',
      log_work_payload_missing: 'Worklog data is unavailable for this action.',
    };
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{msgs[data.error] ?? 'Unable to load worklog view.'}</p>
      </div>
    );
  }

  const effTimeSpent = timeSpent ?? data.suggested_time_spent;
  const effComment = comment ?? data.draft_comment ?? '';
  const timeValid = isValidTimeSpent(effTimeSpent);
  const canSend = timeValid && sendState === 'idle';

  // Today's date for the datetime-local max attribute (no future logging).
  const nowLocal = useMemo(() => toLocalDatetimeInput(''), []);

  if (discarded) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Discarded. No worklog added.</p>
      </div>
    );
  }

  if (sendState === 'sent') {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-foreground font-medium">
          Logged {effTimeSpent.trim()} on {data.issue_key}.
        </p>
      </div>
    );
  }

  async function handleSend() {
    if (!canSend || !('cloud_id' in data)) return;
    setSendState('sending');
    try {
      const envelope = buildLogWorkEnvelope({
        cloudId: data.cloud_id,
        issueIdOrKey: data.issue_key,
        timeSpent: effTimeSpent.trim(),
        started: toJiraStarted(effStarted),
        commentBody: effComment,
      });
      await callTool(envelope.toolName, envelope.args);
      setSendState('sent');
    } catch (e) {
      setSendState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to log work.');
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      <p className="text-xs text-muted-foreground">
        {timeValid ? 'Logged to your Jira worklog' : 'Use Jira shorthand: 1h, 30m, 1h 30m'}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
          onClick={() => setDiscarded(true)}
          disabled={isStreaming || sendState !== 'idle'}
        >
          Discard
        </button>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          onClick={() => { void handleSend(); }}
          disabled={!canSend || isStreaming}
        >
          {sendState === 'sending' ? 'Logging...' : 'Log work'}
        </button>
      </div>
    </div>
  );

  return (
    <ScrollablePanel
      title={
        <span className="text-sm font-semibold text-foreground">
          Log work — {data.issue_key || 'issue'}
        </span>
      }
      footer={footer}
    >
      <div className="px-4 pt-4 pb-2">
        <IssueHeaderCard
          issueKey={data.issue_key}
          issueTitle={data.issue_title}
          issueUrl={data.issue_url}
        />
        <fieldset disabled={isStreaming || sendState !== 'idle'} className="contents">
          <div className="mb-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Time spent
              </span>
              <input
                type="text"
                value={effTimeSpent}
                onChange={(e) => setTimeSpent(e.target.value)}
                placeholder="e.g. 1h 30m"
                className={`mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
                  effTimeSpent && !timeValid ? 'border-destructive' : 'border-border'
                }`}
                aria-invalid={effTimeSpent && !timeValid ? true : undefined}
              />
              {effTimeSpent && !timeValid && (
                <span className="mt-1 block text-xs text-destructive">
                  Use Jira shorthand: 1w, 2d, 3h, 45m, or combinations.
                </span>
              )}
            </label>
          </div>
          <div className="mb-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Started
              </span>
              <input
                type="datetime-local"
                value={effStarted}
                max={nowLocal}
                onChange={(e) => setStarted(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>
          <div>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Note (optional)
              </span>
              <input
                type="text"
                value={effComment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What did you work on?"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>
        </fieldset>
        {sendState === 'error' && (
          <p className="mt-2 text-xs text-destructive">{errorMsg}</p>
        )}
      </div>
    </ScrollablePanel>
  );
}
