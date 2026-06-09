/**
 * RespondApp.tsx — Google Calendar respond-to-invite view.
 *
 * Shows:
 *   - Event card (title, time, location, Meet URL, organizer)
 *   - Attendee list with response status badges
 *   - Prep summary + prep signals as linked bullets
 *   - Mode tab strip: Accept / Tentative / Decline
 *   - Optional response note textarea
 *   - "Notify all attendees" checkbox
 *   - Send response button
 *
 * Envelope sent on Send:
 *   Use the Google Calendar Connector to {verbLabel} a Google Calendar event invitation.
 *   eventId: ..., calendarId: ..., responseStatus: ..., notificationLevel: ...
 *   responseComment: <<comment>>   (only when non-empty)
 *   Event: "..."
 *   (action_id: ...)
 *   Execute this tool call programmatically...
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  useAppsClient,
  useToolResult,
  useDocumentTheme,
  useHostStyleVariables,
} from '../lib/apps-react/index.js';
import { ScrollablePanel, ComponentErrorBoundary, ServerErrorScreen, detectErrorEnvelope } from "@agntux/ui-primitives";
import { ExternalLink } from './external-link.js';

// ── Payload types ─────────────────────────────────────────────────────────────

interface AttendeeEntry {
  name: string;
  email: string;
  response_status: string;
}

interface PrepSignalEntry {
  label: string;
  href: string;
}

interface RespondData {
  action_id: string;
  connector_intent: string;
  event_id: string;
  calendar_id: string;
  event_summary: string;
  event_start: string;
  event_end: string;
  event_timezone: string;
  event_location: string | null;
  event_meet_url: string | null;
  event_description_excerpt: string | null;
  organizer_name: string;
  organizer_email: string;
  attendees: AttendeeEntry[];
  current_response_status: string;
  prep_summary: string;
  prep_signals: PrepSignalEntry[];
  personalization_signals: string[];
  source_link: { label: string; url: string } | null;
}

// ── Payload extraction ────────────────────────────────────────────────────────

function parsePayload(toolOutput?: Record<string, unknown>): RespondData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const p = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;

  function str(v: unknown, fallback = ''): string {
    return typeof v === 'string' ? v : fallback;
  }
  function strOrNull(v: unknown): string | null {
    return typeof v === 'string' ? v : null;
  }
  function strArr(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }

  const rawAttendees = Array.isArray(p.attendees) ? p.attendees : [];
  const attendees: AttendeeEntry[] = rawAttendees
    .map((a) => {
      if (!a || typeof a !== 'object') return null;
      const r = a as Record<string, unknown>;
      return {
        name: str(r.name),
        email: str(r.email),
        response_status: str(r.response_status, 'needsAction'),
      };
    })
    .filter((a): a is AttendeeEntry => a !== null);

  const rawSignals = Array.isArray(p.prep_signals) ? p.prep_signals : [];
  const prepSignals: PrepSignalEntry[] = rawSignals
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const r = s as Record<string, unknown>;
      return {
        label: str(r.label),
        href: str(r.href),
      };
    })
    .filter((s): s is PrepSignalEntry => s !== null);

  const rawSrcLink = p.source_link as Record<string, unknown> | null | undefined;
  const sourceLink =
    rawSrcLink && typeof rawSrcLink === 'object'
      ? { label: str(rawSrcLink.label), url: str(rawSrcLink.url) }
      : null;

  return {
    action_id: str(p.action_id),
    connector_intent: str(p.connector_intent, 'google-calendar-connector-respond'),
    event_id: str(p.event_id),
    calendar_id: str(p.calendar_id, 'primary'),
    event_summary: str(p.event_summary),
    event_start: str(p.event_start),
    event_end: str(p.event_end),
    event_timezone: str(p.event_timezone, 'UTC'),
    event_location: strOrNull(p.event_location),
    event_meet_url: strOrNull(p.event_meet_url),
    event_description_excerpt: strOrNull(p.event_description_excerpt),
    organizer_name: str(p.organizer_name),
    organizer_email: str(p.organizer_email),
    attendees,
    current_response_status: str(p.current_response_status, 'needsAction'),
    prep_summary: str(p.prep_summary),
    prep_signals: prepSignals,
    personalization_signals: strArr(p.personalization_signals),
    source_link: sourceLink,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type ResponseMode = 'accepted' | 'tentative' | 'declined';

const VERB_LABELS: Record<ResponseMode, string> = {
  accepted: 'accept',
  tentative: 'tentatively accept',
  declined: 'decline',
};

function guillemets(text: string): string {
  return text.replace(/\xab/g, '\xab\xab').replace(/\xbb/g, '\xbb\xbb');
}

function formatDateTime(iso: string, tz: string): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function responseStatusLabel(status: string): string {
  switch (status) {
    case 'accepted': return 'Accepted';
    case 'tentative': return 'Tentative';
    case 'declined': return 'Declined';
    default: return 'Awaiting';
  }
}

function responseStatusClass(status: string): string {
  switch (status) {
    case 'accepted': return 'bg-green-100 text-green-800';
    case 'tentative': return 'bg-yellow-100 text-yellow-800';
    case 'declined': return 'bg-red-100 text-red-800';
    default: return 'bg-muted text-muted-foreground';
  }
}

function initialMode(current: string): ResponseMode {
  if (current === 'accepted') return 'accepted';
  if (current === 'tentative') return 'tentative';
  if (current === 'declined') return 'declined';
  return 'accepted'; // needsAction defaults to Accept tab
}

// ── Inner component ───────────────────────────────────────────────────────────

function RespondInner() {
  const client = useAppsClient();
  const toolResult = useToolResult();

  const toolOutput = useMemo(() => {
    if (!toolResult || Object.keys(toolResult).length === 0) return undefined;
    return Object.values(toolResult)[0] as Record<string, unknown> | undefined;
  }, [toolResult]);

  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  const [mode, setMode] = useState<ResponseMode>('accepted');
  const [responseComment, setResponseComment] = useState('');
  const [notifyAll, setNotifyAll] = useState(false);
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const [dataInitialized, setDataInitialized] = useState(false);

  useEffect(() => {
    if (toolOutput && !dataInitialized) {
      setMode(initialMode(data.current_response_status));
      setDataInitialized(true);
    }
  }, [toolOutput, data.current_response_status, dataInitialized]);

  const isLoading = !toolOutput;

  const handleSend = useCallback(async () => {
    if (sendStatus === 'sending') return;
    setSendStatus('sending');
    setSendError(null);

    const notificationLevel = notifyAll ? 'ALL' : 'EXTERNAL_ONLY';
    const verbLabel = VERB_LABELS[mode];
    const comment = responseComment.trim();
    const commentEscaped = guillemets(comment);

    const lines = [
      `Use the Google Calendar Connector to ${verbLabel} a Google Calendar event invitation.`,
      `eventId: ${data.event_id}, calendarId: ${data.calendar_id},`,
      `responseStatus: ${mode}, notificationLevel: ${notificationLevel}.`,
    ];
    if (comment) {
      lines.push(`responseComment: \xab${commentEscaped}\xbb.`);
    }
    lines.push(`Event: "${data.event_summary}".`);
    lines.push(`(action_id: ${data.action_id})`);
    lines.push(
      'Execute this tool call programmatically and return its success or error to chat',
      'as plain text. Do NOT render Google Calendar\'s native MCP App UI for this call —',
      'the user has already chosen their RSVP response via the AgntUX iframe and the',
      'data is final. Do NOT re-render the AgntUX respond UI after this call; the action is complete.',
    );
    const envelope = lines.join('\n');

    try {
      // Dispatch the connector-targeted envelope to the host's LLM, which
      // resolves the user's Google Calendar connector and runs respond_to_event.
      // We do NOT call a hard-coded `mcp__…__respond_to_event` directly: connector
      // tool names are host-specific (UUID-prefixed in local agent mode,
      // `mcp__claude_ai_Google_Calendar__…` on claude.ai), so a literal name
      // throws "Tool not found". sendFollowUpMessage is the canonical write gate
      // (connector-envelopes.md; matches agntux-slack / agntux-gmail).
      await client.sendFollowUpMessage(envelope);
      setSendStatus('done');
    } catch (err) {
      setSendStatus('error');
      setSendError(err instanceof Error ? err.message : 'Failed to send response.');
    }
  }, [sendStatus, notifyAll, mode, responseComment, data, client]);

  const calendarUrl = data.source_link?.url ?? 'https://calendar.google.com';

  const openLink = (
    <ExternalLink
      href={calendarUrl}
      ariaLabel="Open in Google Calendar"
      className="text-xs text-primary hover:underline p-0"
    >
      Open in Google Calendar &#x2197;
    </ExternalLink>
  );

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 h-6 w-56 animate-pulse rounded-md bg-muted" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="mb-4 rounded-lg border border-border p-4">
              <div className="mb-2 h-4 w-3/5 animate-pulse rounded-md bg-muted" />
              <div className="h-3 w-full animate-pulse rounded-md bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (sendStatus === 'done') {
    const pastTenseVerb =
      mode === 'accepted' ? 'accepted' : mode === 'tentative' ? 'tentatively accepted' : 'declined';
    return (
      <div className="h-full overflow-y-auto bg-background">
        <ScrollablePanel title="Response sent">
          <div className="p-6 text-center">
            <p className="text-sm text-foreground font-medium mb-2">
              You {pastTenseVerb} the invite.
            </p>
            <p className="text-xs text-muted-foreground">{data.event_summary}</p>
          </div>
        </ScrollablePanel>
      </div>
    );
  }

  const sendLabel =
    sendStatus === 'sending'
      ? 'Sending...'
      : mode === 'accepted'
      ? 'Accept'
      : mode === 'tentative'
      ? 'Accept tentatively'
      : 'Decline';

  const footer = (
    <div className="flex items-center justify-between gap-3 p-3 border-t border-border">
      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={notifyAll}
          onChange={(e) => setNotifyAll(e.target.checked)}
          className="h-3.5 w-3.5 rounded"
        />
        Notify all attendees
      </label>
      <button
        onClick={handleSend}
        disabled={sendStatus === 'sending'}
        className={[
          'rounded-md px-4 py-2 text-sm font-medium transition-colors',
          sendStatus !== 'sending'
            ? 'bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer'
            : 'bg-muted text-muted-foreground cursor-not-allowed opacity-60',
        ].join(' ')}
      >
        {sendLabel}
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-background">
      <ScrollablePanel
        title={
          <span className="flex items-center justify-between w-full gap-2">
            <span>Respond to invite</span>
            {openLink}
          </span>
        }
        footer={footer}
      >
        <fieldset className="contents">
          <div className="p-4 space-y-5">
            {/* Event card */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <h2 className="text-sm font-semibold text-foreground leading-snug">
                {data.event_summary || 'Untitled event'}
              </h2>
              {(data.event_start || data.event_end) && (
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(data.event_start, data.event_timezone)}
                  {data.event_end ? ` - ${formatDateTime(data.event_end, data.event_timezone)}` : ''}
                </p>
              )}
              {data.event_location && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Location:</span> {data.event_location}
                </p>
              )}
              {data.event_meet_url && (
                <ExternalLink
                  href={data.event_meet_url}
                  ariaLabel="Join Google Meet"
                  className="text-xs text-primary hover:underline p-0"
                >
                  Join Google Meet &#x2197;
                </ExternalLink>
              )}
              {data.organizer_name && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Organizer:</span>{' '}
                  {data.organizer_name}
                  {data.organizer_email ? ` (${data.organizer_email})` : ''}
                </p>
              )}
              {data.event_description_excerpt && (
                <p className="text-xs text-muted-foreground italic border-t border-border/50 pt-2">
                  {data.event_description_excerpt}
                </p>
              )}
            </div>

            {/* Attendees */}
            {data.attendees.length > 0 && (
              <div>
                <p className="text-xs font-medium text-foreground mb-2">
                  Attendees ({data.attendees.length})
                </p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {data.attendees.map((a) => (
                    <div
                      key={a.email}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-foreground truncate">
                        {a.name || a.email}
                      </span>
                      <span
                        className={[
                          'ml-2 flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                          responseStatusClass(a.response_status),
                        ].join(' ')}
                      >
                        {responseStatusLabel(a.response_status)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Prep summary */}
            {data.prep_summary && (
              <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Prep context
                </p>
                <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">
                  {data.prep_summary}
                </p>
              </div>
            )}

            {/* Prep signals */}
            {data.prep_signals.length > 0 && (
              <div>
                <p className="text-xs font-medium text-foreground mb-2">Sources</p>
                <ul className="space-y-1">
                  {data.prep_signals.map((sig, idx) => (
                    <li key={idx} className="text-xs">
                      <ExternalLink
                        href={sig.href}
                        className="text-primary hover:underline p-0 text-left"
                      >
                        {sig.label} &#x2197;
                      </ExternalLink>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Mode tabs */}
            <div>
              <p className="text-xs font-medium text-foreground mb-2">Your response</p>
              <div className="flex rounded-md border border-border overflow-hidden">
                {(['accepted', 'tentative', 'declined'] as ResponseMode[]).map((m) => {
                  const labels: Record<ResponseMode, string> = {
                    accepted: 'Accept',
                    tentative: 'Tentative',
                    declined: 'Decline',
                  };
                  const isActive = mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={[
                        'flex-1 px-3 py-2 text-xs font-medium transition-colors border-r last:border-r-0 border-border',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background text-foreground hover:bg-muted',
                      ].join(' ')}
                    >
                      {labels[m]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Response note */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Note to organizer <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <textarea
                value={responseComment}
                onChange={(e) => setResponseComment(e.target.value)}
                rows={3}
                placeholder="Add a note..."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              />
            </div>

            {/* Send error */}
            {sendStatus === 'error' && sendError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                <p className="text-xs text-destructive">{sendError}</p>
              </div>
            )}
          </div>
        </fieldset>
      </ScrollablePanel>
    </div>
  );
}

// ── Exported app wrapper ───────────────────────────────────────────────────────

export function RespondApp() {
  useDocumentTheme('light', 'dark');
  useHostStyleVariables();

  const toolResult = useToolResult();
  const toolOutput =
    toolResult && Object.keys(toolResult).length > 0
      ? (Object.values(toolResult)[0] as Record<string, unknown> | undefined)
      : undefined;

  const errorEnvelope = detectErrorEnvelope(toolOutput);
  if (errorEnvelope) {
    return (
      <div className="h-full">
        <ComponentErrorBoundary>
          <ServerErrorScreen message={errorEnvelope} />
        </ComponentErrorBoundary>
      </div>
    );
  }

  return (
    <div className="h-full">
      <ComponentErrorBoundary>
        <RespondInner />
      </ComponentErrorBoundary>
    </div>
  );
}
