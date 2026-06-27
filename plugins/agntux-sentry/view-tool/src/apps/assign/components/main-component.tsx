// Layout: quoted issue card (short id + title) → radio list of candidates → Send footer.
// "Me" first if present, then teammates (user), then teams.
// Design rules: light mode only, semantic tokens, one Send button, ScrollablePanel, no modals.

import { useMemo, useState } from 'react';
import { safeString, safeArray, ScrollablePanel } from "@agntux/ui-primitives";
import { useAppsClient } from '../../../lib/apps-react/index.js';
import { buildEnvelope, type AssigneeKind } from '../lib/build-envelope.js';

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

interface Candidate {
  id: string;
  label: string;
  kind: AssigneeKind;
}

type SendState = 'idle' | 'loading' | 'success' | 'error';

// ── parsePayload ─────────────────────────────────────────────────────────────

function parsePayload(toolOutput?: Record<string, unknown>) {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;

  const rawCandidates = safeArray<unknown>(payload.candidate_assignees);
  const candidates: Candidate[] = rawCandidates
    .map((c): Candidate | null => {
      if (!c || typeof c !== 'object') return null;
      const obj = c as Record<string, unknown>;
      const id = safeString(obj.id);
      const label = safeString(obj.label);
      const kind: AssigneeKind =
        obj.kind === 'team' ? 'team' : 'user';
      return id && label ? { id, label, kind } : null;
    })
    .filter((c): c is Candidate => c !== null);

  return {
    issue_url: safeString(payload.issue_url),
    issue_short_id: safeString(payload.issue_short_id),
    issue_title: safeString(payload.issue_title),
    current_assignee: safeString(payload.current_assignee),
    candidates,
  };
}

// Sort: "Me" first, then users alphabetically, then teams alphabetically.
function sortCandidates(candidates: Candidate[]): Candidate[] {
  const me = candidates.filter((c) => c.label === 'Me');
  const users = candidates.filter((c) => c.kind === 'user' && c.label !== 'Me');
  const teams = candidates.filter((c) => c.kind === 'team');
  users.sort((a, b) => a.label.localeCompare(b.label));
  teams.sort((a, b) => a.label.localeCompare(b.label));
  return [...me, ...users, ...teams];
}

// ── Component ────────────────────────────────────────────────────────────────

export function MainComponent(props: MainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const client = useAppsClient();

  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);
  const sorted = useMemo(() => sortCandidates(data.candidates), [data.candidates]);

  // Selected candidate id — seeds from current_assignee match.
  const [selectedId, setSelectedId] = useState('');
  const [seeded, setSeeded] = useState(false);
  if (!seeded && toolOutput !== undefined) {
    // Pre-select the candidate whose label matches current_assignee (if any).
    const match = sorted.find((c) => c.label === data.current_assignee || c.id === data.current_assignee);
    if (match) setSelectedId(match.id);
    else if (sorted.length > 0) setSelectedId(sorted[0].id);
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

  const selectedCandidate = sorted.find((c) => c.id === selectedId);

  async function handleSend() {
    if (!selectedCandidate || isSending || sendSuccess) return;
    setSendState('loading');
    setSendErrorMsg('');
    try {
      const envelope = buildEnvelope({
        issueUrl: data.issue_url,
        assigneeId: selectedCandidate.id,
        assigneeLabel: selectedCandidate.label,
        assigneeKind: selectedCandidate.kind,
      });
      await sendFollowUpMessage(envelope);
      setSendState('success');
    } catch (err) {
      setSendState('error');
      setSendErrorMsg(err instanceof Error ? err.message : 'Failed to assign issue');
    }
  }

  function handleOpenInSentry() {
    if (data.issue_url) void client.openLink(data.issue_url);
  }

  return (
    <ScrollablePanel
      title={
        <IssueHeader
          shortId={data.issue_short_id}
          title={data.issue_title}
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
          selectedLabel={selectedCandidate?.label}
        />
      }
    >
      <fieldset
        disabled={!!isStreaming || isSending || sendSuccess}
        className="contents"
        aria-busy={isStreaming ? 'true' : 'false'}
      >
        <StreamingIndicator visible={!!isStreaming} />

        {/* Assignee radio list */}
        <section aria-label="Select assignee" className="mx-4 mt-3">
          <p className="mb-2 text-xs font-medium text-foreground">Assign to</p>

          {sorted.length === 0 ? (
            <p className="text-xs text-muted-foreground">No candidates available.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {sorted.map((c) => (
                <label
                  key={c.id}
                  className={[
                    'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5',
                    'text-sm transition-colors',
                    selectedId === c.id
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border bg-background text-foreground hover:bg-muted/40',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="assignee"
                    value={c.id}
                    checked={selectedId === c.id}
                    onChange={() => setSelectedId(c.id)}
                    className="accent-primary"
                  />
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span>{c.label}</span>
                    {c.kind === 'team' && (
                      <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                        team
                      </span>
                    )}
                  </span>
                </label>
              ))}
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
            {data.issue_short_id || 'Issue'} assigned to {selectedCandidate?.label ?? 'assignee'}.
          </div>
        )}
      </fieldset>
    </ScrollablePanel>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function IssueHeader({
  shortId,
  title,
  onOpen,
  hasUrl,
}: {
  shortId: string;
  title: string;
  onOpen: () => void;
  hasUrl: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
      <div className="min-w-0">
        <span className="font-mono text-xs font-semibold text-muted-foreground">
          {shortId || '—'}
        </span>
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
  selectedLabel,
}: {
  sendState: SendState;
  sendErrorMsg: string;
  onSend: () => void;
  isStreaming: boolean;
  selectedLabel: string | undefined;
}) {
  const isSending = sendState === 'loading';
  const sendSuccess = sendState === 'success';

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border bg-background px-4 py-3">
      <p className="text-xs text-muted-foreground">
        {sendSuccess
          ? `Assigned to ${selectedLabel ?? 'assignee'}.`
          : selectedLabel
          ? `Will assign to ${selectedLabel}.`
          : 'Select an assignee above.'}
      </p>
      <div className="flex flex-col items-end gap-1">
        {sendState === 'error' && (
          <p role="alert" aria-live="assertive" className="text-xs text-destructive">
            {sendErrorMsg || 'Failed to assign — try again.'}
          </p>
        )}
        <button
          type="button"
          onClick={onSend}
          disabled={isStreaming || isSending || sendSuccess || !selectedLabel}
          aria-busy={isSending}
          aria-label={selectedLabel ? `Assign issue to ${selectedLabel}` : 'Assign issue'}
          className={[
            'inline-flex items-center gap-2 rounded-md px-4 py-2',
            'bg-primary text-primary-foreground text-sm font-medium',
            'hover:opacity-90 transition-opacity',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          ].join(' ')}
        >
          {isSending && <Spinner className="h-3.5 w-3.5" />}
          {isSending ? 'Assigning…' : sendSuccess ? 'Assigned' : 'Assign issue'}
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
      {[1, 2, 3].map((i) => (
        <div key={i} className="mb-2 h-10 w-full animate-pulse rounded-md bg-muted" />
      ))}
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
