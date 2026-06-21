import { useEffect, useMemo, useState } from 'react';
import { ScrollablePanel, ComponentErrorBoundary } from "@agntux/ui-primitives";
import { ExternalLink } from '../../../components/external-link.js';
import { buildEnvelope, type SubscriptionEditMode } from '../lib/build-envelope.js';
import { formatDate } from '../../../lib/stripe-helpers.js';

// ── Props ──────────────────────────────────────────────────────────────────────

export interface MainComponentProps {
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

// ── Data shape ─────────────────────────────────────────────────────────────────

interface SubscriptionEditData {
  action_id: string;
  subscription_id: string;
  customer_label: string;
  current_status: string;
  current_plan: string;
  current_quantity: number;
  current_period_end: string;
  open_url: string;
}

// ── parsePayload ───────────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function num(v: unknown): number { return typeof v === 'number' ? v : 0; }

function parsePayload(toolOutput?: Record<string, unknown>): SubscriptionEditData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const p = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    action_id: str(p.action_id),
    subscription_id: str(p.subscription_id),
    customer_label: str(p.customer_label),
    current_status: str(p.current_status),
    current_plan: str(p.current_plan),
    current_quantity: num(p.current_quantity),
    current_period_end: str(p.current_period_end),
    open_url: str(p.open_url),
  };
}

// ── SubscriptionEditComponent ──────────────────────────────────────────────────

export function SubscriptionEditComponent(props: MainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [mode, setMode] = useState<SubscriptionEditMode>('pause');
  const [newQuantity, setNewQuantity] = useState(1);
  const [newPriceId, setNewPriceId] = useState('');
  const [resumeDate, setResumeDate] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    if (!seeded && !isStreaming && toolOutput) {
      setNewQuantity(data.current_quantity > 0 ? data.current_quantity : 1);
      setSeeded(true);
    }
  }, [seeded, isStreaming, toolOutput, data.current_quantity]);

  const isLoading = !toolOutput;

  async function handleConfirm() {
    if (sendState !== 'idle') return;
    setSendState('sending');
    try {
      const envelope = buildEnvelope({
        subscription_id: data.subscription_id,
        mode,
        new_quantity: mode === 'update' ? newQuantity : undefined,
        new_price_id: mode === 'update' && newPriceId.trim() ? newPriceId.trim() : undefined,
        resume_at_date: mode === 'pause' && resumeDate ? resumeDate : undefined,
        action_id: data.action_id,
      });
      await sendFollowUpMessage(envelope);
      setSendState('sent');
    } catch {
      setSendState('error');
    }
  }

  const confirmDisabled = isStreaming || sendState !== 'idle' || !data.subscription_id;
  const customerLabel = data.customer_label || 'Unknown customer';
  const periodEndDisplay = data.current_period_end ? formatDate(data.current_period_end) : '—';

  const confirmLabel = sendState === 'sending' ? 'Saving...' : 'Save change';

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4" data-testid="loading-skeleton">
        <div className="mb-4 h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-24 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (sendState === 'sent') {
    return (
      <ScrollablePanel title="Edit subscription">
        <div className="flex flex-col items-center justify-center py-12 text-center px-4">
          <p className="text-sm font-medium text-foreground">
            {mode === 'pause' ? 'Subscription paused.' : 'Subscription updated.'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The change has been applied in Stripe.
          </p>
        </div>
      </ScrollablePanel>
    );
  }

  return (
    <ComponentErrorBoundary>
      <ScrollablePanel
        title="Edit subscription"
        footer={
          <div className="flex items-center justify-end gap-3 border-t border-border bg-background px-4 py-3">
            {sendState === 'error' && (
              <span className="text-xs text-destructive">Something went wrong. Try again.</span>
            )}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirmDisabled}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        }
      >
        <div
          className="overflow-y-auto bg-background"
          style={{ maxHeight: 520 }}
          aria-busy={isStreaming ? 'true' : 'false'}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{customerLabel}</p>
              {data.subscription_id && (
                <p className="text-xs text-muted-foreground font-mono">{data.subscription_id}</p>
              )}
            </div>
            {data.open_url && (
              <ExternalLink
                href={data.open_url}
                className="shrink-0 text-xs text-primary hover:underline underline-offset-2"
              >
                Open in Stripe
              </ExternalLink>
            )}
          </div>

          {/* Current subscription info */}
          <div className="mx-4 mt-4 rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1">
            {data.current_plan && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Plan</span>
                <span className="text-sm text-foreground">{data.current_plan}</span>
              </div>
            )}
            {data.current_quantity > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Quantity</span>
                <span className="text-sm text-foreground">{data.current_quantity}</span>
              </div>
            )}
            {data.current_status && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Status</span>
                <span className="text-sm text-foreground capitalize">{data.current_status}</span>
              </div>
            )}
            {data.current_period_end && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Current period ends</span>
                <span className="text-sm text-foreground">{periodEndDisplay}</span>
              </div>
            )}
          </div>

          {/* Mode tabs + form */}
          <fieldset disabled={isStreaming} className="contents">
            <div className="p-4 space-y-4">
              {/* Tab switcher */}
              <div className="flex gap-1 rounded-md border border-border bg-muted/30 p-1">
                <button
                  type="button"
                  onClick={() => setMode('pause')}
                  className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === 'pause'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Pause
                </button>
                <button
                  type="button"
                  onClick={() => setMode('update')}
                  className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === 'update'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Update
                </button>
              </div>

              {mode === 'pause' && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Pausing collection marks future invoices as uncollectable without cancelling the subscription. You can resume billing at any time.
                  </p>
                  <div>
                    <label htmlFor="resume-date" className="mb-1 block text-xs font-medium text-foreground">
                      Resume on <span className="font-normal text-muted-foreground">(optional — leave blank to pause indefinitely)</span>
                    </label>
                    <input
                      id="resume-date"
                      type="date"
                      value={resumeDate}
                      onChange={(e) => setResumeDate(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              )}

              {mode === 'update' && (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="new-quantity" className="mb-1 block text-xs font-medium text-foreground">
                      New quantity
                    </label>
                    <input
                      id="new-quantity"
                      type="number"
                      min={1}
                      value={newQuantity}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setNewQuantity(isNaN(v) || v < 1 ? 1 : v);
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-price-id" className="mb-1 block text-xs font-medium text-foreground">
                      New price ID <span className="font-normal text-muted-foreground">(optional — leave blank to keep current plan)</span>
                    </label>
                    <input
                      id="new-price-id"
                      type="text"
                      value={newPriceId}
                      onChange={(e) => setNewPriceId(e.target.value)}
                      placeholder="price_xxx"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground font-mono placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              )}
            </div>
          </fieldset>
        </div>
      </ScrollablePanel>
    </ComponentErrorBoundary>
  );
}
