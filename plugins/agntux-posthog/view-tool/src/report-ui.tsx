// report-ui.tsx — PostHog Mark Report Handled iframe entry.
//
// Mounted by report.html. Reads ReportPayload from structuredContent,
// renders the quoted report context, a state picker (Resolved/Archived),
// and a "Mark handled" button wired to the report build-envelope.

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
import { buildEnvelope } from './apps/report/lib/build-envelope.js';
import { ExternalLink } from './components/external-link.js';
import './globals.css';

// ── Payload shape ─────────────────────────────────────────────────────────────

interface ReportPayload {
  action_id: string;
  report_url: string;
  report_id: string;
  report_title: string;
  report_summary: string;
  target_state: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parsePayload(toolOutput?: Record<string, unknown>): ReportPayload {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    action_id: str(payload.action_id),
    report_url: str(payload.report_url),
    report_id: str(payload.report_id),
    report_title: str(payload.report_title),
    report_summary: str(payload.report_summary),
    target_state: str(payload.target_state) || 'resolved',
  };
}

// ── Main component ────────────────────────────────────────────────────────────

const STATE_OPTIONS = ['resolved', 'archived'] as const;

function ReportApp() {
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

  const [state, setState] = useState<string>('');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Initialise picker from target_state on first real data arrival
  const [initialised, setInitialised] = useState(false);
  if (!initialised && data.action_id) {
    setState(data.target_state || 'resolved');
    setInitialised(true);
  }

  const isLoading = !effectiveToolOutput;

  async function handleSend() {
    if (!data.action_id || !data.report_id || !state) return;
    setSendState('sending');
    setErrorMsg('');
    try {
      const envelope = buildEnvelope({
        report_id: data.report_id,
        state,
        action_id: data.action_id,
      });
      await client.sendFollowUpMessage(envelope);
      setSendState('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'An error occurred.');
      setSendState('error');
    }
  }

  const openInPostHogLink = data.report_url ? (
    <ExternalLink
      href={data.report_url}
      className="text-xs text-primary underline-offset-2 hover:underline"
    >
      Open in PostHog
    </ExternalLink>
  ) : null;

  const footer = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      {sendState === 'done' ? (
        <p className="text-sm text-green-600 font-medium">Report marked as {state}.</p>
      ) : sendState === 'error' ? (
        <p className="text-sm text-destructive">{errorMsg || 'Failed to update report.'}</p>
      ) : (
        <span />
      )}
      <button
        type="button"
        disabled={
          isStreaming ||
          isLoading ||
          sendState === 'sending' ||
          sendState === 'done' ||
          !data.action_id ||
          !state
        }
        onClick={() => void handleSend()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sendState === 'sending' ? 'Updating…' : 'Mark handled'}
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6" data-testid="loading-skeleton">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="mb-3 h-4 w-full animate-pulse rounded bg-muted" />
          <div className="mb-3 h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-8 w-32 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <ScrollablePanel
      title={
        <div className="flex items-center justify-between w-full">
          <span className="font-semibold text-foreground">Mark Report Handled</span>
          {openInPostHogLink}
        </div>
      }
      footer={footer}
    >
      <fieldset disabled={isStreaming} className="contents">
        <div className="p-4 space-y-4">
          {/* Quoted report context */}
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Inbox Report
            </p>
            <p className="text-sm font-semibold text-foreground leading-snug">
              {data.report_title || '(no title)'}
            </p>
            {data.report_summary && (
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {data.report_summary}
              </p>
            )}
          </div>

          {/* State picker */}
          <div>
            <label htmlFor="report-state" className="block text-sm font-medium text-foreground mb-1">
              New state
            </label>
            <select
              id="report-state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {STATE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>
    </ScrollablePanel>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const VIEW_MIN_HEIGHT_PX = 460;
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
          <ReportApp />
        </ComponentErrorBoundary>
      </AppsProvider>
    </StrictMode>,
  );
}
