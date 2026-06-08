// =============================================================================
// agntux-google-calendar — view-tool module.
//
// Exports TWO view tools:
//   1. agntux_google_calendar_schedule_view  (ui://agntux-google-calendar/schedule)
//   2. agntux_google_calendar_respond_view   (ui://agntux-google-calendar/respond)
//
// Both tools read from an action file on disk, extract a plugin-specific YAML
// payload section, and return structuredContent the iframe consumes.
//
// Payload-shape contract (frozen, tested by __tests__/payload-shape.test.ts):
//   schedule: draft_summary, draft_description, attendee_emails,
//             duration_minutes, candidate_slots, user_timezone,
//             user_primary_calendar_id, personalization_signals,
//             search_window_start, search_window_end, include_google_meet,
//             connector_intent, action_id
//   respond:  event_id, calendar_id, event_summary, event_start, event_end,
//             event_timezone, event_location, event_meet_url,
//             event_description_excerpt, organizer_name, organizer_email,
//             attendees, current_response_status, prep_summary, prep_signals,
//             personalization_signals, connector_intent, action_id
// =============================================================================

import {
  type ViewTool,
  type ViewToolContext,
  type ViewToolModule,
  parseFrontmatter,
  extractFencedYaml,
  renderConfirmationText,
} from "@agntux/plugin-runtime";
import { load as parseYaml } from "js-yaml";

// ── Constants ────────────────────────────────────────────────────────────────

const SCHEDULE_RESOURCE_URI = "ui://agntux-google-calendar/schedule" as const;
const RESPOND_RESOURCE_URI = "ui://agntux-google-calendar/respond" as const;

const SCHEDULE_UI_LABEL = "AgntUX Google Calendar — Schedule meeting";
const RESPOND_UI_LABEL = "AgntUX Google Calendar — Respond to invite";

// ── Helpers ──────────────────────────────────────────────────────────────────

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asUnknownArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

/** Parse a fenced YAML section from the body of an action file.
 * Returns null if the section is absent or the YAML is unparseable.
 */
function parseSectionYaml(
  body: string,
  sectionHeader: string,
): Record<string, unknown> | null {
  const raw = extractFencedYaml(body, sectionHeader);
  if (!raw) return null;
  try {
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // malformed YAML — return null so caller uses defaults
  }
  return null;
}

// ── SCHEDULE view tool ───────────────────────────────────────────────────────

// Dual-trigger args. The schedule view is reachable two ways:
//   1. User-initiated (ad-hoc) — the skill's schedule lane resolves attendees,
//      window, and candidate slots (via suggest_time) and opens the view with
//      every field passed INLINE. `action_id` may be "" / absent.
//   2. Action-item — `action_id` only; the handler reads the pre-composed
//      `## Schedule payload` from actions/{action_id}.md on disk.
// Resolution order (mirrors draft-flow-author.md §2b): inline → disk → empty.
// All inline fields are optional; coerced over EMPTY_PAYLOAD defaults.
// Inline presence wins UNCONDITIONALLY: if ANY inline field is supplied, the
// action file is NOT read even when action_id is also present. In practice the
// two shapes never co-occur — the skill lane passes inline fields XOR an
// action_id — but the precedence is defined so a future cross-plugin caller
// that supplies both gets the inline payload, not a surprise disk read.
interface ScheduleArgs {
  action_id?: string;
  draft_summary?: string;
  draft_description?: string;
  attendee_emails?: string[];
  duration_minutes?: number;
  search_window_start?: string;
  search_window_end?: string;
  preferred_hours?: {
    start?: string;
    end?: string;
    exclude_weekends?: boolean;
  };
  candidate_slots?: unknown[];
  include_google_meet?: boolean;
  user_timezone?: string;
  user_primary_calendar_id?: string;
  personalization_signals?: string[];
  source_link?: { label?: string; url?: string } | null;
}

/** True when the caller supplied any inline scheduling field — the signal of a
 * user-initiated (ad-hoc) request rather than an action-file trigger. Presence
 * (not truthiness) is the test: an explicitly-passed empty array / "" still
 * selects the inline path so the view renders the user's resolved inputs rather
 * than silently falling back to a disk read of a non-existent action file. */
