// reply-ui.tsx — PostHog Reply to Comment iframe entry.
//
// Mounted by reply.html. Reads ReplyPayload from structuredContent,
// renders the quoted thread context, a pre-filled reply textarea,
// and a "Send reply" button wired to the reply build-envelope.

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
import { buildEnvelope } from './apps/reply/lib/build-envelope.js';
import { ExternalLink } from './components/external-link.js';
import './globals.css';

// ── Payload shape ─────────────────────────────────────────────────────────────

interface ReplyPayload {
  action_id: string;
  thread_url: string;
  source_item_title: string;
  thread_excerpt: string;
  author_name: string;
  draft_body: string;
  personalization_signals: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parsePayload(toolOutput?: Record<string, unknown>): ReplyPayload {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    action_id: str(payload.action_id),
    thread_url: str(payload.thread_url),
    source_item_title: str(payload.source_item_title),
    thread_excerpt: str(payload.thread_excerpt),
    author_name: str(payload.author_name),
    draft_body: str(payload.draft_body),
    personalization_signals: str(payload.personalization_signals),
  };
}

// ── Derive scope/item_id from payload ─────────────────────────────────────────
// The reply handler stores thread_url which encodes the source context.
// We derive scope from a best-effort parse; item_id is the last path segment.
function deriveScopeAndItemId(payload: ReplyPayload): { scope: string; item_id: string } {
  const url = payload.thread_url;
  if (!url) return { scope: 'error_tracking', item_id: payload.action_id };
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    // PostHog URLs typically: /project/{id}/{resource}/{item_id}/...
    // Pick the segment that looks like an ID (last non-empty numeric-ish segment)
    const item_id = parts[parts.length - 1] || payload.action_id;
    // Detect scope from path keywords
    let scope = 'error_tracking';
    if (u.pathname.includes('insights')) scope = 'insight';
    else if (u.pathname.includes('dashboard')) scope = 'dashboard';
    else if (u.pathname.includes('notebook')) scope = 'notebook';
    return { scope, item_id };
  } catch {
    return { scope: 'error_tracking', item_id: payload.action_id };
  }
}

// ── Main component ────────────────────────────────────────────────────────────

function ReplyApp() {
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

  const [body, setBody] = useState<string>('');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Pre-fill textarea from draft_body on first real data arrival
  const [initialised, setInitialised] = useState(false);
  if (!initialised && data.action_id) {
    setBody(data.draft_body);
    setInitialised(true);
  }

  const isLoading = !effectiveToolOutput;

  async function handleSend() {
    if (!data.action_id || !body.trim()) return;
    setSendState('sending');
    setErrorMsg('');
    try {
      const { scope, item_id } = deriveScopeAndItemId(data);
      const envelope = buildEnvelope({
        scope,
        item_id,
        content: body.trim(),
        action_id: data.action_id,
      });
      await client.sendFollowUpMessage(envelope);
      setSendState('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'An error occurred.');
      setSendState('error');
    }
  }

  const openInPostHogLink = data.thread_url ? (
    <ExternalLink
      href={data.thread_url}
      className="text-xs text-primary underline-offset-2 hover:underline"
    >
      Open in PostHog
    </ExternalLink>
  ) : null;

  const footer = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      {sendState === 'done' ? (
        <p className="text-sm text-green-600 font-medium">Reply sent.</p>
      ) : sendState === 'error' ? (
        <p className="text-sm text-destructive">{errorMsg || 'Failed to send reply.'}</p>
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
          !body.trim()
        }
        onClick={() => void handleSend()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sendState === 'sending' ? 'Sending…' : 'Send reply'}
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6" data-testid="loading-skeleton">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="mb-3 h-4 w-full animate-pulse rounded bg-muted" />
          <div className="mb-3 h-16 w-full animate-pulse rounded bg-muted" />
          <div className="mt-6 h-8 w-28 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <ScrollablePanel
      title={
        <div className="flex items-center justify-between w-full">
          <span className="font-semibold text-foreground">Reply to Comment</span>
          {openInPostHogLink}
        </div>
      }
      footer={footer}
    >
      <fieldset disabled={isStreaming} className="contents">
        <div className="p-4 space-y-4">
          {/* Quoted thread context */}
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Thread
            </p>
            {data.source_item_title && (
              <p className="text-sm font-semibold text-foreground leading-snug mb-1">
                {data.source_item_title}
              </p>
            )}
            {data.author_name && (
              <p className="text-xs text-muted-foreground mb-1">
                From: <span className="font-medium text-foreground">{data.author_name}</span>
              </p>
            )}
            {data.thread_excerpt && (
              <blockquote className="mt-1 border-l-2 border-border pl-3 text-sm text-muted-foreground italic leading-relaxed">
                {data.thread_excerpt}
              </blockquote>
            )}
          </div>

          {/* Reply textarea */}
          <div>
            <label htmlFor="reply-body" className="block text-sm font-medium text-foreground mb-1">
              Your reply
            </label>
            <textarea
              id="reply-body"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your reply here…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
          </div>
        </div>
      </fieldset>
    </ScrollablePanel>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const VIEW_MIN_HEIGHT_PX = 520;
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
          <ReplyApp />
        </ComponentErrorBoundary>
      </AppsProvider>
    </StrictMode>,
  );
}
