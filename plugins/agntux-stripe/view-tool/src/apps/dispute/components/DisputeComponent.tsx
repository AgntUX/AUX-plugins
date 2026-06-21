import { useEffect, useMemo, useState } from 'react';
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

interface DisputeData {
  action_id: string;
  dispute_id: string;
  charge_amount: number;
  currency: string;
  dispute_reason: string;
  evidence_due_by: string;
  draft_evidence: string;
  customer_label: string;
  open_url: string;
}

// ── parsePayload ───────────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function num(v: unknown): number { return typeof v === 'number' ? v : 0; }

function parsePayload(toolOutput?: Record<string, unknown>): DisputeData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const p = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    action_id: str(p.action_id),
    dispute_id: str(p.dispute_id),
    charge_amount: num(p.charge_amount),
    currency: str(p.currency),
    dispute_reason: str(p.dispute_reason),
    evidence_due_by: str(p.evidence_due_by),
    draft_evidence: str(p.draft_evidence),
    customer_label: str(p.customer_label),
    open_url: str(p.open_url),
  };
}

// ── DisputeComponent ───────────────────────────────────────────────────────────

export function DisputeComponent(props: MainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [evidence, setEvidence] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    if (!seeded && !isStreaming && toolOutput) {
      setEvidence(data.draft_evidence);
      setSeeded(true);
    }
  }, [seeded, isStreaming, toolOutput, data.draft_evidence]);

  const isLoading = !toolOutput;

  async function handleSubmit() {
    if (sendState !== 'idle') return;
    setSendState('sending');
    try {
      const envelope = buildEnvelope({
        dispute_id: data.dispute_id,
        evidence,
        submit: true,
        action_id: data.action_id,
      });
      await sendFollowUpMessage(envelope);
      setSendState('sent');
    } catch {
      setSendState('error');
    }
  }

  const submitDisabled = isStreaming || sendState !== 'idle' || evidence.trim().length === 0;
  const customerLabel = data.customer_label || 'Unknown customer';
  const chargeDisplay = data.charge_amount > 0
    ? formatAmount(data.charge_amount, data.currency)
    : '—';
  const dueDateDisplay = data.evidence_due_by ? formatDate(data.evidence_due_by) : '—';

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
      <ScrollablePanel title="Respond to dispute">
        <div className="flex flex-col items-center justify-center py-12 text-center px-4">
          <p className="text-sm font-medium text-foreground">Evidence submitted.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your dispute response was sent to Stripe.
          </p>
        </div>
      </ScrollablePanel>
    );
  }

  return (
    <ComponentErrorBoundary>
      <ScrollablePanel
        title="Respond to dispute"
        footer={
          <div className="flex items-center justify-end gap-3 border-t border-border bg-background px-4 py-3">
            {sendState === 'error' && (
              <span className="text-xs text-destructive">Something went wrong. Try again.</span>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitDisabled}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendState === 'sending' ? 'Submitting...' : 'Submit evidence'}
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
              <p className="text-sm font-semibold text-foreground">{customerLabel}</p>
              {data.dispute_id && (
                <p className="text-xs text-muted-foreground font-mono">{data.dispute_id}</p>
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

          {/* Dispute summary */}
          <div className="mx-4 mt-4 rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Amount disputed</span>
              <span className="text-sm font-medium text-foreground">{chargeDisplay}</span>
            </div>
            {data.dispute_reason && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Reason</span>
                <span className="text-sm text-foreground capitalize">
                  {data.dispute_reason.replace(/_/g, ' ')}
                </span>
              </div>
            )}
            {/* Evidence deadline — prominent */}
            <div className="flex items-center justify-between pt-1 border-t border-border/50 mt-1">
              <span className="text-xs font-semibold text-destructive">Evidence due</span>
              <span className="text-sm font-semibold text-destructive">{dueDateDisplay}</span>
            </div>
          </div>

          {/* Evidence editor */}
          <fieldset disabled={isStreaming} className="contents">
            <div className="space-y-3 p-4">
              <div>
                <label htmlFor="dispute-evidence" className="mb-1 block text-xs font-medium text-foreground">
                  Evidence
                </label>
                <textarea
                  id="dispute-evidence"
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="Describe why this charge is valid..."
                  rows={6}
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
