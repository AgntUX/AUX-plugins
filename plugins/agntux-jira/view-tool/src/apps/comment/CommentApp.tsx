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
import { buildCommentEnvelope } from './lib/build-envelope.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CommentPayload {
  cloud_id: string;
  issue_key: string;
  issue_url: string;
  issue_title: string;
  issue_status: string;
  issue_assignee: string | null;
  issue_priority: string | null;
  draft_body: string;
  personalization_signals: string[];
  generated_at: string;
}

// ── Payload parsing ───────────────────────────────────────────────────────────

function parsePayload(toolOutput?: Record<string, unknown>): { error: string } | CommentPayload {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const raw = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  if (typeof raw.error === 'string') return { error: raw.error };
  return {
    cloud_id: typeof raw.cloud_id === 'string' ? raw.cloud_id : '',
    issue_key: typeof raw.issue_key === 'string' ? raw.issue_key : '',
    issue_url: typeof raw.issue_url === 'string' ? raw.issue_url : '',
    issue_title: typeof raw.issue_title === 'string' ? raw.issue_title : '',
    issue_status: typeof raw.issue_status === 'string' ? raw.issue_status : '',
    issue_assignee: typeof raw.issue_assignee === 'string' ? raw.issue_assignee : null,
    issue_priority: typeof raw.issue_priority === 'string' ? raw.issue_priority : null,
    draft_body: typeof raw.draft_body === 'string' ? raw.draft_body : '',
    personalization_signals: Array.isArray(raw.personalization_signals)
      ? (raw.personalization_signals as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : '',
  };
}

// ── App shell ─────────────────────────────────────────────────────────────────

export function CommentApp() {
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
        <CommentView
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

interface CommentViewProps {
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

function CommentView({ toolOutput, isStreaming, callTool, displayMode }: CommentViewProps) {
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // Sending state
  const [body, setBody] = useState<string | null>(null);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [discarded, setDiscarded] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Loading skeleton
  if (!toolOutput) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4" data-testid="loading-skeleton">
        <div className="mx-auto max-w-xl">
          <div className="mb-4 h-16 animate-pulse rounded-lg bg-muted" />
          <div className="mb-2 h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  if ('error' in data) {
    const msgs: Record<string, string> = {
      action_not_found: 'This action item could not be found.',
      action_already_handled: 'This action has already been completed.',
      comment_payload_missing: 'Comment data is unavailable for this action.',
    };
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{msgs[data.error] ?? 'Unable to load comment view.'}</p>
      </div>
    );
  }

  const effectiveBody = body ?? data.draft_body;
  const canSend = effectiveBody.trim().length > 0 && sendState === 'idle';

  if (discarded) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Comment discarded. No changes were made.</p>
      </div>
    );
  }

  if (sendState === 'sent') {
    return (
      <div className="h-full overflow-y-auto bg-background p-4 flex items-center justify-center">
        <p className="text-sm text-foreground font-medium">Comment posted to {data.issue_key}.</p>
      </div>
    );
  }

  async function handleSend() {
    if (!canSend || 'error' in data) return;
    setSendState('sending');
    try {
      const envelope = buildCommentEnvelope({
        cloudId: data.cloud_id,
        issueIdOrKey: data.issue_key,
        commentBody: effectiveBody,
      });
      await callTool(envelope.toolName, envelope.args);
      setSendState('sent');
    } catch (e) {
      setSendState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to post comment.');
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      <p className="text-xs text-muted-foreground">
        Posts as you to {data.issue_key}
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
          {sendState === 'sending' ? 'Posting...' : 'Post comment'}
        </button>
      </div>
    </div>
  );

  return (
    <ScrollablePanel
      title={
        <span className="text-sm font-semibold text-foreground">
          Comment on {data.issue_key || 'issue'}
        </span>
      }
      footer={footer}
    >
      <div className="px-4 pt-4 pb-2">
        <IssueHeaderCard
          issueKey={data.issue_key}
          issueTitle={data.issue_title}
          issueUrl={data.issue_url}
          badge={data.issue_status}
        />
        <fieldset disabled={isStreaming || sendState !== 'idle'} className="contents">
          <label className="block mb-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Comment</span>
            <textarea
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y min-h-[120px]"
              value={effectiveBody}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write a comment..."
              rows={6}
            />
          </label>
        </fieldset>
        {sendState === 'error' && (
          <p className="mt-2 text-xs text-destructive">{errorMsg}</p>
        )}
      </div>
    </ScrollablePanel>
  );
}
