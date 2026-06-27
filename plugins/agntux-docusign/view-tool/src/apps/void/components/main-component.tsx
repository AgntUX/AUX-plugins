import { useMemo, useState, useEffect } from 'react';
import { ScrollablePanel, safeString, safeNumber } from "@agntux/ui-primitives";
import { ExternalLink } from '../../../components/external-link.js';
import { buildEnvelope } from '../lib/build-envelope.js';

export interface VoidMainComponentProps {
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
  /** Direct openLink callback wired from useAppsClient().openLink in the App. */
  openLink: (url: string) => void;
}

function parsePayload(toolOutput?: Record<string, unknown>) {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    account_id: safeString(payload.account_id),
    envelope_id: safeString(payload.envelope_id),
    envelope_subject: safeString(payload.envelope_subject),
    envelope_url: safeString(payload.envelope_url),
    sent_date: safeString(payload.sent_date),
    recipient_count: safeNumber(payload.recipient_count),
    draft_void_reason: safeString(payload.draft_void_reason),
  };
}

export function VoidMainComponent(props: VoidMainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage, openLink } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [reason, setReason] = useState('');
  const [voided, setVoided] = useState(false);
  const [voiding, setVoiding] = useState(false);

  // Seed the textarea with draft_void_reason from action file when it first arrives.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!seeded && data.draft_void_reason && !reason) {
      setReason(data.draft_void_reason);
      setSeeded(true);
    }
  }, [data.draft_void_reason, seeded, reason]);

  const isLoading = !toolOutput;
  const canSubmit = reason.trim().length > 0 && !!data.envelope_id && !voiding && !isStreaming;

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6" data-testid="loading-skeleton">
        <div className="mx-auto max-w-xl">
          <div className="mb-4 h-5 w-48 animate-pulse rounded-md bg-muted" />
          <div className="mb-2 h-4 w-64 animate-pulse rounded-md bg-muted" />
          <div className="mb-6 h-4 w-40 animate-pulse rounded-md bg-muted" />
          <div className="h-24 w-full animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    );
  }

  if (voided) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6">
        <div className="mx-auto max-w-xl">
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm font-medium text-foreground">Envelope voided</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The envelope has been voided and all recipients have been notified.
            </p>
          </div>
        </div>
      </div>
    );
  }

  async function handleVoid() {
    if (!canSubmit) return;
    setVoiding(true);
    try {
      const envelope = buildEnvelope({
        accountId: data.account_id,
        envelopeId: data.envelope_id,
        voidedReason: reason.trim(),
      });
      await sendFollowUpMessage(envelope);
      setVoided(true);
    } finally {
      setVoiding(false);
    }
  }

  const recipientLabel =
    data.recipient_count === 1
      ? '1 recipient will be notified'
      : `${data.recipient_count} recipients will be notified`;

  const headerTitle = (
    <span className="font-medium text-foreground">
      {data.envelope_subject || 'Void Envelope'}
    </span>
  );

  const footer = (
    <div className="flex items-center justify-between px-5 py-3">
      <p className="text-xs text-muted-foreground">{recipientLabel}</p>
      <button
        type="button"
        className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
        disabled={!canSubmit}
        onClick={() => void handleVoid()}
      >
        {voiding ? 'Voiding…' : 'Void envelope'}
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-background" aria-busy={isStreaming ? 'true' : 'false'}>
      <ScrollablePanel
        title={headerTitle}
        onHelpClick={data.envelope_url ? () => openLink(data.envelope_url) : undefined}
        helpLabel="Open in DocuSign"
        footer={footer}
      >
        <fieldset disabled={isStreaming || voiding} className="contents">
          <div className="px-5 py-4 space-y-4">
            {/* Envelope context */}
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
              <p className="text-xs font-medium text-amber-800">
                Warning: voiding is permanent and cannot be undone.
              </p>
              <p className="text-xs text-amber-700">
                All signers and recipients will receive a notification with the reason below.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Sent {data.sent_date || 'unknown date'}
                  </p>
                </div>
                {data.envelope_url && (
                  <ExternalLink
                    href={data.envelope_url}
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    ariaLabel="Open in DocuSign"
                  >
                    Open in DocuSign
                  </ExternalLink>
                )}
              </div>
            </div>

            {/* Required void reason */}
            <div>
              <label
                htmlFor="void-reason"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                Void reason <span className="text-destructive" aria-hidden="true">*</span>
              </label>
              <textarea
                id="void-reason"
                rows={4}
                required
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none aria-invalid:border-destructive"
                placeholder="Explain why this envelope is being voided (required — recipients will see this)…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-required="true"
                aria-invalid={reason.trim().length === 0 ? 'true' : 'false'}
              />
              {reason.trim().length === 0 && (
                <p className="mt-1 text-xs text-destructive">
                  A void reason is required.
                </p>
              )}
            </div>
          </div>
        </fieldset>
      </ScrollablePanel>
    </div>
  );
}
