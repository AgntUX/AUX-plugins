import { useMemo, useState } from 'react';
import { ScrollablePanel } from "@agntux/ui-primitives";
import { ExternalLink } from '../../components/external-link.js';
import { buildEnvelope } from './lib/build-envelope.js';

export interface UpdateMainComponentProps {
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

interface EditableProperty {
  key: string;
  type: 'text' | 'select' | 'date';
  label: string;
  value: string;
  options?: string[];
}

function parsePayload(toolOutput?: Record<string, unknown>) {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;

  // Parse editable_properties: expected as JSON array of {key, type, label, value, options?}
  // or fall back to an empty list. Defensive: any parse error yields [].
  let editableProperties: EditableProperty[] = [];
  const rawEditable = str(payload.editable_properties);
  if (rawEditable) {
    try {
      const parsed: unknown = JSON.parse(rawEditable);
      if (Array.isArray(parsed)) {
        editableProperties = (parsed as unknown[])
          .map((item): EditableProperty | null => {
            if (!item || typeof item !== 'object') return null;
            const r = item as Record<string, unknown>;
            const key = str(r.key);
            const label = str(r.label);
            if (!key || !label) return null;
            const typeRaw = str(r.type);
            const propType =
              typeRaw === 'select' ? 'select' : typeRaw === 'date' ? 'date' : 'text';
            const prop: EditableProperty = {
              key,
              type: propType,
              label,
              value: str(r.value),
            };
            if (Array.isArray(r.options)) {
              prop.options = (r.options as unknown[]).map((o) => str(o)).filter(Boolean);
            }
            return prop;
          })
          .filter((p): p is EditableProperty => p !== null);
      }
    } catch {
      // fall through to empty
    }
  }

  return {
    action_id: str(payload.action_id),
    page_id: str(payload.page_id),
    page_url: str(payload.page_url),
    page_title: str(payload.page_title),
    current_properties: str(payload.current_properties),
    editable_properties: editableProperties,
  };
}

export function UpdateMainComponent(props: UpdateMainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // Local edits keyed by property key
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const isLoading = !toolOutput;

  const getValue = (prop: EditableProperty): string =>
    prop.key in edits ? edits[prop.key] : prop.value;

  const handleSave = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      // Build changed properties object from edits (only changed values)
      const changedProperties: Record<string, unknown> = {};
      for (const prop of data.editable_properties) {
        const current = getValue(prop);
        if (current !== prop.value) {
          changedProperties[prop.key] = current;
        }
      }
      // If nothing changed, still allow save (user may want to confirm current values)
      if (Object.keys(changedProperties).length === 0) {
        for (const prop of data.editable_properties) {
          changedProperties[prop.key] = getValue(prop);
        }
      }
      const envelope = buildEnvelope({
        pageId: data.page_id,
        properties: changedProperties,
        actionId: data.action_id,
      });
      await sendFollowUpMessage(envelope);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <div className="flex items-center gap-2 min-w-0">
      <span className="font-medium text-foreground truncate">
        {data.page_title || 'Update page'}
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

  const footer = saved ? null : (
    <div className="flex justify-end px-4 py-3">
      <button
        type="button"
        onClick={() => { void handleSave(); }}
        disabled={isStreaming || saving}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving...' : 'Save changes'}
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4" data-testid="loading-skeleton">
        <div className="mb-4 h-5 w-48 animate-pulse rounded-md bg-muted" />
        <div className="mb-3 h-10 w-full animate-pulse rounded-md bg-muted" />
        <div className="mb-3 h-10 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  return (
    <ScrollablePanel title={header} footer={footer}>
      <fieldset disabled={isStreaming} className="contents">
        <div className="px-4 pt-3 pb-2 space-y-4">
          {saved && (
            <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
              Changes saved. The page has been updated in Notion.
            </div>
          )}

          {/* Current (read-only) properties summary */}
          {data.current_properties && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Current values
              </p>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground whitespace-pre-wrap">
                {data.current_properties}
              </div>
            </div>
          )}

          {/* Editable property fields */}
          {!saved && data.editable_properties.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Edit properties
              </p>
              <div className="space-y-3">
                {data.editable_properties.map((prop) => (
                  <div key={prop.key}>
                    <label
                      htmlFor={`prop-${prop.key}`}
                      className="mb-1 block text-sm font-medium text-foreground"
                    >
                      {prop.label}
                    </label>
                    {prop.type === 'select' && prop.options && prop.options.length > 0 ? (
                      <select
                        id={`prop-${prop.key}`}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        value={getValue(prop)}
                        onChange={(e) =>
                          setEdits((prev) => ({ ...prev, [prop.key]: e.target.value }))
                        }
                      >
                        {prop.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : prop.type === 'date' ? (
                      <input
                        id={`prop-${prop.key}`}
                        type="date"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        value={getValue(prop)}
                        onChange={(e) =>
                          setEdits((prev) => ({ ...prev, [prop.key]: e.target.value }))
                        }
                      />
                    ) : (
                      <input
                        id={`prop-${prop.key}`}
                        type="text"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        value={getValue(prop)}
                        onChange={(e) =>
                          setEdits((prev) => ({ ...prev, [prop.key]: e.target.value }))
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fallback: no editable properties surfaced */}
          {!saved && data.editable_properties.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No editable properties were provided for this page. The save action will confirm the current values.
            </p>
          )}
        </div>
      </fieldset>
    </ScrollablePanel>
  );
}
