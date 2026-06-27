// =============================================================================
// sign/components/main-component.tsx — OPEN-IN view (no connector write).
//
// This view shows the envelope context (subject, sender, sent date, expiration,
// signer position) and provides a single prominent "Review and sign in DocuSign"
// button that opens the signing_url via the host's link-open affordance.
//
// There is NO Send/commit button and NO connector envelope emitted from this view.
// Signing takes place in DocuSign's secure embedded signing ceremony (the
// signing_url). The DocuSign signing ceremony cannot be embedded in the iframe;
// the host opens it in the system browser.
// =============================================================================

import { useMemo } from 'react';
import { ScrollablePanel, safeString } from "@agntux/ui-primitives";
import { ExternalLink } from '../../../components/external-link.js';

export interface SignMainComponentProps {
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
    envelope_id: safeString(payload.envelope_id),
    envelope_subject: safeString(payload.envelope_subject),
    sender_name: safeString(payload.sender_name),
    sent_date: safeString(payload.sent_date),
    expiration_date: safeString(payload.expiration_date),
    signer_position: safeString(payload.signer_position),
    signing_url: safeString(payload.signing_url),
  };
}

export function SignMainComponent(props: SignMainComponentProps) {
  const { toolOutput, isStreaming, openLink } = props;
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const isLoading = !toolOutput;

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6" data-testid="loading-skeleton">
        <div className="mx-auto max-w-xl">
          <div className="mb-4 h-5 w-48 animate-pulse rounded-md bg-muted" />
          <div className="mb-2 h-4 w-64 animate-pulse rounded-md bg-muted" />
          <div className="mb-6 h-4 w-40 animate-pulse rounded-md bg-muted" />
          <div className="mx-auto h-10 w-48 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    );
  }

  const headerTitle = (
    <span className="font-medium text-foreground">
      {data.envelope_subject || 'Review and Sign'}
    </span>
  );

  // The primary CTA: "Review and sign in DocuSign" — opens signing_url in browser.
  // This is the only action; there is no connector commit button.
  const footer = data.signing_url ? (
    <div className="flex items-center justify-center px-5 py-4">
      <ExternalLink
        href={data.signing_url}
        className="rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        ariaLabel="Review and sign in DocuSign"
      >
        Review and sign in DocuSign
      </ExternalLink>
    </div>
  ) : (
    <div className="flex items-center justify-center px-5 py-4">
      <span className="text-xs text-muted-foreground">Signing URL unavailable</span>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-background" aria-busy={isStreaming ? 'true' : 'false'}>
      <ScrollablePanel
        title={headerTitle}
        onHelpClick={
          data.signing_url
            ? () => openLink(data.signing_url)
            : undefined
        }
        helpLabel="Open in DocuSign"
        footer={footer}
      >
        <div className="px-5 py-4 space-y-4">
          {/* Envelope context card */}
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-4 space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Document
              </p>
              <p className="text-sm font-medium text-foreground">
                {data.envelope_subject || 'Untitled envelope'}
              </p>
            </div>

            {data.sender_name && (
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">From</p>
                <p className="text-sm text-foreground">{data.sender_name}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {data.sent_date && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Sent</p>
                  <p className="text-sm text-foreground">{data.sent_date}</p>
                </div>
              )}
              {data.expiration_date && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Expires</p>
                  <p className="text-sm text-foreground">{data.expiration_date}</p>
                </div>
              )}
            </div>

            {data.signer_position && (
              <div className="rounded-md bg-background px-3 py-2 border border-border">
                <p className="text-xs text-muted-foreground">Your signing position</p>
                <p className="text-sm font-medium text-foreground mt-0.5">
                  {data.signer_position}
                </p>
              </div>
            )}
          </div>

          {/* Guidance note */}
          <p className="text-xs text-muted-foreground">
            Signing opens in DocuSign where the secure signing ceremony takes place.
            Your signature will be recorded in DocuSign.
          </p>
        </div>
      </ScrollablePanel>
    </div>
  );
}
