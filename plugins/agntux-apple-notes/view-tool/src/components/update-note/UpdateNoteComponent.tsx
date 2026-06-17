import { useEffect, useMemo, useState } from 'react';
import { ScrollablePanel, ComponentErrorBoundary } from "@agntux/ui-primitives";
import {
  buildEnvelope,
  type ChecklistItem,
  type EditorMode,
} from '../../apps/update-note/lib/build-envelope.js';
import type { MainComponentProps } from '../shared/MainComponentProps.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface UpdateNoteData {
  action_id: string;
  source_context: string;
  note_name: string;
  note_id: string;
  folder: string;
  current_content: string;
  draft_body: string;
  is_checklist: boolean;
  checklist_items: ChecklistItem[];
}

// ── parsePayload ─────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parseChecklistItems(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ChecklistItem | null => {
      if (!item || typeof item !== 'object') return null;
      const r = item as Record<string, unknown>;
      const text = str(r.text);
      if (!text) return null;
      return { text, checked: r.checked === true };
    })
    .filter((item): item is ChecklistItem => item !== null);
}

function parsePayload(toolOutput?: Record<string, unknown>): UpdateNoteData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;

  const isChecklist = payload.is_checklist === true;
  const checklistItems = parseChecklistItems(payload.checklist_items);

  return {
    action_id: str(payload.action_id),
    source_context: str(payload.source_context),
    note_name: str(payload.note_name),
    note_id: str(payload.note_id),
    folder: str(payload.folder),
    current_content: str(payload.current_content),
    draft_body: str(payload.draft_body),
    is_checklist: isChecklist,
    checklist_items: checklistItems,
  };
}

// ── UpdateNoteComponent ───────────────────────────────────────────────────────

export function UpdateNoteComponent(props: MainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // Editor mode — default to checklist when is_checklist is true
  const [mode, setMode] = useState<EditorMode | null>(null);
  // Local checklist state
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  // Local free-text state
  const [draftBody, setDraftBody] = useState('');
  // Seeding flag
  const [seeded, setSeeded] = useState(false);

  // Seed once payload arrives — useEffect avoids setState-in-render
  useEffect(() => {
    if (!seeded && !isStreaming && toolOutput) {
      const initialMode: EditorMode = data.is_checklist ? 'checklist' : 'freetext';
      setMode(initialMode);
      setChecklistItems(data.checklist_items);
      setDraftBody(data.draft_body);
      setSeeded(true);
    }
  }, [seeded, isStreaming, toolOutput, data.is_checklist, data.checklist_items, data.draft_body]);

  const activeMode: EditorMode = mode ?? (data.is_checklist ? 'checklist' : 'freetext');

  // Send state
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const isLoading = !toolOutput;

  async function handleSend() {
    if (sendState !== 'idle') return;
    setSendState('sending');
    try {
      const envelope = buildEnvelope({
        note_name: data.note_name,
        folder: data.folder,
        mode: activeMode,
        draft_body: draftBody,
        checklist_items: checklistItems,
        action_id: data.action_id,
      });
      await sendFollowUpMessage(envelope);
      setSendState('sent');
    } catch {
      setSendState('error');
    }
  }

  function toggleChecklistItem(index: number) {
    setChecklistItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, checked: !item.checked } : item,
      ),
    );
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
      <ScrollablePanel title="Update Note">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm font-medium text-foreground">Note updated.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your changes have been saved to Apple Notes.
          </p>
        </div>
      </ScrollablePanel>
    );
  }

  // After seeding, use local state; before seeding (first render after payload
  // arrives, before the useEffect fires), fall back to data to avoid blank flash.
  const displayItems = seeded ? checklistItems : data.checklist_items;
  const checkedCount = displayItems.filter((i) => i.checked).length;
  const totalCount = displayItems.length;

  const sendDisabled = isStreaming || sendState !== 'idle';

  return (
    <ComponentErrorBoundary>
      <ScrollablePanel
        title={data.note_name ? `Update: ${data.note_name}` : 'Update Note'}
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
              {sendState === 'sending' ? 'Updating...' : 'Update note'}
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

          {/* Note metadata */}
          <div className="mx-4 mt-3">
            <p className="text-xs text-muted-foreground">
              {data.folder ? `Folder: ${data.folder}` : ''}
              {data.note_id && data.folder ? ' · ' : ''}
              {data.note_id ? `ID: ${data.note_id}` : ''}
            </p>
          </div>

          {/* Current content — read-only reference */}
          {data.current_content && (
            <div className="mx-4 mt-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Current content
              </p>
              <div className="max-h-28 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2">
                <pre className="whitespace-pre-wrap text-xs text-foreground/70">
                  {data.current_content}
                </pre>
              </div>
            </div>
          )}

          <fieldset disabled={isStreaming} className="contents">
            <div className="p-4">
              {/* Mode tabs */}
              <div className="mb-3 flex gap-2 border-b border-border pb-2">
                <button
                  type="button"
                  onClick={() => setMode('checklist')}
                  className={`rounded-t px-3 py-1 text-xs font-medium transition-colors ${
                    activeMode === 'checklist'
                      ? 'border-b-2 border-primary text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Checklist
                </button>
                <button
                  type="button"
                  onClick={() => setMode('freetext')}
                  className={`rounded-t px-3 py-1 text-xs font-medium transition-colors ${
                    activeMode === 'freetext'
                      ? 'border-b-2 border-primary text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Free text
                </button>
              </div>

              {/* Checklist mode */}
              {activeMode === 'checklist' && (
                <div>
                  {totalCount > 0 && (
                    <p className="mb-2 text-xs text-muted-foreground">
                      {checkedCount} of {totalCount} done
                    </p>
                  )}
                  {displayItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No checklist items found. Switch to Free text to edit.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {displayItems.map((item, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            id={`checklist-item-${index}`}
                            checked={item.checked}
                            onChange={() => toggleChecklistItem(index)}
                            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-input accent-primary"
                          />
                          <label
                            htmlFor={`checklist-item-${index}`}
                            className={`cursor-pointer text-sm leading-snug ${
                              item.checked
                                ? 'text-muted-foreground line-through'
                                : 'text-foreground'
                            }`}
                          >
                            {item.text}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Free-text mode */}
              {activeMode === 'freetext' && (
                <div>
                  <label
                    htmlFor="note-draft-body"
                    className="mb-1 block text-xs font-medium text-foreground"
                  >
                    New content
                  </label>
                  <textarea
                    id="note-draft-body"
                    value={seeded ? draftBody : data.draft_body}
                    onChange={(e) => setDraftBody(e.target.value)}
                    placeholder="Enter the updated note content..."
                    rows={8}
                    className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}
            </div>
          </fieldset>
        </div>
      </ScrollablePanel>
    </ComponentErrorBoundary>
  );
}
