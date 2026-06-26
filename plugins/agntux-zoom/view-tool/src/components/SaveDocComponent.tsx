import { useEffect, useMemo, useState } from 'react';
import { ScrollablePanel, ComponentErrorBoundary } from "@agntux/ui-primitives";
import { buildEnvelope } from '../apps/save-doc/lib/build-envelope.js';
import { ExternalLink } from './external-link.js';

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

interface SaveDocData {
  action_id: string;
  meeting_uuid: string;
  meeting_topic: string;
  meeting_date: string;
  participants: string[];
  meeting_summary: string;
  action_items: string[];
  draft_doc_title: string;
  draft_doc_body: string;
  open_in_zoom_url: string;
  personalization_signals: string[];
}

// ── parsePayload ──────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parsePayload(toolOutput?: Record<string, unknown>): SaveDocData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;

  const rawParticipants = payload.participants;
  const participants: string[] = Array.isArray(rawParticipants)
    ? rawParticipants.filter(
        (s): s is string => typeof s === 'string' && s.length > 0,
      )
    : [];

  const rawActionItems = payload.action_items;
  const actionItems: string[] = Array.isArray(rawActionItems)
    ? rawActionItems.filter(
        (s): s is string => typeof s === 'string' && s.length > 0,
      )
    : [];

  const rawSignals = payload.personalization_signals;
  const personalizationSignals: string[] = Array.isArray(rawSignals)
    ? rawSignals.filter(
        (s): s is string => typeof s === 'string' && s.length > 0,
      )
    : [];

  return {
    action_id: str(payload.action_id),
    meeting_uuid: str(payload.meeting_uuid),
    meeting_topic: str(payload.meeting_topic),
    meeting_date: str(payload.meeting_date),
    participants,
    meeting_summary: str(payload.meeting_summary),
    action_items: actionItems,
    draft_doc_title: str(payload.draft_doc_title),
    draft_doc_body: str(payload.draft_doc_body),
    open_in_zoom_url: str(payload.open_in_zoom_url),
    personalization_signals: personalizationSignals,
  };
}

// ── SaveDocComponent ──────────────────────────────────────────────────────────

export function SaveDocComponent(props: MainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // Local form state — seeded from server payload, editable by user
  const [docTitle, setDocTitle] = useState('');
  const [docBody, setDocBody] = useState('');
  const [seeded, setSeeded] = useState(false);

  // Seed the form fields once the real payload arrives
  useEffect(() => {
    if (!seeded && !isStreaming && toolOutput) {
      setDocTitle(data.draft_doc_title);
      setDocBody(data.draft_doc_body);
      setSeeded(true);
    }
  }, [seeded, isStreaming, toolOutput, data.draft_doc_title, data.draft_doc_body]);

  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const isLoading = !toolOutput;

  async function handleSend() {
    if (sendState !== 'idle') return;
    setSendState('sending');
    try {
      const envelope = buildEnvelope({
        file_name: docTitle,
        content: docBody,
        action_id: data.action_id,
      });
      await sendFollowUpMessage(envelope);
      setSendState('sent');
    } catch {
      setSendState('error');
    }
  }

  const meetingLabel = data.meeting_topic || 'Meeting';

  // Loading skeleton
  if (isLoading) {
    return (
      <div
        className="h-full overflow-y-auto bg-background p-4"
        data-testid="loading-skeleton"
      >
        <div className="mb-4 h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="mb-6 h-20 w-full animate-pulse rounded bg-muted" />
        <div className="mb-3 h-8 w-full animate-pulse rounded bg-muted" />
        <div className="h-48 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  // Sent confirmation
  if (sendState === 'sent') {
    return (
      <ScrollablePanel title="Save to Zoom Doc">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm font-medium text-foreground">
            Saved to Zoom Doc.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your meeting summary and action items have been saved to Zoom Docs.
          </p>
        </div>
      </ScrollablePanel>
    );
  }

  const sendDisabled =
    isStreaming ||
    sendState !== 'idle' ||
    docTitle.trim().length === 0 ||
    docBody.trim().length === 0;

  return (
    <ComponentErrorBoundary>
      <ScrollablePanel
        title="Save to Zoom Doc"
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
              {sendState === 'sending' ? 'Saving...' : 'Save to Zoom Doc'}
            </button>
          </div>
        }
      >
        <div
          className="h-full overflow-y-auto bg-background"
          style={{ maxHeight: 640 }}
          aria-busy={isStreaming ? 'true' : 'false'}
        >
          {/* Header row: meeting topic + date/participants on left, Open in Zoom link on right */}
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {meetingLabel}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {data.meeting_date}
                {data.participants.length > 0 && (
                  <span>
                    {' '}
                    &middot; {data.participants.slice(0, 3).join(', ')}
                    {data.participants.length > 3 && (
                      <span> +{data.participants.length - 3} more</span>
                    )}
                  </span>
                )}
              </p>
            </div>
            {data.open_in_zoom_url && (
              <ExternalLink
                href={data.open_in_zoom_url}
                className="shrink-0 text-xs text-primary underline-offset-2 hover:underline"
                ariaLabel="Open in Zoom"
              >
                Open in Zoom &#8599;
              </ExternalLink>
            )}
          </div>

          {/* AI summary + action items quote block */}
          {(data.meeting_summary || data.action_items.length > 0) && (
            <div className="mx-4 mt-4 rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Meeting summary
              </p>
              {data.meeting_summary && (
                <p className="whitespace-pre-wrap text-xs text-foreground/80">
                  {data.meeting_summary}
                </p>
              )}
              {data.action_items.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Action items
                  </p>
                  <ul className="space-y-0.5">
                    {data.action_items.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-1.5 text-xs text-foreground/80">
                        <span className="mt-0.5 shrink-0 text-muted-foreground">&bull;</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Editable form fields */}
          <fieldset disabled={isStreaming} className="contents">
            <div className="space-y-4 p-4">
              {/* Doc title input */}
              <div>
                <label
                  htmlFor="doc-title"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Doc title
                </label>
                <input
                  id="doc-title"
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="Meeting summary title..."
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Doc body textarea — monospace, pre-filled markdown */}
              <div>
                <label
                  htmlFor="doc-body"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Doc content
                </label>
                <textarea
                  id="doc-body"
                  value={docBody}
                  onChange={(e) => setDocBody(e.target.value)}
                  placeholder="Meeting notes in markdown..."
                  rows={12}
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Personalization signals — helper line */}
              {data.personalization_signals.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Context:</span>{' '}
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
