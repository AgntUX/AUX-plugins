import { useState, useMemo, useEffect } from "react";
import { ScrollablePanel } from "@agntux/ui-primitives";
import { ExternalLink } from "../../../components/external-link.js";
import { buildEnvelope } from "../lib/build-envelope.js";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

interface EventTypeEntry {
  event_type_uri: string;
  name: string;
  duration_minutes: number;
  scheduling_url: string;
}

interface SchedulingLinkData {
  event_types: EventTypeEntry[];
  host_scheduling_url: string;
}

function parseEventTypes(raw: unknown): EventTypeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x): EventTypeEntry | null => {
      if (!x || typeof x !== "object") return null;
      const r = x as Record<string, unknown>;
      return {
        event_type_uri: str(r.event_type_uri),
        name: str(r.name),
        duration_minutes: num(r.duration_minutes),
        scheduling_url: str(r.scheduling_url),
      };
    })
    .filter((e): e is EventTypeEntry => e !== null && !!e.event_type_uri);
}

function parsePayload(toolOutput?: Record<string, unknown>): SchedulingLinkData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    event_types: parseEventTypes(payload.event_types),
    host_scheduling_url: str(payload.host_scheduling_url),
  };
}

export interface SchedulingLinkPanelProps {
  toolOutput?: Record<string, unknown>;
  isStreaming?: boolean;
  sendFollowUpMessage: (prompt: string) => Promise<void>;
}

export function SchedulingLinkPanel({
  toolOutput,
  isStreaming,
  sendFollowUpMessage,
}: SchedulingLinkPanelProps) {
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);
  const [selectedUri, setSelectedUri] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  // Auto-select first event type once real data arrives.
  const [autoSelected, setAutoSelected] = useState(false);
  useEffect(() => {
    if (!autoSelected && !isStreaming && data.event_types.length > 0 && !selectedUri) {
      setSelectedUri(data.event_types[0].event_type_uri);
      setAutoSelected(true);
    }
  }, [autoSelected, isStreaming, data.event_types, selectedUri]);

  const hasAnyData = data.event_types.length > 0 || !!data.host_scheduling_url;
  const isLoading = !toolOutput && !hasAnyData;

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6" data-testid="loading-skeleton">
        <div className="mx-auto max-w-xl space-y-3">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-full animate-pulse rounded bg-muted" />
          <div className="h-12 w-full animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (status === "sent") {
    return (
      <div className="h-full flex items-center justify-center bg-background p-6">
        <div className="text-center space-y-2">
          <p className="text-base font-medium text-foreground">Link request sent.</p>
          <p className="text-sm text-muted-foreground">
            The Calendly Connector is generating your single-use booking link.
          </p>
        </div>
      </div>
    );
  }

  const selectedEventType = data.event_types.find((et) => et.event_type_uri === selectedUri);
  const canSubmit = !!selectedUri && !!selectedEventType;

  const titleNode = (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="font-semibold text-foreground truncate">Single-use booking link</span>
      {data.host_scheduling_url && (
        <ExternalLink
          href={data.host_scheduling_url}
          className="shrink-0 text-xs text-primary underline-offset-2 hover:underline"
          ariaLabel="Open your Calendly scheduling page"
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
        disabled={isStreaming || status === "sending" || !canSubmit}
        onClick={async () => {
          if (!selectedEventType) return;
          setStatus("sending");
          try {
            const envelope = buildEnvelope({
              event_type_uri: selectedEventType.event_type_uri,
              event_type_name: selectedEventType.name,
            });
            await sendFollowUpMessage(envelope);
            setStatus("sent");
          } catch {
            setStatus("error");
          }
        }}
        className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {status === "sending" ? "Creating…" : "Create link"}
      </button>
    </div>
  );

  return (
    <ScrollablePanel title={titleNode} footer={footer}>
      <fieldset disabled={isStreaming || status === "sending"} className="contents">
        <div className="p-4 space-y-4">
          {/* Event type selector */}
          <div className="space-y-1.5">
            <label htmlFor="event-type-select" className="block text-sm font-medium text-foreground">
              Event type
            </label>
            {data.event_types.length === 0 ? (
              <p className="text-sm text-muted-foreground">No event types available.</p>
            ) : (
              <select
                id="event-type-select"
                value={selectedUri}
                onChange={(e) => setSelectedUri(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {data.event_types.map((et) => (
                  <option key={et.event_type_uri} value={et.event_type_uri}>
                    {et.name} &middot; {et.duration_minutes} min
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Preview note */}
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              A single-use link will be generated when you click Create link. It expires
              after one booking.
            </p>
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
