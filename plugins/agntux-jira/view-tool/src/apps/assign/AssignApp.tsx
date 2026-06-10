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
import { buildAssignEnvelope } from './lib/build-envelope.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AssigneeCandidate { account_id: string; display_name: string }
interface CurrentAssignee { account_id: string; display_name: string }

interface AssignPayload {
  cloud_id: string;
  issue_key: string;
  issue_url: string;
  issue_title: string;
  current_assignee: CurrentAssignee | null;
  candidate_assignees: AssigneeCandidate[];
  suggested_assignee_account_id: string | null;
  personalization_signals: string[];
  generated_at: string;
}

// ── Payload parsing ───────────────────────────────────────────────────────────

const UNASSIGN_ID = '__unassign__';

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

function parsePayload(toolOutput?: Record<string, unknown>): { error: string } | AssignPayload {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const raw = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  if (typeof raw.error === 'string') return { error: raw.error };

  let current_assignee: CurrentAssignee | null = null;
  if (raw.current_assignee && typeof raw.current_assignee === 'object' && !Array.isArray(raw.current_assignee)) {
    const ca = raw.current_assignee as Record<string, unknown>;
    current_assignee = { account_id: str(ca.account_id), display_name: str(ca.display_name) };
  }

  const rawCandidates = Array.isArray(raw.candidate_assignees) ? raw.candidate_assignees : [];
  const candidate_assignees: AssigneeCandidate[] = rawCandidates
    .map((x): AssigneeCandidate | null => {
      if (!x || typeof x !== 'object') return null;
      const r = x as Record<string, unknown>;
      return { account_id: str(r.account_id), display_name: str(r.display_name) };
    })
    .filter((c): c is AssigneeCandidate => c !== null);

  return {
    cloud_id: str(raw.cloud_id),
    issue_key: str(raw.issue_key),
    issue_url: str(raw.issue_url),
    issue_title: str(raw.issue_title),
    current_assignee,
    candidate_assignees,
    suggested_assignee_account_id: typeof raw.suggested_assignee_account_id === 'string'
      ? raw.suggested_assignee_account_id
      : null,
    personalization_signals: Array.isArray(raw.personalization_signals)
      ? (raw.personalization_signals as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    generated_at: str(raw.generated_at),
  };
}

// ── Avatar initials ───────────────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// ── App shell ─────────────────────────────────────────────────────────────────

export function AssignApp() {
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
        <AssignView
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

interface AssignViewProps {
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

function AssignView({ toolOutput, isStreaming, callTool }: AssignViewProps) {
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
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
      assign_payload_missing: 'Assign data is unavailable for this action.',
    };
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{msgs[data.error] ?? 'Unable to load assign view.'}</p>
      </div>
    );
  }

  // Build the full candidate list including Unassign option
  const allCandidates: Array<AssigneeCandidate & { isUnassign?: boolean }> = [
    ...data.candidate_assignees,
    { account_id: UNASSIGN_ID, display_name: 'Unassigned', isUnassign: true },
  ];

  const filteredCandidates = filter.trim()
    ? allCandidates.filter((c) =>
        c.display_name.toLowerCase().includes(filter.toLowerCase())
      )
    : allCandidates;

  const effectiveAccountId = selectedAccountId ?? data.suggested_assignee_account_id ?? '';
  const canSend = !!effectiveAccountId && sendState === 'idle';

  if (discarded) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Discarded. Assignee is unchanged.</p>
      </div>
    );
  }

  if (sendState === 'sent') {
    const selected = allCandidates.find((c) => c.account_id === effectiveAccountId);
    const label = selected?.isUnassign ? 'Unassigned' : (selected?.display_name ?? effectiveAccountId);
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-foreground font-medium">
          {data.issue_key} assigned to {label}.
        </p>
      </div>
    );
  }

  async function handleSend() {
    if (!canSend || !('cloud_id' in data)) return;
    setSendState('sending');
    try {
      const isUnassign = effectiveAccountId === UNASSIGN_ID;
      const envelope = buildAssignEnvelope({
        cloudId: data.cloud_id,
        issueIdOrKey: data.issue_key,
        accountId: isUnassign ? null : effectiveAccountId,
      });
      await callTool(envelope.toolName, envelope.args);
      setSendState('sent');
    } catch (e) {
      setSendState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to assign issue.');
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      <p className="text-xs text-muted-foreground">
        Currently: {data.current_assignee?.display_name ?? 'Unassigned'}
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
          {sendState === 'sending' ? 'Assigning...' : 'Assign'}
        </button>
      </div>
    </div>
  );

  return (
    <ScrollablePanel
      title={
        <span className="text-sm font-semibold text-foreground">
          Assign {data.issue_key || 'issue'}
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
            <label>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Assign to
              </span>
              <input
                type="search"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Search people..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
          </div>
          <div className="space-y-1.5">
            {filteredCandidates.map((c) => (
              <label
                key={c.account_id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="assignee"
                  value={c.account_id}
                  checked={effectiveAccountId === c.account_id}
                  onChange={() => setSelectedAccountId(c.account_id)}
                  className="accent-primary h-4 w-4 shrink-0"
                />
                {c.isUnassign ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground shrink-0">
                    —
                  </span>
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary shrink-0">
                    {initials(c.display_name)}
                  </span>
                )}
                <span className="text-sm text-foreground">{c.display_name}</span>
              </label>
            ))}
            {filteredCandidates.length === 0 && (
              <p className="text-xs text-muted-foreground py-2 text-center">No matches</p>
            )}
          </div>
        </fieldset>
        {sendState === 'error' && (
          <p className="mt-2 text-xs text-destructive">{errorMsg}</p>
        )}
      </div>
    </ScrollablePanel>
  );
}
