import { useMemo, useState, useEffect } from 'react';
import { ScrollablePanel, safeString, safeNumber } from "@agntux/ui-primitives";
import { ExternalLink } from '../../../components/external-link.js';
import { buildEnvelope } from '../lib/build-envelope.js';

export interface ReminderMainComponentProps {
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

interface PendingRecipient {
  name: string;
  email: string;
  status: string;
}

function parsePayload(toolOutput?: Record<string, unknown>) {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;

  const rawRecipients = payload.pending_recipients;
  const pending_recipients: PendingRecipient[] = (
    Array.isArray(rawRecipients) ? rawRecipients : []
  )
    .map((x): PendingRecipient | null => {
      if (!x || typeof x !== 'object') return null;
      const r = x as Record<string, unknown>;
      const rec: PendingRecipient = {
        name: safeString(r.name),
        email: safeString(r.email),
        status: safeString(r.status),
      };
      return rec;
    })
    .filter((r): r is PendingRecipient => r !== null && !!r.name);

  return {
    account_id: safeString(payload.account_id),
    envelope_id: safeString(payload.envelope_id),
    envelope_subject: safeString(payload.envelope_subject),
    envelope_url: safeString(payload.envelope_url),
    sent_date: safeString(payload.sent_date),
    days_outstanding: safeNumber(payload.days_outstanding),
    pending_recipients,
    draft_message: safeString(payload.draft_message),
  };
}

export function ReminderMainComponent(props: ReminderMainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage, openLink } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  // Seed the textarea with draft_message from action file when it first arrives.
  // useEffect avoids setting state during render.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!seeded && data.draft_message && !message) {
      setMessage(data.draft_message);
      setSeeded(true);
    }
  }, [data.draft_message, seeded, message]);

  const isLoading = !toolOutput;

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

  if (sent) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6">
        <div className="mx-auto max-w-xl">
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm font-medium text-foreground">Reminder sent</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A reminder was sent to pending signers on this envelope.
            </p>
          </div>
        </div>
      </div>
    );
  }

  async function handleSend() {
    if (sending || !data.account_id || !data.envelope_id) return;
    setSending(true);
    try {
      const trimmedMessage = message.trim();
      const envelopeArgs: { accountId: string; envelopeId: string; message?: string } = {
        accountId: data.account_id,
        envelopeId: data.envelope_id,
      };
      if (trimmedMessage) envelopeArgs.message = trimmedMessage;
      const envelope = buildEnvelope(envelopeArgs);
      await sendFollowUpMessage(envelope);
      setSent(true);
    } finally {
      setSending(false);
    }
  }

  const pendingCount = data.pending_recipients.length;
  const daysLabel =
    data.days_outstanding === 1
      ? '1 day outstanding'
      : `${data.days_outstanding} days outstanding`;

  const headerTitle = (
    <span className="font-medium text-foreground">
      {data.envelope_subject || 'Send Reminder'}
    </span>
  );

  const footer = (
    <div className="flex items-center justify-end gap-3 px-5 py-3">
      <button
        type="button"
        className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        disabled={sending || isStreaming}
        onClick={() => setMessage('')}
      >
        Clear
      </button>
      <button
        type="button"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        disabled={sending || isStreaming || !data.envelope_id}
        onClick={() => void handleSend()}
      >
        {sending ? 'Sending…' : 'Send reminder'}
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-background" aria-busy={isStreaming ? 'true' : 'false'}>
      <ScrollablePanel
        title={headerTitle}
        onHelpClick={
          data.envelope_url ? () => openLink(data.envelope_url) : undefined
        }
        helpLabel="Open in DocuSign"
        footer={footer}
      >
        <fieldset disabled={isStreaming || sending} className="contents">
          <div className="px-5 py-4 space-y-4">
            {/* Envelope context */}
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Sent {data.sent_date || 'unknown date'} &middot; {daysLabel}
                </span>
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

            {/* Recipient status list */}
            {pendingCount > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {pendingCount} pending signer{pendingCount !== 1 ? 's' : ''}
                </p>
                <ul className="space-y-1">
                  {data.pending_recipients.map((r, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{r.email}</p>
                      </div>
                      <span
                        className={
                          r.status === 'signed' || r.status === 'completed'
                            ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800'
                            : 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
                        }
                      >
                        {r.status || 'waiting'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Optional message */}
            <div>
              <label
                htmlFor="reminder-message"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                Optional message to signers
              </label>
              <textarea
                id="reminder-message"
                rows={4}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                placeholder="Add a personal note to include with the reminder email…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Leave blank to send a default DocuSign reminder without a custom message.
              </p>
            </div>
          </div>
        </fieldset>
      </ScrollablePanel>
    </div>
  );
}
