import { useEffect, useMemo, useState } from 'react';
import { ScrollablePanel, ComponentErrorBoundary } from "@agntux/ui-primitives";
import { ExternalLink } from '../../../components/external-link.js';
import { buildEnvelope } from '../lib/build-envelope.js';
import { formatAmount } from '../../../lib/stripe-helpers.js';

// ── Props (same shape as canonical MainComponentProps) ─────────────────────────

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

interface RefundData {
  action_id: string;
  payment_intent_id: string;
  charge_amount: number;
  currency: string;
  customer_label: string;
  max_refundable: number;
  suggested_reason: string;
  open_url: string;
}

// ── parsePayload ───────────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function num(v: unknown): number { return typeof v === 'number' ? v : 0; }

function parsePayload(toolOutput?: Record<string, unknown>): RefundData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const p = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    action_id: str(p.action_id),
    payment_intent_id: str(p.payment_intent_id),
    charge_amount: num(p.charge_amount),
    currency: str(p.currency),
    customer_label: str(p.customer_label),
    max_refundable: num(p.max_refundable),
    suggested_reason: str(p.suggested_reason),
    open_url: str(p.open_url),
  };
}

const REASONS = [
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'fraudulent', label: 'Fraudulent' },
  { value: 'requested_by_customer', label: 'Requested by customer' },
];

// ── RefundComponent ────────────────────────────────────────────────────────────

export function RefundComponent(props: MainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // Local form state
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('requested_by_customer');
  const [seeded, setSeeded] = useState(false);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  // Seed once real payload arrives
  useEffect(() => {
    if (!seeded && !isStreaming && toolOutput) {
      setAmount(data.max_refundable > 0 ? data.max_refundable : data.charge_amount);
      if (data.suggested_reason) setReason(data.suggested_reason);
      setSeeded(true);
    }
  }, [seeded, isStreaming, toolOutput, data]);

  const isLoading = !toolOutput;

  async function handleConfirm() {
    if (sendState !== 'idle') return;
    setSendState('sending');
    try {
      const envelope = buildEnvelope({
        payment_intent_id: data.payment_intent_id,
        amount,
        currency: data.currency,
        reason,
        action_id: data.action_id,
      });
      await sendFollowUpMessage(envelope);
      setSendState('sent');
    } catch {
      setSendState('error');
    }
  }

  const maxAllowed = data.max_refundable > 0 ? data.max_refundable : data.charge_amount;
  const amountValid = amount > 0 && amount <= maxAllowed;
  const confirmDisabled = isStreaming || sendState !== 'idle' || !amountValid;

  const customerLabel = data.customer_label || 'Unknown customer';
  const chargeDisplay = data.charge_amount > 0
    ? formatAmount(data.charge_amount, data.currency)
    : '—';
  const refundDisplay = amount > 0
    ? formatAmount(amount, data.currency)
    : '—';

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-4" data-testid="loading-skeleton">
        <div className="mb-4 h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-16 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (sendState === 'sent') {
    return (
      <ScrollablePanel title="Refund payment">
        <div className="flex flex-col items-center justify-center py-12 text-center px-4">
          <p className="text-sm font-medium text-foreground">Refund submitted.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your refund request was sent to Stripe.
          </p>
        </div>
      </ScrollablePanel>
    );
  }

  return (
    <ComponentErrorBoundary>
      <ScrollablePanel
        title="Refund payment"
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
              {sendState === 'sending' ? 'Submitting...' : `Refund ${refundDisplay}`}
            </button>
          </div>
        }
      >
        <div
          className="overflow-y-auto bg-background"
          style={{ maxHeight: 560 }}
          aria-busy={isStreaming ? 'true' : 'false'}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {customerLabel}
              </p>
              {data.payment_intent_id && (
                <p className="text-xs text-muted-foreground font-mono">{data.payment_intent_id}</p>
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

          {/* Charge summary */}
          <div className="mx-4 mt-4 rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Original charge</span>
              <span className="text-sm font-medium text-foreground">{chargeDisplay}</span>
            </div>
            {data.max_refundable < data.charge_amount && data.max_refundable > 0 && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-muted-foreground">Max refundable</span>
                <span className="text-sm font-medium text-foreground">
                  {formatAmount(data.max_refundable, data.currency)}
                </span>
              </div>
            )}
          </div>

          {/* Editable form */}
          <fieldset disabled={isStreaming} className="contents">
            <div className="space-y-4 p-4">
              {/* Refund amount */}
              <div>
                <label htmlFor="refund-amount" className="mb-1 block text-xs font-medium text-foreground">
                  Refund amount ({data.currency ? data.currency.toUpperCase() : 'minor units'})
                </label>
                <input
                  id="refund-amount"
                  type="number"
                  min={1}
                  max={maxAllowed}
                  value={amount}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setAmount(isNaN(v) ? 0 : v);
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {!amountValid && amount > 0 && (
                  <p className="mt-1 text-xs text-destructive">
                    Amount must be between 1 and {maxAllowed}.
                  </p>
                )}
              </div>

              {/* Reason select */}
              <div>
                <label htmlFor="refund-reason" className="mb-1 block text-xs font-medium text-foreground">
                  Reason
                </label>
                <select
                  id="refund-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>
        </div>
      </ScrollablePanel>
    </ComponentErrorBoundary>
  );
}