function hasInlineScheduleArgs(args: ScheduleArgs): boolean {
  return (
    args.draft_summary !== undefined ||
    args.draft_description !== undefined ||
    args.attendee_emails !== undefined ||
    args.duration_minutes !== undefined ||
    args.search_window_start !== undefined ||
    args.search_window_end !== undefined ||
    args.preferred_hours !== undefined ||
    args.candidate_slots !== undefined ||
    args.include_google_meet !== undefined ||
    args.user_timezone !== undefined ||
    args.user_primary_calendar_id !== undefined ||
    args.personalization_signals !== undefined ||
    args.source_link !== undefined
  );
}

interface SchedulePayload {
  action_id: string;
  connector_intent: string;
  draft_summary: string;
  draft_description: string;
  attendee_emails: string[];
  duration_minutes: number;
  search_window_start: string;
  search_window_end: string;
  preferred_hours: {
    start: string;
    end: string;
    exclude_weekends: boolean;
  };
  candidate_slots: unknown[];
  include_google_meet: boolean;
  user_timezone: string;
  user_primary_calendar_id: string;
  personalization_signals: string[];
  source_link: {
    label: string;
    url: string;
  } | null;
}

async function handleSchedule(
  args: ScheduleArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: SchedulePayload;
}> {
  // Render-harness contract: empty args ({}) must render placeholders, never
  // build actions/undefined.md. Normalise action_id up front; "" is valid.
  const actionId = typeof args.action_id === "string" ? args.action_id : "";
  const path = `actions/${actionId}.md`;

  const EMPTY_PAYLOAD: SchedulePayload = {
    action_id: actionId,
    connector_intent: "google-calendar-connector-create-event",
    draft_summary: "",
    draft_description: "",
    attendee_emails: [],
    duration_minutes: 30,
    search_window_start: "",
    search_window_end: "",
    preferred_hours: { start: "09:00", end: "17:00", exclude_weekends: true },
    candidate_slots: [],
    include_google_meet: true,
    user_timezone: "UTC",
    user_primary_calendar_id: "primary",
    personalization_signals: [],
    source_link: null,
  };

  // ── Inline (user-initiated) path ────────────────────────────────────────────
  // The skill's schedule lane resolved attendees, window, draft, and candidate
  // slots and passed them inline. Build the payload from those over the
  // EMPTY_PAYLOAD defaults — no fs read, no action file required. action_id may
  // be "" here (ad-hoc requests have no backing action item).
  if (hasInlineScheduleArgs(args)) {
    const preferredHoursRaw = asRecord(args.preferred_hours);
    const sourceLinkRaw = asRecord(args.source_link);

    const structuredContent: SchedulePayload = {
      action_id: actionId,
      connector_intent: "google-calendar-connector-create-event",
      draft_summary: asString(args.draft_summary),
      draft_description: asString(args.draft_description),
      attendee_emails: asStringArray(args.attendee_emails),
      duration_minutes: asNumber(args.duration_minutes, 30),
      search_window_start: asString(args.search_window_start),
      search_window_end: asString(args.search_window_end),
      preferred_hours: {
        start: asString(preferredHoursRaw.start, "09:00"),
        end: asString(preferredHoursRaw.end, "17:00"),
        exclude_weekends:
          typeof preferredHoursRaw.exclude_weekends === "boolean"
            ? preferredHoursRaw.exclude_weekends
            : true,
      },
      candidate_slots: asUnknownArray(args.candidate_slots),
      include_google_meet:
        typeof args.include_google_meet === "boolean"
          ? args.include_google_meet
          : true,
      user_timezone: asString(args.user_timezone, "UTC"),
      user_primary_calendar_id: asString(
        args.user_primary_calendar_id,
        "primary",
      ),
      personalization_signals: asStringArray(args.personalization_signals),
      source_link:
        Object.keys(sourceLinkRaw).length > 0
          ? {
              label: asString(sourceLinkRaw.label),
              url: asString(sourceLinkRaw.url),
            }
          : null,
    };

    return {
      content: [{ type: "text", text: renderConfirmationText(SCHEDULE_UI_LABEL) }],
      structuredContent,
    };
  }

  // ── Action-file path ────────────────────────────────────────────────────────
  // No inline args: an empty action_id can only yield the empty form.
  if (!actionId) {
    return {
      content: [{ type: "text", text: renderConfirmationText(SCHEDULE_UI_LABEL) }],
      structuredContent: EMPTY_PAYLOAD,
    };
  }

  try {
    const buf = await ctx.fs.readFile(path);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);

    const raw = parseSectionYaml(body, "Schedule payload");
    if (!raw) {
      return {
        content: [{ type: "text", text: renderConfirmationText(SCHEDULE_UI_LABEL) }],
        structuredContent: EMPTY_PAYLOAD,
      };
    }

    const preferredHoursRaw = asRecord(raw.preferred_hours);
    const sourceLinkRaw = asRecord(raw.source_link);

    const structuredContent: SchedulePayload = {
      action_id: actionId,
      connector_intent: "google-calendar-connector-create-event",
      draft_summary: asString(raw.draft_summary),
      draft_description: asString(raw.draft_description),
      attendee_emails: asStringArray(raw.attendee_emails),
      duration_minutes: asNumber(raw.duration_minutes, 30),
      search_window_start: asString(raw.search_window_start),
      search_window_end: asString(raw.search_window_end),
      preferred_hours: {
        start: asString(preferredHoursRaw.start, "09:00"),
        end: asString(preferredHoursRaw.end, "17:00"),
        exclude_weekends:
          typeof preferredHoursRaw.exclude_weekends === "boolean"
            ? preferredHoursRaw.exclude_weekends
            : true,
      },
      candidate_slots: asUnknownArray(raw.candidate_slots),
      include_google_meet:
        typeof raw.include_google_meet === "boolean"
          ? raw.include_google_meet
          : true,
      user_timezone: asString(raw.user_timezone, "UTC"),
      user_primary_calendar_id: asString(
        raw.user_primary_calendar_id,
        "primary",
      ),
      personalization_signals: asStringArray(raw.personalization_signals),
      source_link:
        Object.keys(sourceLinkRaw).length > 0
          ? {
              label: asString(sourceLinkRaw.label),
              url: asString(sourceLinkRaw.url),
            }
          : null,
    };

    return {
      content: [{ type: "text", text: renderConfirmationText(SCHEDULE_UI_LABEL) }],
      structuredContent,
    };
  } catch {
    // Any error during fixture load (FS missing, args.action_id undefined in
    // test harness, parse failure) → return the empty payload so the iframe
    // renders with placeholders rather than surfacing a 500 to the host.
    return {
      content: [{ type: "text", text: renderConfirmationText(SCHEDULE_UI_LABEL) }],
      structuredContent: EMPTY_PAYLOAD,
    };
  }
}

