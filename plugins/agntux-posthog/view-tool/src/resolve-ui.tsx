// resolve-ui.tsx — PostHog Resolve Error Issue iframe entry.
//
// Mounted by resolve.html. Reads ResolvePayload from structuredContent,
// renders a quoted issue context, a status picker, an assignee dropdown,
// and a "Update issue" Send button wired to the resolve build-envelope.

import { StrictMode, useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AppsProvider,
  useAppsClient,
  useToolResult,
  useToolInput,
  useOnToolInputPartial,
  useDocumentTheme,
  useHostStyleVariables,
} from './lib/apps-react/index.js';
import { ComponentErrorBoundary, ScrollablePanel } from "@agntux/ui-primitives";
import { buildEnvelope } from './apps/resolve/lib/build-envelope.js';
import { ExternalLink } from './components/external-link.js';
import './globals.css';

// ── Payload shape ─────────────────────────────────────────────────────────────

interface ResolvePayload {
  action_id: string;
  issue_url: string;
  issue_id: string;
  issue_title: string;
  occurrence_summary: string;
  current_status: string;
  current_assignee: string;
  candidate_assignees: string[];
  target_status: string;
}

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  // Coerce primitive non-string scalars so a numeric issue_id (written
  // unquoted in YAML and parsed as a number) is not silently dropped.
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v);
  }
  return '';
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter((s) => s.length > 0);
}

function parsePayload(toolOutput?: Record<string, unknown>): ResolvePayload {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    action_id: str(payload.action_id),
    issue_url: str(payload.issue_url),
    issue_id: str(payload.issue_id),
    issue_title: str(payload.issue_title),
    occurrence_summary: str(payload.occurrence_summary),
    current_status: str(payload.current_status),
    current_assignee: str(payload.current_assignee),
    candidate_assignees: strArr(payload.candidate_assignees),
    target_status: str(payload.target_status) || 'resolved',
  };
}

// ── Main component ────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['resolved', 'active', 'suppressed'] as const;

function ResolveApp() {
  useDocumentTheme('light', 'dark');
  useHostStyleVariables();

  const client = useAppsClient();
  const toolResult = useToolResult();
  const toolInput = useToolInput();
  void toolInput;

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

  const data = useMemo(() => parsePayload(effectiveToolOutput), [effectiveToolOutput]);

  const [status, setStatus] = useState<string>('');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Initialise pickers from payload on first real data arrival
  const [initialised, setInitialised] = useState(false);
  if (!initialised && data.action_id) {
    setStatus(data.target_status || data.current_status || 'resolved');
    setAssigneeId(data.current_assignee);
    setInitialised(true);
  }

  const isLoading = !effectiveToolOutput;

  async function handleSend() {
    // Never fail silently: a missing id used to make this an enabled-but-dead
    // button (clicking did nothing). Surface the reason instead.
    if (!data.action_id || !data.issue_id) {
      setErrorMsg(
        'Cannot update: this action is missing its PostHog issue id. ' +
          'Re-sync PostHog so the action is re-composed with issue_id.',
      );
      setSendState('error');
      return;
    }
    setSendState('sending');
    setErrorMsg('');
    try {
      const envelope = buildEnvelope({
        issue_id: data.issue_id,
        status,
        assignee_id: assigneeId,
        action_id: data.action_id,
      });
      await client.sendFollowUpMessage(envelope);
      setSendState('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'An error occurred.');
      setSendState('error');
    }
  }

  const openInPostHogLink = data.issue_url ? (
    <ExternalLink
      href={data.issue_url}
      className="text-xs text-primary underline-offset-2 hover:underline"
    >
      Open in PostHog
    </ExternalLink>
  ) : null;

  const footer = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      {sendState === 'done' ? (
        <p className="text-sm text-green-600 font-medium">Issue updated.</p>
      ) : sendState === 'error' ? (
        <p className="text-sm text-destructive">{errorMsg || 'Failed to update issue.'}</p>
      ) : (
        <span />
      )}
      <button
        type="button"
        disabled={isStreaming || isLoading || sendState === 'sending' || sendState === 'done' || !data.action_id}
        onClick={() => void handleSend()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sendState === 'sending' ? 'Updating…' : 'Update issue'}
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6" data-testid="loading-skeleton">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="mb-3 h-4 w-full animate-pulse rounded bg-muted" />
          <div className="mb-3 h-4 w-5/6 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-8 w-32 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <ScrollablePanel
      title={
        <div className="flex items-center justify-between w-full">
          <span className="font-semibold text-foreground">Resolve Error Issue</span>
          {openInPostHogLink}
        </div>
      }
      footer={footer}
    >
      <fieldset disabled={isStreaming} className="contents">
        <div className="p-4 space-y-4">
          {/* Quoted issue context */}
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Error Issue
            </p>
            <p className="text-sm font-semibold text-foreground leading-snug">
              {data.issue_title || '(no title)'}
            </p>
            {data.occurrence_summary && (
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {data.occurrence_summary}
              </p>
            )}
          </div>

          {/* Current status badge */}
          {data.current_status && (
            <p className="text-xs text-muted-foreground">
              Current status:{' '}
              <span className="font-medium text-foreground">{data.current_status}</span>
            </p>
          )}

          {/* Status picker */}
          <div>
            <label htmlFor="resolve-status" className="block text-sm font-medium text-foreground mb-1">
              New status
            </label>
            <select
              id="resolve-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Assignee picker */}
          {data.candidate_assignees.length > 0 && (
            <div>
              <label htmlFor="resolve-assignee" className="block text-sm font-medium text-foreground mb-1">
                Assignee
              </label>
              <select
                id="resolve-assignee"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— leave unchanged —</option>
                {data.candidate_assignees.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </fieldset>
    </ScrollablePanel>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const VIEW_MIN_HEIGHT_PX = 480;
if (typeof document !== 'undefined') {
  document.documentElement.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  if (document.body) {
    document.body.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  rootElement.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  createRoot(rootElement).render(
    <StrictMode>
      <AppsProvider>
        <ComponentErrorBoundary>
          <ResolveApp />
        </ComponentErrorBoundary>
      </AppsProvider>
    </StrictMode>,
  );
}
