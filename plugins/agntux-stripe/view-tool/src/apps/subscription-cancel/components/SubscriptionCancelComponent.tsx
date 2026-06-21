import { useMemo, useState } from 'react';
import { ScrollablePanel, ComponentErrorBoundary } from "@agntux/ui-primitives";
import { ExternalLink } from '../../../components/external-link.js';
import { buildEnvelope } from '../lib/build-envelope.js';
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

interface SubscriptionCancelData {
  action_id: string;
  subscription_id: string;
  customer_label: string;
  current_status: string;
  current_period_end: string;
  open_url: string;
}

// Cancel timing option. Both are supported: at the end of the current billing
// period (cancel_at_period_end=true, the default — least disruptive) or
// immediately.
type CancelTiming = 'period_end' | 'immediately';

// ── parsePayload ───────────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

function parsePayload(toolOutput?: Record<string, unknown>): SubscriptionCancelData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const p = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    action_id: str(p.action_id),
    subscription_id: str(p.subscription_id),
    customer_label: str(p.customer_label),
    current_status: str(p.current_status),
    current_period_end: str(p.current_period_end),
    open_url: str(p.open_url),
  };
}

// ── SubscriptionCancelComponent ────────────────────────────────────────────────

export function SubscriptionCancelComponent(props: MainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);
  const [timing, setTiming] = useState<CancelTiming>('period_end');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const isLoading = !toolOutput;

  async function handleCancel() {
    if (sendState !== 'idle') return;
    setSendState('sending');
    try {
      const envelope = buildEnvelope({
        subscription_id: data.subscription_id,
        timing,
        action_id: data.action_id,
      });
      await sendFollowUpMessage(envelope);
      setSendState('sent');
    } catch {
      setSendState('error');
    }
  }

  const cancelDisabled = isStreaming || sendState !== 'idle' || !data.subscription_id;
  const customerLabel = data.customer_label || 'Unknown customer';
  const periodEndDisplay = data.current_period_end ? formatDate(data.current_period_end) : '—';

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4" data-testid="loading-skeleton">
        <div className="mb-4 h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-20 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (sendState === 'sent') {
    return (
      <ScrollablePanel title="Cancel subscription">
        <div className="flex flex-col items-center justify-center py-12 text-center px-4">
          <p className="text-sm font-medium text-foreground">Subscription cancelled.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {timing === 'period_end'
              ? `The subscription will end at the close of the current billing period (${periodEndDisplay}).`
              : 'The subscription has been cancelled immediately in Stripe.'}
          </p>
        </div>
      </ScrollablePanel>
    );
  }

  return (
    <ComponentErrorBoundary>
      <ScrollablePanel
        title="Cancel subscription"
        footer={
          <div className="flex items-center justify-end gap-3 border-t border-border bg-background px-4 py-3">
            {sendState === 'error' && (
              <span className="text-xs text-destructive">Something went wrong. Try again.</span>
            )}
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelDisabled}
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendState === 'sending' ? 'Cancelling...' : 'Cancel subscription'}
            </button>
          </div>
        }
      >
        <div
          className="overflow-y-auto bg-background"
          style={{ maxHeight: 500 }}
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

          {/* Subscription details */}
          <div className="mx-4 mt-4 rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Customer</span>
              <span className="text-sm text-foreground">{customerLabel}</span>
            </div>
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

          {/* Cancellation mode — at period end (default) or immediately */}
          <div className="mx-4 mt-4 space-y-2">
            <p className="text-xs font-medium text-foreground">When to cancel</p>
            <label
              className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-3 py-2.5"
            >
              <input
                type="radio"
                name="cancel-timing"
                checked={timing === 'period_end'}
                onChange={() => setTiming('period_end')}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium text-foreground">At end of billing period</span>
                <span className="block text-xs text-muted-foreground">
                  Access continues until {periodEndDisplay}, then the subscription ends. No further charges.
                </span>
              </span>
            </label>
            <label
              className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-3 py-2.5"
            >
              <input
                type="radio"
                name="cancel-timing"
                checked={timing === 'immediately'}
                onChange={() => setTiming('immediately')}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium text-foreground">Immediately</span>
                <span className="block text-xs text-muted-foreground">
                  Access ends now. No refund is issued automatically.
                </span>
              </span>
            </label>
          </div>

          {/* Warning */}
          {timing === 'immediately' && (
            <div className="mx-4 mt-3 mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-xs font-medium text-destructive">
                This action is irreversible. Cancelling immediately stops the subscription and cannot be undone.
              </p>
            </div>
          )}
        </div>
      </ScrollablePanel>
    </ComponentErrorBoundary>
  );
}
