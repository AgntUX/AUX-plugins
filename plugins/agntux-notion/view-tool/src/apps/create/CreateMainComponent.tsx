import { useMemo, useState } from 'react';
import { ScrollablePanel } from "@agntux/ui-primitives";
import { buildEnvelope } from './lib/build-envelope.js';

export interface CreateMainComponentProps {
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

interface ParentOption {
  id: string;
  label: string;
}

function parsePayload(toolOutput?: Record<string, unknown>) {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;

  // parent_options: JSON array of {id, label} or plain string
  let parentOptions: ParentOption[] = [];
  const rawParents = str(payload.parent_options);
  if (rawParents) {
    try {
      const parsed: unknown = JSON.parse(rawParents);
      if (Array.isArray(parsed)) {
        parentOptions = (parsed as unknown[])
          .map((item): ParentOption | null => {
            if (!item || typeof item !== 'object') return null;
            const r = item as Record<string, unknown>;
            const id = str(r.id);
            const label = str(r.label);
            if (!id || !label) return null;
            return { id, label };
          })
          .filter((p): p is ParentOption => p !== null);
      }
    } catch {
      // If it's a plain string (not JSON), treat as a single option label
      if (rawParents.trim()) {
        parentOptions = [{ id: rawParents.trim(), label: rawParents.trim() }];
      }
    }
  }

  return {
    action_id: str(payload.action_id),
    parent_options: parentOptions,
    draft_title: str(payload.draft_title),
    draft_body: str(payload.draft_body),
  };
}

export function CreateMainComponent(props: CreateMainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');
  const [created, setCreated] = useState(false);
  const [creating, setCreating] = useState(false);

  const effectiveTitle = title !== '' ? title : data.draft_title;
  const effectiveBody = body !== '' ? body : data.draft_body;
  const effectiveParentId =
    selectedParentId !== ''
      ? selectedParentId
      : data.parent_options.length > 0
      ? data.parent_options[0].id
      : '';

  const selectedParent =
    data.parent_options.find((p) => p.id === effectiveParentId) ??
    data.parent_options[0];

  const isLoading = !toolOutput;
  const canCreate = effectiveTitle.trim().length > 0 && !!effectiveParentId;

  const handleCreate = async () => {
    if (!canCreate || creating || created) return;
    setCreating(true);
    try {
      const envelope = buildEnvelope({
        parentId: effectiveParentId,
        parentLabel: selectedParent?.label ?? effectiveParentId,
        title: effectiveTitle,
        body: effectiveBody,
        actionId: data.action_id,
      });
      await sendFollowUpMessage(envelope);
      setCreated(true);
    } finally {
      setCreating(false);
    }
  };

  const header = (
    <span className="font-medium text-foreground">
      Create page in Notion
    </span>
  );

  const footer = created ? null : (
    <div className="flex justify-end px-4 py-3">
      <button
        type="button"
        onClick={() => { void handleCreate(); }}
        disabled={isStreaming || creating || !canCreate}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {creating ? 'Creating...' : 'Create page'}
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4" data-testid="loading-skeleton">
        <div className="mb-4 h-5 w-48 animate-pulse rounded-md bg-muted" />
        <div className="mb-3 h-10 w-full animate-pulse rounded-md bg-muted" />
        <div className="mb-3 h-10 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-32 w-full animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  return (
    <ScrollablePanel title={header} footer={footer}>
      <fieldset disabled={isStreaming} className="contents">
        <div className="px-4 pt-3 pb-2 space-y-4">
          {created && (
            <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
              Page created in Notion.
            </div>
          )}

          {!created && (
            <>
              {/* Parent location picker */}
              {data.parent_options.length > 0 && (
                <div>
                  <label
                    htmlFor="notion-parent"
                    className="mb-1 block text-sm font-medium text-foreground"
                  >
                    Location
                  </label>
                  {data.parent_options.length === 1 ? (
                    <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                      {data.parent_options[0].label}
                    </div>
                  ) : (
                    <select
                      id="notion-parent"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={effectiveParentId}
                      onChange={(e) => setSelectedParentId(e.target.value)}
                    >
                      {data.parent_options.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Page title */}
              <div>
                <label
                  htmlFor="notion-title"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Title
                </label>
                <input
                  id="notion-title"
                  type="text"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="Page title"
                  value={effectiveTitle}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              {/* Page body */}
              <div>
                <label
                  htmlFor="notion-body"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Content
                </label>
                <textarea
                  id="notion-body"
                  rows={8}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                  placeholder="Write the page content..."
                  value={effectiveBody}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
            </>
          )}
        </div>
      </fieldset>
    </ScrollablePanel>
  );
}