const scheduleViewTool: ViewTool<ScheduleArgs, SchedulePayload> = {
  descriptor: {
    name: "agntux_google_calendar_schedule_view",
    description:
      "Use this whenever the user wants to find a time to meet or schedule a " +
      "meeting on Google Calendar — both ad-hoc user-initiated requests " +
      "(\"find a time next week with Alice and Bob about the roadmap\", " +
      "\"set up a 30-min call with the design team\") and pre-composed " +
      "scheduling action items. Two call shapes: (1) USER-INITIATED — pass the " +
      "meeting fields inline (draft_summary, draft_description, attendee_emails, " +
      "duration_minutes, search_window_start/end, candidate_slots, user_timezone, " +
      "user_primary_calendar_id, include_google_meet); the view opens " +
      "pre-populated with the title, attendees, and candidate slots so the user " +
      "just picks one and clicks Schedule. (2) ACTION-ITEM — pass an action_id and " +
      "the handler reads the pre-composed draft from actions/{action_id}.md. " +
      "The user selects a free slot and clicks Send to create the Google Calendar " +
      "event via the connector. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action_id: {
          type: "string",
          description:
            "Action-item trigger: the action item ID (filename stem under " +
            "actions/). Optional — omit (or pass \"\") for user-initiated " +
            "requests that supply the scheduling fields inline instead.",
        },
        draft_summary: {
          type: "string",
          description: "User-initiated: pre-filled meeting title (editable).",
        },
        draft_description: {
          type: "string",
          description: "User-initiated: pre-filled meeting description / agenda.",
        },
        attendee_emails: {
          type: "array",
          items: { type: "string" },
          description:
            "User-initiated: attendee email addresses (exclude the user's own).",
        },
        duration_minutes: {
          type: "number",
          description: "User-initiated: meeting length in minutes (default 30).",
        },
        search_window_start: {
          type: "string",
          description:
            "User-initiated: ISO-8601 start of the find-a-time window.",
        },
        search_window_end: {
          type: "string",
          description: "User-initiated: ISO-8601 end of the find-a-time window.",
        },
        preferred_hours: {
          type: "object",
          properties: {
            start: { type: "string" },
            end: { type: "string" },
            exclude_weekends: { type: "boolean" },
          },
          description:
            "User-initiated: working-hours bounds for slot suggestions.",
        },
        candidate_slots: {
          type: "array",
          description:
            "User-initiated: pre-computed free/busy slots from suggest_time " +
            "({start,end,label?}). Pre-fills the slot picker.",
        },
        include_google_meet: {
          type: "boolean",
          description: "User-initiated: add a Google Meet link (default true).",
        },
        user_timezone: {
          type: "string",
          description: "User-initiated: IANA timezone (e.g. America/Denver).",
        },
        user_primary_calendar_id: {
          type: "string",
          description: "User-initiated: target calendar id (default \"primary\").",
        },
        personalization_signals: {
          type: "array",
          items: { type: "string" },
          description: "User-initiated: short prep-context bullets.",
        },
        source_link: {
          type: ["object", "null"],
          description:
            "User-initiated: {label,url} link back to the triggering context.",
        },
      },
      required: [],
      additionalProperties: true,
    },
    outputSchema: {
      type: "object" as const,
      properties: {
        action_id: { type: "string" },
        connector_intent: { type: "string" },
        draft_summary: { type: "string" },
        draft_description: { type: "string" },
        attendee_emails: { type: "array", items: { type: "string" } },
        duration_minutes: { type: "number" },
        search_window_start: { type: "string" },
        search_window_end: { type: "string" },
        preferred_hours: {
          type: "object",
          properties: {
            start: { type: "string" },
            end: { type: "string" },
            exclude_weekends: { type: "boolean" },
          },
          required: ["start", "end", "exclude_weekends"],
        },
        candidate_slots: { type: "array" },
        include_google_meet: { type: "boolean" },
        user_timezone: { type: "string" },
        user_primary_calendar_id: { type: "string" },
        personalization_signals: { type: "array", items: { type: "string" } },
        source_link: { type: ["object", "null"] },
      },
      required: [
        "action_id",
        "connector_intent",
        "draft_summary",
        "candidate_slots",
        "attendee_emails",
        "duration_minutes",
        "user_timezone",
        "user_primary_calendar_id",
      ],
      additionalProperties: true,
    },
    ui_resource_uri: SCHEDULE_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" as const }],
  },
  handle: handleSchedule,
};

