import { useMemo, useState } from 'react';
import { ScrollablePanel, ComponentErrorBoundary } from "@agntux/ui-primitives";
import { ExternalLink } from '../../../components/external-link.js';
import { buildEnvelope } from '../lib/build-envelope.js';
import { formatAmount, formatDate } from '../../../lib/stripe-helpers.js';

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

interface InvoiceFinalizeData {
  action_id: string;
  invoice_id: string;
  invoice_number: string;
  amount_due: number;
  currency: string;
  customer_label: string;
  due_date: string;
  open_url: string;
}

// ── parsePayload ───────────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function num(v: unknown): number { return typeof v === 'number' ? v : 0; }

function parsePayload(toolOutput?: Record<string, unknown>): InvoiceFinalizeData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const p = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    action_id: str(p.action_id),
    invoice_id: str(p.invoice_id),
    invoice_number: str(p.invoice_number),
    amount_due: num(p.amount_due),
    currency: str(p.currency),
    customer_label: str(p.customer_label),
    due_date: str(p.due_date),
    open_url: str(p.open_url),
  };
}

// ── InvoiceFinalizeComponent ────────────────────────────────────────────────────

export function InvoiceFinalizeComponent(props: MainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const isLoading = !toolOutput;

  async function handleConfirm() {
    if (sendState !== 'idle') return;
    setSendState('sending');
    try {
      const envelope = buildEnvelope({
        invoice_id: data.invoice_id,
        invoice_number: data.invoice_number,
        action_id: data.action_id,
      });
      await sendFollowUpMessage(envelope);
      setSendState('sent');
    } catch {
      setSendState('error');
    }
  }

  const confirmDisabled = isStreaming || sendState !== 'idle' || !data.invoice_id;
  const customerLabel = data.customer_label || 'Unknown customer';
  const amountDisplay = data.amount_due > 0
    ? formatAmount(data.amount_due, data.currency)
    : '—';
  const dueDateDisplay = data.due_date ? formatDate(data.due_date) : '—';

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
      <ScrollablePanel title="Finalize invoice">
        <div className="flex flex-col items-center justify-center py-12 text-center px-4">
          <p className="text-sm font-medium text-foreground">Invoice finalized.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The invoice has been sent to the customer via Stripe.
          </p>
        </div>
      </ScrollablePanel>
    );
  }

  return (
    <ComponentErrorBoundary>
      <ScrollablePanel
        title="Finalize invoice"
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
              {sendState === 'sending' ? 'Finalizing...' : 'Finalize invoice'}
            </button>
          </div>
        }
      >
        <div
          className="overflow-y-auto bg-background"
          style={{ maxHeight: 480 }}
          aria-busy={isStreaming ? 'true' : 'false'}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{customerLabel}</p>
              {data.invoice_number && (
                <p className="text-xs text-muted-foreground">Invoice {data.invoice_number}</p>
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

          {/* Invoice details */}
          <div className="mx-4 mt-4 rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Amount due</span>
              <span className="text-sm font-medium text-foreground">{amountDisplay}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Customer</span>
              <span className="text-sm text-foreground">{customerLabel}</span>
            </div>
            {data.due_date && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Due date</span>
                <span className="text-sm text-foreground">{dueDateDisplay}</span>
              </div>
            )}
          </div>

          <p className="px-4 pt-4 pb-2 text-xs text-muted-foreground">
            Finalizing this invoice will lock it and send it to the customer. This cannot be undone without voiding the invoice.
          </p>
        </div>
      </ScrollablePanel>
    </ComponentErrorBoundary>
  );
}
