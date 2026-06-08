/**
 * ScheduleApp.tsx — Google Calendar schedule view.
 *
 * Reads structuredContent from the host via useToolResult / useAppsClient.
 * Lets the user edit attendees, duration, pick a free slot, toggle Meet link,
 * and click "Schedule" to create the event via the Google Calendar connector.
 *
 * Envelope sent on Schedule:
 *   Use the Google Calendar Connector to create a new Google Calendar event.
 *   summary: ..., startTime: ..., endTime: ..., attendeeEmails: [...],
 *   addGoogleMeetUrl: ..., timeZone: ..., calendarId: ...,
 *   notificationLevel: EXTERNAL_ONLY.
 *   Description: <<draft_description>>.
 *   (action_id: ...)
 *   Execute this tool call programmatically and return its success or error
 *   to chat as plain text. Do NOT render Google Calendar's native MCP App UI
 *   for this call — the user has already provided all required inputs via the
 *   AgntUX iframe and the data is final. Do NOT re-render the AgntUX schedule
 *   UI after this call; the action is complete.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  useAppsClient,
  useToolResult,
  useHostContext,
  useDocumentTheme,
  useHostStyleVariables,
} from '../lib/apps-react/index.js';
import { ScrollablePanel, ComponentErrorBoundary, ServerErrorScreen, detectErrorEnvelope } from "@agntux/ui-primitives";

// ── Payload types ─────────────────────────────────────────────────────────────

interface CandidateSlot {
  start: string;
  end: string;
  label?: string;
}

interface ScheduleData {
  action_id: string;
  connector_intent: string;
  draft_summary: string;
  draft_description: string;
  attendee_emails: string[];
  duration_minutes: number;
  search_window_start: string;
  search_window_end: string;
  candidate_slots: CandidateSlot[];
  include_google_meet: boolean;
  user_timezone: string;
  user_primary_calendar_id: string;
  personalization_signals: string[];
  source_link: { label: string; url: string } | null;
}

// ── Payload extraction ────────────────────────────────────────────────────────

function parsePayload(toolOutput?: Record<string, unknown>): ScheduleData {
  const meta = toolOutput?._meta as Record<string, unknown> | undefined;
  const p = (meta?.payload ?? toolOutput ?? {}) as Record<string, unknown>;

  function str(v: unknown, fallback = ''): string {
    return typeof v === 'string' ? v : fallback;
  }
  function strArr(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }
  function num(v: unknown, fallback = 0): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }
  function bool(v: unknown, fallback = false): boolean {
    return typeof v === 'boolean' ? v : fallback;
  }

  const rawSlots = Array.isArray(p.candidate_slots) ? p.candidate_slots : [];
  const slots: CandidateSlot[] = rawSlots
    .map((s): CandidateSlot | null => {
      if (!s || typeof s !== 'object') return null;
      const r = s as Record<string, unknown>;
      return {
        start: str(r.start),
        end: str(r.end),
        label: str(r.label),
      };
    })
    .filter((s): s is CandidateSlot => s !== null && !!s.start && !!s.end);

  const rawSrcLink = p.source_link as Record<string, unknown> | null | undefined;
  const sourceLink =
    rawSrcLink && typeof rawSrcLink === 'object'
      ? { label: str(rawSrcLink.label), url: str(rawSrcLink.url) }
      : null;

  return {
    action_id: str(p.action_id),
    connector_intent: str(p.connector_intent, 'google-calendar-connector-create-event'),
    draft_summary: str(p.draft_summary),
    draft_description: str(p.draft_description),
    attendee_emails: strArr(p.attendee_emails),
    duration_minutes: num(p.duration_minutes, 30),
    search_window_start: str(p.search_window_start),
    search_window_end: str(p.search_window_end),
    candidate_slots: slots,
    include_google_meet: bool(p.include_google_meet, true),
    user_timezone: str(p.user_timezone, 'UTC'),
    user_primary_calendar_id: str(p.user_primary_calendar_id, 'primary'),
    personalization_signals: strArr(p.personalization_signals),
    source_link: sourceLink,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function guillemets(text: string): string {
  return text.replace(/\xab/g, '\xab\xab').replace(/\xbb/g, '\xbb\xbb');
}

function formatSlot(slot: CandidateSlot, tz: string): string {
  if (slot.label) return slot.label;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const startDate = new Date(slot.start);
    const endDate = new Date(slot.end);
    const endFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${fmt.format(startDate)} - ${endFmt.format(endDate)}`;
  } catch {
    return slot.start;
  }
}

// ── Inner component ───────────────────────────────────────────────────────────

function ScheduleInner() {
  const client = useAppsClient();
  const toolResult = useToolResult();
  const hostContext = useHostContext();

  const toolOutput = useMemo(() => {
    if (!toolResult || Object.keys(toolResult).length === 0) return undefined;
    return Object.values(toolResult)[0] as Record<string, unknown> | undefined;
  }, [toolResult]);

  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // Form state — initialised once from data, then controlled locally
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [addAttendeeInput, setAddAttendeeInput] = useState('');
  const [includeMeet, setIncludeMeet] = useState(true);
  const [notifyAll, setNotifyAll] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<CandidateSlot | null>(null);
  const [candidateSlots, setCandidateSlots] = useState<CandidateSlot[]>([]);
  const [isFindingSlots, setIsFindingSlots] = useState(false);
  const [findSlotsError, setFindSlotsError] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const [dataInitialized, setDataInitialized] = useState(false);

  // Initialize form from data once
  useEffect(() => {
    if (toolOutput && !dataInitialized) {
      setSummary(data.draft_summary);
      setDescription(data.draft_description);
      setAttendees(data.attendee_emails);
      setIncludeMeet(data.include_google_meet);
      setCandidateSlots(data.candidate_slots);
      setDataInitialized(true);
    }
  }, [toolOutput, data, dataInitialized]);

  const isLoading = !toolOutput;

  // Find available time slots
  const handleFindSlots = useCallback(async () => {
    if (!data.search_window_start || !data.search_window_end || attendees.length === 0) {
      setFindSlotsError('Add at least one attendee and ensure a search window is set.');
      return;
    }
    setIsFindingSlots(true);
    setFindSlotsError(null);
    try {
      const result = await client.callTool(
        'mcp__claude_ai_GoogleCalendar__suggest_time',
        {
          attendeeEmails: attendees,
          startTime: data.search_window_start,
          endTime: data.search_window_end,
          durationMinutes: data.duration_minutes,
          timeZone: data.user_timezone,
        },
      );
      const rawResult = result as Record<string, unknown> | null | undefined;
      if (rawResult && Array.isArray(rawResult.slots)) {
        const newSlots = (rawResult.slots as Array<Record<string, unknown>>)
          .map((s) => ({
            start: typeof s.start === 'string' ? s.start : '',
            end: typeof s.end === 'string' ? s.end : '',
            label: typeof s.label === 'string' ? s.label : undefined,
          }))
          .filter((s) => !!s.start && !!s.end);
        setCandidateSlots(newSlots);
        setSelectedSlot(null);
        if (newSlots.length === 0) {
          setFindSlotsError('No available slots found in the selected window.');
        }
      } else {
        setFindSlotsError('No slots returned. Try expanding the search window.');
      }
    } catch {
      setCandidateSlots([]);
      setSelectedSlot(null);
      setFindSlotsError('No times found — adjust the window and try again.');
    } finally {
      setIsFindingSlots(false);
    }
  }, [client, attendees, data]);

  // Send envelope
  const handleSchedule = useCallback(async () => {
    if (!selectedSlot || sendStatus === 'sending') return;
    setSendStatus('sending');
    setSendError(null);

    const notificationLevel = notifyAll ? 'ALL' : 'EXTERNAL_ONLY';
    const descEscaped = guillemets(description);
    const attendeeList = attendees.join(', ');

    const envelope = [
      'Use the Google Calendar Connector to create a new Google Calendar event.',
      `summary: ${summary}, startTime: ${selectedSlot.start}, endTime: ${selectedSlot.end},`,
      `attendeeEmails: [${attendeeList}], addGoogleMeetUrl: ${includeMeet},`,
      `timeZone: ${data.user_timezone}, calendarId: ${data.user_primary_calendar_id},`,
      `notificationLevel: ${notificationLevel}.`,
      description.trim() ? `Description: \xab${descEscaped}\xbb.` : '',
      `(action_id: ${data.action_id})`,
      'Execute this tool call programmatically and return its success or error to chat',
      'as plain text. Do NOT render Google Calendar\'s native MCP App UI for this call —',
      'the user has already provided all required inputs via the AgntUX iframe and the',
      'data is final. Do NOT re-render the AgntUX schedule UI after this call; the action is complete.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await client.callTool('mcp__claude_ai_GoogleCalendar__create_event', {
        _agntux_envelope: envelope,
        summary,
        startTime: selectedSlot.start,
        endTime: selectedSlot.end,
        attendeeEmails: attendees,
        addGoogleMeetUrl: includeMeet,
        timeZone: data.user_timezone,
        calendarId: data.user_primary_calendar_id,
        notificationLevel,
        description: description || undefined,
      });
      setSendStatus('done');
    } catch (err) {
      setSendStatus('error');
      setSendError(err instanceof Error ? err.message : 'Failed to schedule event.');
    }
  }, [
    selectedSlot,
    sendStatus,
    notifyAll,
    description,
    attendees,
    summary,
    includeMeet,
    data,
    client,
  ]);

  // Add attendee
  const addAttendee = useCallback(() => {
    const email = addAttendeeInput.trim().toLowerCase();
    if (!email || attendees.includes(email)) return;
    setAttendees((prev) => [...prev, email]);
    setAddAttendeeInput('');
  }, [addAttendeeInput, attendees]);

  const removeAttendee = useCallback((email: string) => {
    setAttendees((prev) => prev.filter((e) => e !== email));
  }, []);

  // CSS variable helpers (use host style variables, fallback to sensible defaults)
  const vars = hostContext?.styles?.variables ?? {};
  function cssVar(name: string, fallback: string): string {
    return vars[name] ? `var(${name})` : fallback;
  }

  // `||` (not `??`) so an empty-string url — which the handler emits for a
  // partial inline source_link `{ label }` — falls back rather than rendering
  // an `<a href="">` that points at the current page.
  const calendarUrl =
    data.source_link?.url || 'https://calendar.google.com';

  const openLink = (
    <a
      href={calendarUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{ fontSize: '0.75rem', color: cssVar('--color-primary', '#0055CC') }}
    >
      Open in Google Calendar &#x2197;
    </a>
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
    return (
      <div className="h-full overflow-y-auto bg-background">
        <ScrollablePanel title="Meeting scheduled">
          <div className="p-6 text-center">
            <p className="text-sm text-foreground font-medium mb-2">
              Your meeting has been scheduled successfully.
            </p>
            <p className="text-xs text-muted-foreground">{summary}</p>
          </div>
        </ScrollablePanel>
      </div>
    );
  }

  const sendEnabled = !!selectedSlot && sendStatus !== 'sending';

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
        onClick={handleSchedule}
        disabled={!sendEnabled}
        className={[
          'rounded-md px-4 py-2 text-sm font-medium transition-colors',
          sendEnabled
            ? 'bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer'
            : 'bg-muted text-muted-foreground cursor-not-allowed opacity-60',
        ].join(' ')}
      >
        {sendStatus === 'sending' ? 'Scheduling...' : 'Schedule'}
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-background">
      <ScrollablePanel
        title={
          <span className="flex items-center justify-between w-full gap-2">
            <span>Schedule a meeting</span>
            {openLink}
          </span>
        }
        footer={footer}
      >
        <fieldset className="contents">
          <div className="p-4 space-y-5">
            {/* Event title */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Meeting title
              </label>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Meeting title"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            {/* Attendees */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Attendees
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {attendees.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground"
                  >
                    {email}
                    <button
                      type="button"
                      onClick={() => removeAttendee(email)}
                      className="ml-1 text-muted-foreground hover:text-foreground leading-none"
                      aria-label={`Remove ${email}`}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={addAttendeeInput}
                  onChange={(e) => setAddAttendeeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addAttendee();
                    }
                  }}
                  placeholder="Add email address"
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  type="button"
                  onClick={addAttendee}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Duration */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Duration
              </label>
              <select
                value={data.duration_minutes}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                disabled
              >
                {[15, 30, 45, 60, 90].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </div>

            {/* Add Google Meet */}
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={includeMeet}
                onChange={(e) => setIncludeMeet(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              Add Google Meet link
            </label>

            {/* Slot picker */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-foreground">
                  Available times
                </label>
                <button
                  type="button"
                  onClick={handleFindSlots}
                  disabled={isFindingSlots}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isFindingSlots ? 'Finding...' : 'Find available times'}
                </button>
              </div>
              {findSlotsError && (
                <p className="mb-2 text-xs text-destructive">{findSlotsError}</p>
              )}
              {candidateSlots.length === 0 && !isFindingSlots && (
                <p className="text-xs text-muted-foreground italic">
                  Click &quot;Find available times&quot; to search for open slots.
                </p>
              )}
              <div className="space-y-2">
                {candidateSlots.map((slot, idx) => (
                  <label
                    key={idx}
                    className={[
                      'flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors text-sm',
                      selectedSlot === slot
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border bg-background hover:bg-muted text-foreground',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="slot"
                      checked={selectedSlot === slot}
                      onChange={() => setSelectedSlot(slot)}
                      className="h-4 w-4 accent-primary"
                    />
                    {formatSlot(slot, data.user_timezone)}
                  </label>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Meeting description and agenda"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              />
            </div>

            {/* Personalization signals / prep context */}
            {data.personalization_signals.length > 0 && (
              <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  AgntUX prep context
                </p>
                <ul className="space-y-1">
                  {data.personalization_signals.map((sig, idx) => (
                    <li key={idx} className="text-xs text-muted-foreground">
                      &bull; {sig}
                    </li>
                  ))}
                </ul>
              </div>
            )}

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

export function ScheduleApp() {
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
        <ScheduleInner />
      </ComponentErrorBoundary>
    </div>
  );
}