// ── RESPOND view tool ─────────────────────────────────────────────────────────

interface RespondArgs {
  action_id: string;
}

interface AttendeeEntry {
  name: string;
  email: string;
  response_status: string;
}

interface PrepSignalEntry {
  label: string;
  href: string;
}

interface RespondPayload {
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
  source_link: {
    label: string;
    url: string;
  } | null;
}

function asAttendees(v: unknown): AttendeeEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      return {
        name: asString(r.name),
        email: asString(r.email),
        response_status: asString(r.response_status, "needsAction"),
      };
    })
    .filter((e): e is AttendeeEntry => e !== null);
}

function asPrepSignals(v: unknown): PrepSignalEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      return {
        label: asString(r.label),
        href: asString(r.href),
      };
    })
    .filter((e): e is PrepSignalEntry => e !== null);
}

async function handleRespond(
  args: RespondArgs,
  ctx: ViewToolContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: RespondPayload;
}> {
  const path = `actions/${args.action_id}.md`;

  const EMPTY_PAYLOAD: RespondPayload = {
    action_id: args.action_id,
    connector_intent: "google-calendar-connector-respond",
    event_id: "",
    calendar_id: "primary",
    event_summary: "",
    event_start: "",
    event_end: "",
    event_timezone: "UTC",
    event_location: null,
    event_meet_url: null,
    event_description_excerpt: null,
    organizer_name: "",
    organizer_email: "",
    attendees: [],
    current_response_status: "needsAction",
    prep_summary: "",
    prep_signals: [],
    personalization_signals: [],
    source_link: null,
  };

  try {
    const buf = await ctx.fs.readFile(path);
    const text = buf.toString("utf8");
    const { body } = parseFrontmatter(text);

    const raw = parseSectionYaml(body, "Respond payload");
    if (!raw) {
      return {
        content: [{ type: "text", text: renderConfirmationText(RESPOND_UI_LABEL) }],
        structuredContent: EMPTY_PAYLOAD,
      };
    }

    const sourceLinkRaw = asRecord(raw.source_link);

    const structuredContent: RespondPayload = {
      action_id: args.action_id,
      connector_intent: "google-calendar-connector-respond",
      event_id: asString(raw.event_id),
      calendar_id: asString(raw.calendar_id, "primary"),
      event_summary: asString(raw.event_summary),
      event_start: asString(raw.event_start),
      event_end: asString(raw.event_end),
      event_timezone: asString(raw.event_timezone, "UTC"),
      event_location: asStringOrNull(raw.event_location),
      event_meet_url: asStringOrNull(raw.event_meet_url),
      event_description_excerpt: asStringOrNull(raw.event_description_excerpt),
      organizer_name: asString(raw.organizer_name),
      organizer_email: asString(raw.organizer_email),
      attendees: asAttendees(raw.attendees),
      current_response_status: asString(
        raw.current_response_status,
        "needsAction",
      ),
      prep_summary: asString(raw.prep_summary),
      prep_signals: asPrepSignals(raw.prep_signals),
      personalization_signals: asStringArray(raw.personalization_signals),
      source_link:
        Object.keys(sourceLinkRaw).length > 0
          ? {
              label: asString(sourceLinkRaw.label),
              url: asString(sourceLinkRaw.url),
            }
          : null,
    };

    return {
      content: [{ type: "text", text: renderConfirmationText(RESPOND_UI_LABEL) }],
      structuredContent,
    };
  } catch {
    // Any error during fixture load (FS missing, args.action_id undefined in
    // test harness, parse failure) → return the empty payload so the iframe
    // renders with placeholders rather than surfacing a 500 to the host.
    return {
      content: [{ type: "text", text: renderConfirmationText(RESPOND_UI_LABEL) }],
      structuredContent: EMPTY_PAYLOAD,
    };
  }
}

