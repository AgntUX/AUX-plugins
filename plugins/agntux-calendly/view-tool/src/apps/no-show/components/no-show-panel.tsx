import { useState, useMemo } from "react";
import { ScrollablePanel } from "@agntux/ui-primitives";
import { ExternalLink } from "../../../components/external-link.js";
import { buildEnvelope } from "../lib/build-envelope.js";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function bool(v: unknown): boolean {
  return typeof v === "boolean" ? v : false;
}

interface InviteeEntry {
  invitee_uri: string;
  name: string;
  email: string;
  is_guest: boolean;
}

interface NoShowData {
  meeting_url: string;
  meeting_name: string;
  start_time_utc: string;
  invitees: InviteeEntry[];
}

function parseInvitees(raw: unknown): InviteeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x): InviteeEntry | null => {
      if (!x || typeof x !== "object") return null;
      const r = x as Record<string, unknown>;
      return {
        invitee_uri: str(r.invitee_uri),
        name: str(r.name),
        email: str(r.email),
        is_guest: bool(r.is_guest),
      };
    })
    .filter((e): e is InviteeEntry => e !== null && !!e.invitee_uri);
}

function parsePayload(toolOutput?: Record<string, unknown>): NoShowData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const payload = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;
  return {
    meeting_url: str(payload.meeting_url),
    meeting_name: str(payload.meeting_name),
    start_time_utc: str(payload.start_time_utc),
    invitees: parseInvitees(payload.invitees),
  };
}

function formatStartTime(utcString: string, locale: string): string {
  if (!utcString) return "";
  try {
    const d = new Date(utcString);
    if (isNaN(d.getTime())) return utcString;
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
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

/** Two-letter initials from a display name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface NoShowPanelProps {
  toolOutput?: Record<string, unknown>;
  isStreaming?: boolean;
  locale: string;
  sendFollowUpMessage: (prompt: string) => Promise<void>;
}

export function NoShowPanel({
  toolOutput,
  isStreaming,
  locale,
  sendFollowUpMessage,
}: NoShowPanelProps) {
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const hasAnyData = !!data.meeting_name || data.invitees.length > 0;
  const isLoading = !toolOutput && !hasAnyData;

  const toggleInvitee = (uri: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) {
        next.delete(uri);
      } else {
        next.add(uri);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6" data-testid="loading-skeleton">
        <div className="mx-auto max-w-xl space-y-3">
          <div className="h-5 w-52 animate-pulse rounded bg-muted" />
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-md border border-border p-3">
              <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                <div className="h-3 w-48 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (status === "sent") {
    return (
      <div className="h-full flex items-center justify-center bg-background p-6">
        <div className="text-center space-y-2">
          <p className="text-base font-medium text-foreground">No-show marked.</p>
          <p className="text-sm text-muted-foreground">
            The Calendly Connector is processing your request.
          </p>
        </div>
      </div>
    );
  }

  const formattedTime = formatStartTime(data.start_time_utc, locale);
  const selectedCount = selected.size;
  const canSubmit = selectedCount > 0 && !!data.invitees.length;

  const titleNode = (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="font-semibold text-foreground truncate">
        {data.meeting_name || "Mark no-show"}
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
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-background">
      <span className="text-sm text-muted-foreground">
        {selectedCount === 0
          ? "Select invitees to mark"
          : `${selectedCount} selected`}
      </span>
      <button
        type="button"
        disabled={isStreaming || status === "sending" || !canSubmit}
        onClick={async () => {
          setStatus("sending");
          try {
            const envelope = buildEnvelope({
              invitee_uris: Array.from(selected),
              meeting_name: data.meeting_name,
            });
            await sendFollowUpMessage(envelope);
            setStatus("sent");
          } catch {
            setStatus("error");
          }
        }}
        className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {status === "sending" ? "Marking…" : "Mark no-show"}
      </button>
    </div>
  );

  return (
    <ScrollablePanel title={titleNode} footer={footer}>
      <fieldset disabled={isStreaming || status === "sending"} className="contents">
        <div className="p-4 space-y-4">
          {/* Source context */}
          {formattedTime && (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-2">
              <p className="text-xs text-muted-foreground">{formattedTime}</p>
            </div>
          )}

          {/* Invitee list */}
          {data.invitees.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invitees found.</p>
          ) : (
            <ul className="space-y-2" role="group" aria-label="Invitees">
              {data.invitees.map((inv) => {
                const checked = selected.has(inv.invitee_uri);
                return (
                  <li key={inv.invitee_uri}>
                    <label className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 cursor-pointer hover:bg-muted/30">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleInvitee(inv.invitee_uri)}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      {/* Avatar/initials */}
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground select-none">
                        {initials(inv.name)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium text-foreground truncate">
                            {inv.name || "Unknown"}
                          </span>
                          {inv.is_guest && (
                            <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              Guest
                            </span>
                          )}
                        </div>
                        {inv.email && (
                          <p className="text-xs text-muted-foreground truncate">{inv.email}</p>
                        )}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

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
