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
import { buildMoveDealEnvelope } from './lib/build-envelope.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DealStage { id: string; label: string }

interface MoveDealPayload {
  deal_url: string;
  deal_id: string;
  deal_name: string;
  pipeline_label: string;
  current_stage: string;
  available_stages: DealStage[];
  amount: string;
  currency_code: string;
  close_date: string;
}

// ── Payload parsing ───────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

function parseStage(x: unknown): DealStage | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  return { id, label: str(r.label) };
}

function parsePayload(toolOutput?: Record<string, unknown>): { error: string } | MoveDealPayload {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const raw = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  if (typeof raw.error === 'string') return { error: raw.error };
  const rawStages = Array.isArray(raw.available_stages) ? raw.available_stages : [];
  const available_stages: DealStage[] = rawStages
    .map(parseStage)
    .filter((s): s is DealStage => s !== null);
  return {
    deal_url: str(raw.deal_url),
    deal_id: str(raw.deal_id),
    deal_name: str(raw.deal_name),
    pipeline_label: str(raw.pipeline_label),
    current_stage: str(raw.current_stage),
    available_stages,
    amount: str(raw.amount),
    currency_code: str(raw.currency_code),
    close_date: str(raw.close_date),
  };
}

// ── App shell ─────────────────────────────────────────────────────────────────

export function MoveDealApp() {
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
        <MoveDealView
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

interface MoveDealViewProps {
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

function MoveDealView({ toolOutput, isStreaming, sendFollowUpMessage }: MoveDealViewProps) {
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
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
      move_deal_payload_missing: 'Deal data is unavailable for this action.',
    };
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{msgs[data.error] ?? 'Unable to load deal view.'}</p>
      </div>
    );
  }

  // Find the current stage object to pre-select it and label it in the list
  const currentStageObj = data.available_stages.find(
    (s) => s.label === data.current_stage || s.id === data.current_stage
  );
  const effectiveStageId = selectedStageId ?? currentStageObj?.id ?? (data.available_stages[0]?.id ?? '');
  const canSend = !!effectiveStageId && sendState === 'idle';

  if (discarded) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Discarded. Deal stage is unchanged.</p>
      </div>
    );
  }

  if (sendState === 'sent') {
    const selectedStage = data.available_stages.find((s) => s.id === effectiveStageId);
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-foreground font-medium">
          Deal moved to {selectedStage?.label ?? effectiveStageId}.
        </p>
      </div>
    );
  }

  // Build deal meta line: pipeline - amount - close date (ASCII separators)
  const metaParts: string[] = [];
  if (data.pipeline_label) metaParts.push(data.pipeline_label);
  if (data.amount) {
    const amountStr = data.currency_code ? data.currency_code + ' ' + data.amount : data.amount;
    metaParts.push(amountStr);
  }
  if (data.close_date) metaParts.push('Closes ' + data.close_date);
  const dealMeta = metaParts.join(' - ');

  async function handleSend() {
    if (!canSend || !('deal_id' in data)) return;
    setSendState('sending');
    try {
      const envelope = buildMoveDealEnvelope({
        dealId: data.deal_id,
        stageId: effectiveStageId,
      });
      await sendFollowUpMessage(envelope.envelopeText);
      setSendState('sent');
    } catch (e) {
      setSendState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to update deal stage.');
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      <p className="text-xs text-muted-foreground">
        Current: <span className="font-medium">{data.current_stage || 'Unknown'}</span>
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
          {sendState === 'sending' ? 'Updating...' : 'Update stage'}
        </button>
      </div>
    </div>
  );

  return (
    <ScrollablePanel
      title={
        <span className="text-sm font-semibold text-foreground">
          Move deal
        </span>
      }
      footer={footer}
    >
      <div className="px-4 pt-4 pb-2">
        <RecordHeaderCard
          recordName={data.deal_name}
          recordType="Deal"
          recordUrl={data.deal_url}
          badge={data.current_stage}
          meta={dealMeta || undefined}
        />
        <fieldset disabled={isStreaming || sendState !== 'idle'} className="contents">
          <div className="mb-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Move to stage</p>
            <div className="space-y-1.5">
              {data.available_stages.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    type="radio"
                    name="stage"
                    value={s.id}
                    checked={effectiveStageId === s.id}
                    onChange={() => setSelectedStageId(s.id)}
                    className="accent-primary h-4 w-4"
                  />
                  <span className="text-sm text-foreground">{s.label}</span>
                  {s.id === currentStageObj?.id
                    ? <span className="ml-auto text-xs text-muted-foreground">Current</span>
                    : null}
                </label>
              ))}
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
