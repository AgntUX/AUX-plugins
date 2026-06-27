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
import { buildCompleteTaskEnvelope, buildRescheduleTaskEnvelope } from './lib/build-envelope.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskPayload {
  task_url: string;
  task_id: string;
  task_title: string;
  due_date: string;
  status: string;
  associated_record_name: string;
  modes: string[];
}

type ActiveMode = 'complete' | 'reschedule';

// ── Payload parsing ───────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

function parsePayload(toolOutput?: Record<string, unknown>): { error: string } | TaskPayload {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const raw = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  if (typeof raw.error === 'string') return { error: raw.error };
  const modes = Array.isArray(raw.modes)
    ? (raw.modes as unknown[]).filter((x): x is string => typeof x === 'string')
    : ['complete', 'reschedule'];
  return {
    task_url: str(raw.task_url),
    task_id: str(raw.task_id),
    task_title: str(raw.task_title),
    due_date: str(raw.due_date),
    status: str(raw.status),
    associated_record_name: str(raw.associated_record_name),
    modes: modes.length > 0 ? modes : ['complete', 'reschedule'],
  };
}

// ── App shell ─────────────────────────────────────────────────────────────────

export function TaskApp() {
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
        <TaskView
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

interface TaskViewProps {
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

function TaskView({ toolOutput, isStreaming, sendFollowUpMessage }: TaskViewProps) {
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [activeMode, setActiveMode] = useState<ActiveMode>('complete');
  const [newDueDate, setNewDueDate] = useState('');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [discarded, setDiscarded] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!toolOutput) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4" data-testid="loading-skeleton">
        <div className="mx-auto max-w-xl">
          <div className="mb-4 h-16 animate-pulse rounded-lg bg-muted" />
          <div className="mb-3 h-8 animate-pulse rounded-lg bg-muted" />
          <div className="h-12 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  if ('error' in data) {
    const msgs: Record<string, string> = {
      action_not_found: 'This action item could not be found.',
      action_already_handled: 'This action has already been completed.',
      task_payload_missing: 'Task data is unavailable for this action.',
    };
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{msgs[data.error] ?? 'Unable to load task view.'}</p>
      </div>
    );
  }

  const canSend =
    sendState === 'idle' &&
    (activeMode === 'complete' || (activeMode === 'reschedule' && newDueDate.trim().length > 0));

  if (discarded) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Discarded. Task is unchanged.</p>
      </div>
    );
  }

  if (sendState === 'sent') {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-foreground font-medium">
          {activeMode === 'complete'
            ? `Task marked complete.`
            : `Task rescheduled to ${newDueDate}.`}
        </p>
      </div>
    );
  }

  async function handleSend() {
    if (!canSend || !('task_id' in data)) return;
    setSendState('sending');
    try {
      let envelope;
      if (activeMode === 'complete') {
        envelope = buildCompleteTaskEnvelope({ taskId: data.task_id });
      } else {
        envelope = buildRescheduleTaskEnvelope({ taskId: data.task_id, newDueDate });
      }
      await sendFollowUpMessage(envelope.envelopeText);
      setSendState('sent');
    } catch (e) {
      setSendState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to update task.');
    }
  }

  const sendLabel = sendState === 'sending'
    ? (activeMode === 'complete' ? 'Completing...' : 'Rescheduling...')
    : (activeMode === 'complete' ? 'Mark complete' : 'Reschedule');

  const footer = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      <p className="text-xs text-muted-foreground">
        {data.due_date ? `Due ${data.due_date}` : 'HubSpot task'}
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
          {sendLabel}
        </button>
      </div>
    </div>
  );

  const taskMeta = data.associated_record_name ? `Associated with ${data.associated_record_name}` : undefined;

  return (
    <ScrollablePanel
      title={
        <span className="text-sm font-semibold text-foreground">
          Update task
        </span>
      }
      footer={footer}
    >
      <div className="px-4 pt-4 pb-2">
        <RecordHeaderCard
          recordName={data.task_title}
          recordType="Task"
          recordUrl={data.task_url}
          badge={data.status || undefined}
          meta={taskMeta}
        />
        <fieldset disabled={isStreaming || sendState !== 'idle'} className="contents">
          {/* Mode tabs */}
          <div className="mb-4 flex rounded-lg border border-border overflow-hidden">
            {(['complete', 'reschedule'] as ActiveMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  activeMode === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                }`}
                onClick={() => setActiveMode(mode)}
              >
                {mode === 'complete' ? 'Complete' : 'Reschedule'}
              </button>
            ))}
          </div>

          {activeMode === 'complete' && (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
              <p className="text-sm text-foreground">
                Mark <span className="font-semibold">{data.task_title || 'this task'}</span> as completed in HubSpot.
              </p>
              {data.associated_record_name && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Associated with {data.associated_record_name}
                </p>
              )}
            </div>
          )}

          {activeMode === 'reschedule' && (
            <div>
              <label>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  New due date
                </span>
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                />
              </label>
            </div>
          )}
        </fieldset>
        {sendState === 'error' && (
          <p className="mt-2 text-xs text-destructive">{errorMsg}</p>
        )}
      </div>
    </ScrollablePanel>
  );
}
