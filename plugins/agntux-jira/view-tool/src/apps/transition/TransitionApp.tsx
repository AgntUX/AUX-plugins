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
import { buildTransitionEnvelope } from './lib/build-envelope.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TransitionItem { id: string; name: string }

interface TransitionPayload {
  cloud_id: string;
  issue_key: string;
  issue_url: string;
  issue_title: string;
  current_state: string;
  available_transitions: TransitionItem[];
  suggested_transition_id: string;
  optional_comment: string | null;
  personalization_signals: string[];
  generated_at: string;
}

// ── Payload parsing ───────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

function parseTransitionItem(x: unknown): TransitionItem | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  return { id, name: str(r.name) };
}

function parsePayload(toolOutput?: Record<string, unknown>): { error: string } | TransitionPayload {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const raw = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  if (typeof raw.error === 'string') return { error: raw.error };
  const rawTrans = Array.isArray(raw.available_transitions) ? raw.available_transitions : [];
  const available_transitions: TransitionItem[] = rawTrans
    .map(parseTransitionItem)
    .filter((t): t is TransitionItem => t !== null);
  return {
    cloud_id: str(raw.cloud_id),
    issue_key: str(raw.issue_key),
    issue_url: str(raw.issue_url),
    issue_title: str(raw.issue_title),
    current_state: str(raw.current_state),
    available_transitions,
    suggested_transition_id: str(raw.suggested_transition_id),
    optional_comment: typeof raw.optional_comment === 'string' ? raw.optional_comment : null,
    personalization_signals: Array.isArray(raw.personalization_signals)
      ? (raw.personalization_signals as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    generated_at: str(raw.generated_at),
  };
}

// ── App shell ─────────────────────────────────────────────────────────────────

export function TransitionApp() {
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
        <TransitionView
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

interface TransitionViewProps {
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

function TransitionView({ toolOutput, isStreaming, callTool }: TransitionViewProps) {
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [discarded, setDiscarded] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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
      transition_payload_missing: 'Transition data is unavailable for this action.',
    };
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{msgs[data.error] ?? 'Unable to load transition view.'}</p>
      </div>
    );
  }

  const effectiveId = selectedId ?? data.suggested_transition_id;
  const canSend = !!effectiveId && sendState === 'idle';

  if (discarded) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Discarded. Issue status is unchanged.</p>
      </div>
    );
  }

  if (sendState === 'sent') {
    const selectedTransition = data.available_transitions.find((t) => t.id === effectiveId);
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-foreground font-medium">
          {data.issue_key} moved to {selectedTransition?.name ?? effectiveId}.
        </p>
      </div>
    );
  }

  async function handleSend() {
    if (!canSend || !('cloud_id' in data)) return;
    setSendState('sending');
    try {
      const envelope = buildTransitionEnvelope({
        cloudId: data.cloud_id,
        issueIdOrKey: data.issue_key,
        transitionId: effectiveId!,
        note,
      });
      await callTool(envelope.toolName, envelope.args);
      setSendState('sent');
    } catch (e) {
      setSendState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to transition issue.');
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      <p className="text-xs text-muted-foreground">
        Current: <span className="font-medium">{data.current_state}</span>
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
          {sendState === 'sending' ? 'Moving...' : 'Move issue'}
        </button>
      </div>
    </div>
  );

  return (
    <ScrollablePanel
      title={
        <span className="text-sm font-semibold text-foreground">
          Move {data.issue_key || 'issue'}
        </span>
      }
      footer={footer}
    >
      <div className="px-4 pt-4 pb-2">
        <IssueHeaderCard
          issueKey={data.issue_key}
          issueTitle={data.issue_title}
          issueUrl={data.issue_url}
          badge={data.current_state}
        />
        <fieldset disabled={isStreaming || sendState !== 'idle'} className="contents">
          <div className="mb-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Move to</p>
            <div className="space-y-1.5">
              {data.available_transitions.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    type="radio"
                    name="transition"
                    value={t.id}
                    checked={effectiveId === t.id}
                    onChange={() => setSelectedId(t.id)}
                    className="accent-primary h-4 w-4"
                  />
                  <span className="text-sm text-foreground">{t.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Add a note (optional)
              </span>
              <textarea
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[72px]"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional transition comment..."
                rows={3}
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
