import { useMemo, useState } from 'react';
import { ScrollablePanel } from "@agntux/ui-primitives";
import { ExternalLink } from '../../components/external-link.js';
import { buildEnvelope } from './lib/build-envelope.js';

export interface CommentMainComponentProps {
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

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parsePayload(toolOutput?: Record<string, unknown>) {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    action_id: str(payload.action_id),
    page_id: str(payload.page_id),
    discussion_id: str(payload.discussion_id),
    page_url: str(payload.page_url),
    page_title: str(payload.page_title),
    comment_thread: str(payload.comment_thread),
    draft_body: str(payload.draft_body),
    personalization_signals: str(payload.personalization_signals),
  };
}

export function CommentMainComponent(props: CommentMainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [replyBody, setReplyBody] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  // Pre-fill draft body when data first arrives (and user hasn't typed yet)
  const effectiveBody = replyBody !== '' ? replyBody : data.draft_body;

  const isLoading = !toolOutput;

  const handleSend = async () => {
    if (!effectiveBody.trim() || sending || sent) return;
    setSending(true);
    try {
      // page_id and discussion_id are surfaced from the action file's frontmatter
      // by the view tool (handleComment reads fm.page_id and fm.discussion_id).
      // These are distinct Notion UUIDs: page_id identifies the Notion page,
      // discussion_id identifies the specific comment thread within that page.
      // The ingest skill writes both to the action frontmatter alongside page_url.
      const envelope = buildEnvelope({
        pageId: data.page_id,
        discussionId: data.discussion_id,
        body: effectiveBody,
        actionId: data.action_id,
      });
      await sendFollowUpMessage(envelope);
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  const header = (
    <div className="flex items-center gap-2 min-w-0">
      <span className="font-medium text-foreground truncate">
        {data.page_title || 'Reply to comment'}
      </span>
      {data.page_url && (
        <ExternalLink
          href={data.page_url}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground flex-shrink-0"
          ariaLabel="Open in Notion"
        >
          Open in Notion
        </ExternalLink>
      )}
    </div>
  );

  const footer = sent ? null : (
    <div className="flex justify-end px-4 py-3">
      <button
        type="button"
        onClick={() => { void handleSend(); }}
        disabled={isStreaming || sending || !effectiveBody.trim()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sending ? 'Posting...' : 'Post comment'}
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4" data-testid="loading-skeleton">
        <div className="mb-4 h-5 w-48 animate-pulse rounded-md bg-muted" />
        <div className="mb-3 h-24 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-20 w-full animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  return (
    <ScrollablePanel title={header} footer={footer}>
      <fieldset disabled={isStreaming} className="contents">
        <div className="px-4 pt-3 pb-2 space-y-4">
          {sent && (
            <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
              Comment posted. The action item is still open in Notion.
            </div>
          )}

          {/* Quoted comment thread */}
          {data.comment_thread && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Comment thread
              </p>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground whitespace-pre-wrap">
                {data.comment_thread}
              </div>
            </div>
          )}

          {/* Personalization signals */}
          {data.personalization_signals && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Context
              </p>
              <p className="text-xs text-muted-foreground">{data.personalization_signals}</p>
            </div>
          )}

          {/* Reply editor */}
          {!sent && (
            <div>
              <label
                htmlFor="notion-reply-body"
                className="mb-1 block text-xs font-medium text-muted-foreground uppercase tracking-wide"
              >
                Your reply
              </label>
              <textarea
                id="notion-reply-body"
                rows={6}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                placeholder="Write your reply..."
                value={effectiveBody}
                onChange={(e) => setReplyBody(e.target.value)}
              />
            </div>
          )}
        </div>
      </fieldset>
    </ScrollablePanel>
  );
}
