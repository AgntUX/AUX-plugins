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
import { buildEditEnvelope } from './lib/build-envelope.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EditPayload {
  cloud_id: string;
  issue_key: string;
  issue_url: string;
  current_summary: string;
  current_priority: string | null;
  current_labels: string[];
  available_priorities: string[];
  available_labels: string[];
  draft_summary: string | null;
  draft_priority: string | null;
  draft_labels: string[] | null;
  personalization_signals: string[];
  generated_at: string;
}

// ── Payload parsing ───────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function strOrNull(v: unknown): string | null { return typeof v === 'string' ? v : null; }
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function parsePayload(toolOutput?: Record<string, unknown>): { error: string } | EditPayload {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const raw = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  if (typeof raw.error === 'string') return { error: raw.error };
  const draft_labels_raw = raw.draft_labels;
  const draft_labels: string[] | null = Array.isArray(draft_labels_raw)
    ? draft_labels_raw.filter((x): x is string => typeof x === 'string')
    : null;
  return {
    cloud_id: str(raw.cloud_id),
    issue_key: str(raw.issue_key),
    issue_url: str(raw.issue_url),
    current_summary: str(raw.current_summary),
    current_priority: strOrNull(raw.current_priority),
    current_labels: strArray(raw.current_labels),
    available_priorities: strArray(raw.available_priorities),
    available_labels: strArray(raw.available_labels),
    draft_summary: strOrNull(raw.draft_summary),
    draft_priority: strOrNull(raw.draft_priority),
    draft_labels,
    personalization_signals: strArray(raw.personalization_signals),
    generated_at: str(raw.generated_at),
  };
}

// ── App shell ─────────────────────────────────────────────────────────────────

export function EditApp() {
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
        <EditView
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

interface EditViewProps {
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

function EditView({ toolOutput, isStreaming, callTool }: EditViewProps) {
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // Local form state — initialized lazily from data once available.
  const [summary, setSummary] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [labelInput, setLabelInput] = useState('');
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
      edit_payload_missing: 'Edit data is unavailable for this action.',
    };
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{msgs[data.error] ?? 'Unable to load edit view.'}</p>
      </div>
    );
  }

  // Effective values: form state if user edited; otherwise the suggested draft;
  // otherwise the current value.
  const effSummary = summary ?? data.draft_summary ?? data.current_summary;
  const effPriority = priority ?? data.draft_priority ?? data.current_priority;
  const effLabels = labels ?? data.draft_labels ?? data.current_labels;

  // Diff against current state — Send disabled on zero-diff.
  const summaryChanged = effSummary !== data.current_summary;
  const priorityChanged = effPriority !== data.current_priority;
  const labelsChanged =
    effLabels.length !== data.current_labels.length ||
    !effLabels.every((l, i) => l === data.current_labels[i]);
  const hasChanges = summaryChanged || priorityChanged || labelsChanged;

  if (discarded) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Discarded. Issue is unchanged.</p>
      </div>
    );
  }

  if (sendState === 'sent') {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-foreground font-medium">
          {data.issue_key} updated.
        </p>
      </div>
    );
  }

  function addLabel(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const base = effLabels;
    if (base.includes(trimmed)) {
      setLabelInput('');
      return;
    }
    setLabels([...base, trimmed]);
    setLabelInput('');
  }

  function removeLabel(label: string) {
    setLabels(effLabels.filter((l) => l !== label));
  }

  async function handleSend() {
    if (!hasChanges || sendState !== 'idle' || !('cloud_id' in data)) return;
    setSendState('sending');
    try {
      // Only changed fields go in the envelope.
      const fields: Record<string, unknown> = {};
      if (summaryChanged) fields.summary = effSummary;
      if (priorityChanged) {
        fields.priority = effPriority ? { name: effPriority } : null;
      }
      if (labelsChanged) fields.labels = effLabels;
      const envelope = buildEditEnvelope({
        cloudId: data.cloud_id,
        issueIdOrKey: data.issue_key,
        fields,
      });
      await callTool(envelope.toolName, envelope.args);
      setSendState('sent');
    } catch (e) {
      setSendState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to update issue.');
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      <p className="text-xs text-muted-foreground">
        {hasChanges ? 'Only changed fields are sent' : 'No changes yet'}
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
          disabled={!hasChanges || isStreaming || sendState !== 'idle'}
        >
          {sendState === 'sending' ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  );

  return (
    <ScrollablePanel
      title={
        <span className="text-sm font-semibold text-foreground">
          Edit {data.issue_key || 'issue'}
        </span>
      }
      footer={footer}
    >
      <div className="px-4 pt-4 pb-2">
        <IssueHeaderCard
          issueKey={data.issue_key}
          issueTitle={data.current_summary}
          issueUrl={data.issue_url}
        />
        <fieldset disabled={isStreaming || sendState !== 'idle'} className="contents">
          <div className="mb-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Summary
              </span>
              <input
                type="text"
                value={effSummary}
                onChange={(e) => setSummary(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>
          <div className="mb-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Priority
              </span>
              <select
                value={effPriority ?? ''}
                onChange={(e) => setPriority(e.target.value || null)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Unset —</option>
                {data.available_priorities.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-2">
              Labels
            </span>
            <div className="flex flex-wrap gap-1.5">
              {effLabels.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground"
                >
                  {label}
                  <button
                    type="button"
                    onClick={() => removeLabel(label)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${label}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addLabel(labelInput);
                  }
                }}
                onBlur={() => labelInput && addLabel(labelInput)}
                placeholder="Add label..."
                className="rounded-full border border-dashed border-border bg-background px-2.5 py-0.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[100px]"
                list="agntux-jira-label-suggestions"
              />
              <datalist id="agntux-jira-label-suggestions">
                {data.available_labels
                  .filter((l) => !effLabels.includes(l))
                  .map((l) => (
                    <option key={l} value={l} />
                  ))}
              </datalist>
            </div>
          </div>
        </fieldset>
        {sendState === 'error' && (
          <p className="mt-2 text-xs text-destructive">{errorMsg}</p>
        )}
      </div>
    </ScrollablePanel>
  );
}
