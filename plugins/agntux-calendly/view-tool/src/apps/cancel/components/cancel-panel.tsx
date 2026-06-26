import { useState, useMemo, useEffect } from "react";
import { ScrollablePanel } from "@agntux/ui-primitives";
import { ExternalLink } from "../../../components/external-link.js";
import { buildEnvelope } from "../lib/build-envelope.js";

// Safe string accessor — always returns a string, never undefined.
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

interface CancelData {
  meeting_url: string;
  event_uri: string;
  meeting_name: string;
  invitee_name: string;
  start_time_utc: string;
  draft_reason: string;
}

function parsePayload(toolOutput?: Record<string, unknown>): CancelData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    meeting_url: str(payload.meeting_url),
    event_uri: str(payload.event_uri),
    meeting_name: str(payload.meeting_name),
    invitee_name: str(payload.invitee_name),
    start_time_utc: str(payload.start_time_utc),
    draft_reason: str(payload.draft_reason),
  };
}

function formatStartTime(utcString: string, locale: string): string {
  if (!utcString) return "";
  try {
    const d = new Date(utcString);
    if (isNaN(d.getTime())) return utcString;
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return utcString;
  }
}

export interface CancelPanelProps {
  toolOutput?: Record<string, unknown>;
  isStreaming?: boolean;
  locale: string;
  sendFollowUpMessage: (prompt: string) => Promise<void>;
}

export function CancelPanel({
  toolOutput,
  isStreaming,
  locale,
  sendFollowUpMessage,
}: CancelPanelProps) {
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);
  const [reason, setReason] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  // Seed the textarea from draft_reason once real data arrives (not during streaming).
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!seeded && !isStreaming && data.draft_reason) {
      setReason(data.draft_reason);
      setSeeded(true);
    }
  }, [seeded, isStreaming, data.draft_reason]);

  const hasAnyData = !!data.event_uri || !!data.meeting_name;
  const isLoading = !toolOutput && !hasAnyData;

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6" data-testid="loading-skeleton">
        <div className="mx-auto max-w-xl">
          <div className="mb-4 h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="mb-2 h-4 w-64 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-28 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (status === "sent") {
    return (
      <div className="h-full flex items-center justify-center bg-background p-6">
        <div className="text-center space-y-2">
          <p className="text-base font-medium text-foreground">Cancellation sent.</p>
          <p className="text-sm text-muted-foreground">
            The Calendly Connector is processing your request.
          </p>
        </div>
      </div>
    );
  }

  const formattedTime = formatStartTime(data.start_time_utc, locale);

  const titleNode = (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="font-semibold text-foreground truncate">
        {data.meeting_name || "Cancel meeting"}
      </span>
      {data.meeting_url && (
        <ExternalLink
          href={data.meeting_url}
          className="shrink-0 text-xs text-primary underline-offset-2 hover:underline"
          ariaLabel="Open meeting in Calendly"
        >
          Open ↗
        </ExternalLink>
      )}
    </div>
  );

  const footer = (
    <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-border bg-background">
      <button
        type="button"
        disabled={isStreaming || status === "sending" || !data.event_uri}
        onClick={async () => {
          setStatus("sending");
          try {
            const envelope = buildEnvelope({
              event_uri: data.event_uri,
              reason: reason,
            });
            await sendFollowUpMessage(envelope);
            setStatus("sent");
          } catch {
            setStatus("error");
          }
        }}
        className="inline-flex items-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow-sm hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {status === "sending" ? "Cancelling…" : "Cancel meeting"}
      </button>
    </div>
  );

  return (
    <ScrollablePanel title={titleNode} footer={footer}>
      <fieldset disabled={isStreaming || status === "sending"} className="contents">
        <div className="p-4 space-y-4">
          {/* Source context quote */}
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3 space-y-1">
            {data.meeting_name && (
              <p className="text-sm font-medium text-foreground">{data.meeting_name}</p>
            )}
            {data.invitee_name && (
              <p className="text-sm text-muted-foreground">{data.invitee_name}</p>
            )}
            {formattedTime && (
              <p className="text-xs text-muted-foreground">{formattedTime}</p>
            )}
          </div>

          {/* Reason editor */}
          <div className="space-y-1.5">
            <label
              htmlFor="cancel-reason"
              className="block text-sm font-medium text-foreground"
            >
              Reason for cancellation
            </label>
            <textarea
              id="cancel-reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why you are cancelling this meeting…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {status === "error" && (
            <p className="text-sm text-destructive">
              Something went wrong. Please try again.
            </p>
          )}
        </div>
      </fieldset>
    </ScrollablePanel>
  );
}