const respondViewTool: ViewTool<RespondArgs, RespondPayload> = {
  descriptor: {
    name: "agntux_google_calendar_respond_view",
    description:
      "Opens the AgntUX Google Calendar RSVP interface for a meeting invite. " +
      "Given an action_id for a response-needed or meeting-prep action item, reads " +
      "the event card (title, time, location, Meet link, organizer, attendee list), " +
      "any double-booking conflicts, and prep context (summary + source links). " +
      "The user picks Accept / Tentative / Decline, optionally adds a note, and " +
      "clicks Send response to submit their RSVP via the Google Calendar connector. " +
      "This tool is an MCP App view tool: it returns a structured data " +
      "payload that the host (Claude Desktop / Claude Cowork / Claude Code) " +
      "renders into an interactive iframe shown above the next assistant " +
      "turn. The iframe is the user-visible result of calling this tool; " +
      "no additional chat output, summary, or visualization tool call is " +
      "needed afterwards.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action_id: {
          type: "string",
          description: "The action item ID (filename stem under actions/).",
        },
      },
      required: ["action_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object" as const,
      properties: {
        action_id: { type: "string" },
        connector_intent: { type: "string" },
        event_id: { type: "string" },
        calendar_id: { type: "string" },
        event_summary: { type: "string" },
        event_start: { type: "string" },
        event_end: { type: "string" },
        event_timezone: { type: "string" },
        event_location: { type: ["string", "null"] },
        event_meet_url: { type: ["string", "null"] },
        event_description_excerpt: { type: ["string", "null"] },
        organizer_name: { type: "string" },
        organizer_email: { type: "string" },
        attendees: { type: "array" },
        current_response_status: { type: "string" },
        prep_summary: { type: "string" },
        prep_signals: { type: "array" },
        personalization_signals: { type: "array", items: { type: "string" } },
        source_link: { type: ["object", "null"] },
      },
      required: [
        "action_id",
        "connector_intent",
        "event_id",
        "calendar_id",
        "event_summary",
        "current_response_status",
        "attendees",
      ],
      additionalProperties: true,
    },
    ui_resource_uri: RESPOND_RESOURCE_URI,
    data_paths: [{ pattern: "actions/{id}.md", scope: "personal" as const }],
  },
  handle: handleRespond,
};

// ── Default export ───────────────────────────────────────────────────────────

const mod: ViewToolModule = {
  viewTools: [scheduleViewTool, respondViewTool],
};
export default mod;
