import { useEffect, useMemo, useState } from 'react';
import { ScrollablePanel, ComponentErrorBoundary } from "@agntux/ui-primitives";
import { buildEnvelope } from '../apps/reply/lib/build-envelope.js';

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Data shape ────────────────────────────────────────────────────────────────

interface QuotedMessage {
  content: string;
  date: string;
  is_from_me: boolean;
}

interface ReplyData {
  action_id: string;
  contact_name: string;
  contact_handle: string;
  quoted_messages: QuotedMessage[];
  draft_body: string;
  personalization_signals: string[];
}

// ── parsePayload ──────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parsePayload(toolOutput?: Record<string, unknown>): ReplyData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;

  const rawMessages = payload.quoted_messages;
  const quotedMessages: QuotedMessage[] = Array.isArray(rawMessages)
    ? rawMessages
        .map((m): QuotedMessage | null => {
          if (!m || typeof m !== 'object') return null;
          const r = m as Record<string, unknown>;
          const msg: QuotedMessage = {
            content: str(r.content),
            date: str(r.date),
            is_from_me: r.is_from_me === true,
          };
          return msg.content ? msg : null;
        })
        .filter((m): m is QuotedMessage => m !== null)
    : [];

  const rawSignals = payload.personalization_signals;
  const personalizationSignals: string[] = Array.isArray(rawSignals)
    ? rawSignals.filter((s): s is string => typeof s === 'string' && s.length > 0)
    : [];

  return {
    action_id: str(payload.action_id),
    contact_name: str(payload.contact_name),
    contact_handle: str(payload.contact_handle),
    quoted_messages: quotedMessages,
    draft_body: str(payload.draft_body),
    personalization_signals: personalizationSignals,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── ReplyComponent ────────────────────────────────────────────────────────────

export function ReplyComponent(props: MainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // Local form state — seeded from server payload, editable by user
  const [body, setBody] = useState('');
  const [seeded, setSeeded] = useState(false);

  // Seed the textarea once the real payload arrives
  useEffect(() => {
    if (!seeded && !isStreaming && toolOutput) {
      setBody(data.draft_body);
      setSeeded(true);
    }
  }, [seeded, isStreaming, toolOutput, data.draft_body]);

  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const isLoading = !toolOutput;

  async function handleSend() {
    if (sendState !== 'idle') return;
    setSendState('sending');
    try {
      const envelope = buildEnvelope({
        recipient: data.contact_handle,
        message: body,
        action_id: data.action_id,
      });
      await sendFollowUpMessage(envelope);
      setSendState('sent');
    } catch {
      setSendState('error');
    }
  }

  // Display name: prefer contact_name, fall back to handle
  const displayName = data.contact_name || data.contact_handle || 'Unknown';
  const handle = data.contact_handle;

  // Find the latest inbound message (is_from_me === false), newest last
  const inboundMessages = data.quoted_messages.filter((m) => !m.is_from_me);
  const latestInbound = inboundMessages[inboundMessages.length - 1] ?? null;
  // Show up to 3 prior messages for context (all; newest last)
  const contextMessages = data.quoted_messages.slice(-3);

  // Loading skeleton
  if (isLoading) {
    return (
      <div
        className="h-full overflow-y-auto bg-background p-4"
        data-testid="loading-skeleton"
      >
        <div className="mb-4 h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="mb-6 h-16 w-full animate-pulse rounded bg-muted" />
        <div className="h-28 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  // Sent confirmation
  if (sendState === 'sent') {
    return (
      <ScrollablePanel title={`Reply to ${displayName}`}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm font-medium text-foreground">Reply sent.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your message was sent via iMessage.
          </p>
        </div>
      </ScrollablePanel>
    );
  }

  const sendDisabled =
    isStreaming || sendState !== 'idle' || body.trim().length === 0;

  return (
    <ComponentErrorBoundary>
      <ScrollablePanel
        title={`Reply to ${displayName}`}
        footer={
          <div className="flex items-center justify-end gap-3 border-t border-border bg-background px-4 py-3">
            {sendState === 'error' && (
              <span className="text-xs text-destructive">
                Something went wrong. Try again.
              </span>
            )}
            <button
              type="button"
              onClick={handleSend}
              disabled={sendDisabled}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendState === 'sending' ? 'Sending...' : 'Send reply'}
            </button>
          </div>
        }
      >
        <div
          className="h-full overflow-y-auto bg-background"
          style={{ maxHeight: 600 }}
          aria-busy={isStreaming ? 'true' : 'false'}
        >
          {/* Header: contact info + Open in Messages link */}
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {displayName}
              </p>
              {handle && (
                <p className="text-xs text-muted-foreground">{handle}</p>
              )}
            </div>
            {handle && (
              <a
                href={`imessage://${handle}`}
                className="shrink-0 text-xs text-primary underline-offset-2 hover:underline"
              >
                Open in Messages
              </a>
            )}
          </div>

          {/* Quoted context block: up to 3 prior messages */}
          {contextMessages.length > 0 && (
            <div className="mx-4 mt-4 rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent thread
              </p>
              <div className="space-y-2">
                {contextMessages.map((m, idx) => (
                  <div
                    key={idx}
                    className={
                      m === latestInbound
                        ? 'rounded border-l-4 border-primary bg-background px-2 py-1.5'
                        : 'rounded px-2 py-1'
                    }
                  >
                    <div className="mb-0.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {m.is_from_me ? 'You' : displayName}
                      </span>
                      {m.date && (
                        <span className="text-xs text-muted-foreground">
                          {formatDate(m.date)}
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-xs text-foreground/80">
                      {m.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reply editor */}
          <fieldset disabled={isStreaming} className="contents">
            <div className="space-y-3 p-4">
              <div>
                <label
                  htmlFor="reply-body"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Your reply
                </label>
                <textarea
                  id="reply-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your reply..."
                  rows={5}
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Personalization signals — optional helper line */}
              {data.personalization_signals.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Tone hints:</span>{' '}
                  {data.personalization_signals.join(' · ')}
                </p>
              )}
            </div>
          </fieldset>
        </div>
      </ScrollablePanel>
    </ComponentErrorBoundary>
  );
}
