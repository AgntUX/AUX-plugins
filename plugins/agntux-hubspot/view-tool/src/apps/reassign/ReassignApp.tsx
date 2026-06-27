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
import { RecordHeaderCard } from '../../components/record-header-card.js';
import { buildReassignEnvelope } from './lib/build-envelope.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CandidateOwner { ownerId: string; name: string }

interface ReassignPayload {
  record_url: string;
  record_id: string;
  record_type: string;
  record_name: string;
  current_owner: string;
  candidate_owners: CandidateOwner[];
}

// ── Payload parsing ───────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

function parseOwner(x: unknown): CandidateOwner | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const ownerId = str(r.ownerId);
  if (!ownerId) return null;
  return { ownerId, name: str(r.name) };
}

function parsePayload(toolOutput?: Record<string, unknown>): { error: string } | ReassignPayload {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const raw = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  if (typeof raw.error === 'string') return { error: raw.error };
  const rawOwners = Array.isArray(raw.candidate_owners) ? raw.candidate_owners : [];
  const candidate_owners: CandidateOwner[] = rawOwners
    .map(parseOwner)
    .filter((o): o is CandidateOwner => o !== null);
  return {
    record_url: str(raw.record_url),
    record_id: str(raw.record_id),
    record_type: str(raw.record_type),
    record_name: str(raw.record_name),
    current_owner: str(raw.current_owner),
    candidate_owners,
  };
}

// ── Owner initials ────────────────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// ── App shell ─────────────────────────────────────────────────────────────────

export function ReassignApp() {
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
        <ReassignView
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

interface ReassignViewProps {
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

function ReassignView({ toolOutput, isStreaming, sendFollowUpMessage }: ReassignViewProps) {
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
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
      reassign_payload_missing: 'Reassign data is unavailable for this action.',
    };
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{msgs[data.error] ?? 'Unable to load reassign view.'}</p>
      </div>
    );
  }

  const effectiveOwnerId = selectedOwnerId ?? '';
  const canSend = !!effectiveOwnerId && sendState === 'idle';

  if (discarded) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Discarded. Owner is unchanged.</p>
      </div>
    );
  }

  if (sendState === 'sent') {
    const selectedOwner = data.candidate_owners.find((o) => o.ownerId === effectiveOwnerId);
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-foreground font-medium">
          {data.record_name || 'Record'} reassigned to {selectedOwner?.name ?? effectiveOwnerId}.
        </p>
      </div>
    );
  }

  async function handleSend() {
    if (!canSend || !('record_id' in data)) return;
    setSendState('sending');
    try {
      const envelope = buildReassignEnvelope({
        recordId: data.record_id,
        recordType: data.record_type || 'CONTACT',
        ownerId: effectiveOwnerId,
      });
      await sendFollowUpMessage(envelope.envelopeText);
      setSendState('sent');
    } catch (e) {
      setSendState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to reassign record.');
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      <p className="text-xs text-muted-foreground">
        Currently owned by <span className="font-medium">{data.current_owner || 'Unknown'}</span>
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
          {sendState === 'sending' ? 'Reassigning...' : 'Reassign'}
        </button>
      </div>
    </div>
  );

  return (
    <ScrollablePanel
      title={
        <span className="text-sm font-semibold text-foreground">
          Reassign {data.record_type ? data.record_type.toLowerCase() : 'record'}
        </span>
      }
      footer={footer}
    >
      <div className="px-4 pt-4 pb-2">
        <RecordHeaderCard
          recordName={data.record_name}
          recordType={data.record_type || undefined}
          recordUrl={data.record_url}
        />
        <p className="mb-3 text-sm text-muted-foreground">
          Currently owned by <span className="font-medium text-foreground">{data.current_owner || 'Unknown'}</span>
        </p>
        <fieldset disabled={isStreaming || sendState !== 'idle'} className="contents">
          <div className="mb-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Assign to</p>
            <div className="space-y-1.5">
              {data.candidate_owners.map((o) => (
                <label
                  key={o.ownerId}
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    type="radio"
                    name="owner"
                    value={o.ownerId}
                    checked={effectiveOwnerId === o.ownerId}
                    onChange={() => setSelectedOwnerId(o.ownerId)}
                    className="accent-primary h-4 w-4 shrink-0"
                  />
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary shrink-0">
                    {initials(o.name)}
                  </span>
                  <span className="text-sm text-foreground">{o.name}</span>
                </label>
              ))}
              {data.candidate_owners.length === 0 && (
                <p className="text-xs text-muted-foreground py-2 text-center">No team members available</p>
              )}
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
