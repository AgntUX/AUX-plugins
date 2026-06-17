import { useEffect, useMemo, useState } from 'react';
import { ScrollablePanel, ComponentErrorBoundary } from "@agntux/ui-primitives";
import { buildEnvelope } from '../../apps/create-note/lib/build-envelope.js';
import type { MainComponentProps } from '../shared/MainComponentProps.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface CreateNoteData {
  action_id: string;
  source_context: string;
  draft_title: string;
  draft_body: string;
  target_folder: string;
  available_folders: string[];
}

// ── parsePayload ─────────────────────────────────────────────────────────────

function parsePayload(toolOutput?: Record<string, unknown>): CreateNoteData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;

  const rawFolders = payload.available_folders;
  const folders: string[] = Array.isArray(rawFolders)
    ? rawFolders.filter((f): f is string => typeof f === 'string')
    : [];

  return {
    action_id: typeof payload.action_id === 'string' ? payload.action_id : '',
    source_context:
      typeof payload.source_context === 'string' ? payload.source_context : '',
    draft_title:
      typeof payload.draft_title === 'string' ? payload.draft_title : '',
    draft_body:
      typeof payload.draft_body === 'string' ? payload.draft_body : '',
    target_folder:
      typeof payload.target_folder === 'string'
        ? payload.target_folder
        : 'Notes',
    available_folders: folders.length > 0 ? folders : ['Notes'],
  };
}

// ── CreateNoteComponent ───────────────────────────────────────────────────────

export function CreateNoteComponent(props: MainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // Local form state — seeded from server payload, editable by user
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [seeded, setSeeded] = useState(false);

  // Seed form once the real payload arrives — useEffect avoids setState-in-render
  useEffect(() => {
    if (!seeded && !isStreaming && toolOutput) {
      setTitle(data.draft_title);
      setBody(data.draft_body);
      setSelectedFolder(data.target_folder);
      setSeeded(true);
    }
  }, [seeded, isStreaming, toolOutput, data.draft_title, data.draft_body, data.target_folder]);

  // Send states
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const isLoading = !toolOutput;

  async function handleSend() {
    if (sendState !== 'idle') return;
    setSendState('sending');
    try {
      const envelope = buildEnvelope({
        name: title,
        content: body,
        folder: selectedFolder || data.target_folder,
        action_id: data.action_id,
      });
      await sendFollowUpMessage(envelope);
      setSendState('sent');
    } catch {
      setSendState('error');
    }
  }

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4" data-testid="loading-skeleton">
        <div className="mb-4 h-5 w-3/4 animate-pulse rounded bg-muted" />
        <div className="mb-3 h-4 w-full animate-pulse rounded bg-muted" />
        <div className="mb-3 h-4 w-5/6 animate-pulse rounded bg-muted" />
        <div className="h-32 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  // Sent banner
  if (sendState === 'sent') {
    return (
      <ScrollablePanel title="Create Note">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm font-medium text-foreground">Note created.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your note has been saved to Apple Notes.
          </p>
        </div>
      </ScrollablePanel>
    );
  }

  const sendDisabled = isStreaming || sendState !== 'idle' || title.trim().length === 0;

  return (
    <ComponentErrorBoundary>
      <ScrollablePanel
        title="Create Note"
        footer={
          <div className="flex items-center justify-end gap-2 border-t border-border bg-background px-4 py-3">
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
              {sendState === 'sending' ? 'Creating...' : 'Create note'}
            </button>
          </div>
        }
      >
        <div
          className="h-full overflow-y-auto bg-background"
          style={{ maxHeight: 600 }}
          aria-busy={isStreaming ? 'true' : 'false'}
        >
          {/* Source context quote */}
          {data.source_context && (
            <div className="mx-4 mt-4 rounded-md border-l-4 border-border bg-muted/40 px-3 py-2">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Context
              </p>
              <p className="whitespace-pre-wrap text-xs text-foreground/80">
                {data.source_context}
              </p>
            </div>
          )}

          <fieldset disabled={isStreaming} className="contents">
            <div className="space-y-4 p-4">
              {/* Title */}
              <div>
                <label
                  htmlFor="note-title"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Title
                </label>
                <input
                  id="note-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Note title"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Folder select */}
              <div>
                <label
                  htmlFor="note-folder"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Folder
                </label>
                <select
                  id="note-folder"
                  value={selectedFolder || data.target_folder}
                  onChange={(e) => setSelectedFolder(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {data.available_folders.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder}
                    </option>
                  ))}
                </select>
              </div>

              {/* Note body */}
              <div>
                <label
                  htmlFor="note-body"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Note
                </label>
                <textarea
                  id="note-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your note..."
                  rows={8}
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          </fieldset>
        </div>
      </ScrollablePanel>
    </ComponentErrorBoundary>
  );
}
