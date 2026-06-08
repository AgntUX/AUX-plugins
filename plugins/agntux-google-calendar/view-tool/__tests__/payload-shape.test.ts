/**
 * payload-shape.test.ts — Byte-budget + frozen-keyset regression guard for
 * agntux-google-calendar view tools. Lint pass 11 (E24/E25) backstop.
 *
 * Golden rule source 1: call viewTool.handle(args, ctx) with in-memory
 * fixtures and assert the real structuredContent keyset / byte size.
 * No prose-grep; no assertions against reference/*.md body text (E30).
 *
 * Fixture content is YAML-fenced, matching what ingest writes per the
 * on-disk schema in:
 *   skills/agntux-google-calendar/_overrides/reference/schedule-payload.md
 *   skills/agntux-google-calendar/_overrides/reference/respond-payload.md
 *
 * Field-name provenance:
 *   schedule: draft_summary, draft_description, attendee_emails,
 *             duration_minutes, candidate_slots, user_timezone,
 *             user_primary_calendar_id, personalization_signals —
 *             derived verbatim from schedule-payload.md §On-disk schema.
 *   respond:  event_id, calendar_id, event_summary, event_start, event_end,
 *             event_timezone, event_location, event_meet_url,
 *             event_description_excerpt, organizer_name, organizer_email,
 *             attendees, current_response_status, prep_summary, prep_signals,
 *             personalization_signals —
 *             derived verbatim from respond-payload.md §On-disk schema.
 *
 * KEPT_KEYS adjustments from the dispatch brief:
 *   schedule: brief said `draft_title` → on-disk uses `draft_summary`
 *             brief said `draft_attendees` → on-disk uses `attendee_emails`
 *             brief said `draft_duration_minutes` → on-disk uses `duration_minutes`
 *             brief said `calendar_id` → on-disk uses `user_primary_calendar_id`
 *             brief said `suggested_slots` → on-disk uses `candidate_slots`
 *             brief said `search_window_start/end` → absent from keyset in YAML
 *             schema; present as top-level YAML fields but not in the
 *             structuredContent contract the handler exposes (handler derives
 *             them from the YAML only at suggest_time call time).
 *   respond:  brief said `organizer` (singular) → on-disk uses
 *             `organizer_name` + `organizer_email` (two fields)
 *             brief said `prep_bullets` → on-disk uses `prep_summary` + `prep_signals`
 *             brief said `event_url` → on-disk uses `source_link.url` (nested);
 *             not a top-level structuredContent key.
 *             brief said `conflicts` → compose-payload.md documents this only
 *             for the risk class and notes it is NOT a field in `## Respond
 *             payload`; excluded from keyset assertions.
 */

import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// View module path (relative to view-tool root)
// ---------------------------------------------------------------------------

const VIEW_MODULE_PATH = join(__dirname, "..", "src/agntux-google-calendar-view.ts");

// ---------------------------------------------------------------------------
// In-memory fixture bodies
// ---------------------------------------------------------------------------

/**
 * Minimal Schedule payload action file body.
 * YAML schema derived verbatim from schedule-payload.md §On-disk schema.
 * Field names are stable contracts; do not rename.
 */
const SCHEDULE_ACTION_BODY = `---
id: test-schedule-action
type: action
---

## Schedule payload

\`\`\`yaml
draft_summary: "Sync with Alice on ProjectX rollout"
draft_description: |
  Agenda: review rollout timeline and assign owners.
attendee_emails:
  - "alice@example.com"
  - "bob@example.com"
duration_minutes: 30
search_window_start: "2026-06-03T00:00:00-06:00"
search_window_end: "2026-06-10T23:59:59-06:00"
preferred_hours:
  start: "09:00"
  end: "17:00"
  exclude_weekends: true
candidate_slots: []
include_google_meet: true
user_timezone: "America/Denver"
user_primary_calendar_id: "primary"
personalization_signals:
  - "Last met with Alice 12 days ago about ProjectX deployment."
source_link:
  label: "Follow-up: ProjectX rollout planning"
  url: "https://calendar.google.com/calendar/event?eid=abc123"
\`\`\`
`;

/**
 * Minimal Respond payload action file body.
 * YAML schema derived verbatim from respond-payload.md §On-disk schema.
 * Field names are stable contracts; do not rename.
 */
const RESPOND_ACTION_BODY = `---
id: test-respond-action
type: action
---

## Respond payload

\`\`\`yaml
event_id: "abc123def456_20260605T140000Z"
calendar_id: "primary"
event_summary: "Q2 Business Review"
event_start: "2026-06-05T10:00:00-06:00"
event_end: "2026-06-05T11:00:00-06:00"
event_timezone: "America/Denver"
event_location: "Conference Room B"
event_meet_url: "https://meet.google.com/xyz-abcd-efg"
event_description_excerpt: "Quarterly review of business metrics and priorities."
organizer_name: "Alice Doe"
organizer_email: "alice@example.com"
attendees:
  - name: "Bob Smith"
    email: "bob@example.com"
    response_status: "accepted"
  - name: "Carol Jones"
    email: "carol@example.com"
    response_status: "tentative"
current_response_status: "needsAction"
prep_summary: |
  Alice leads the Q2 review. Last related thread (Slack, May 28) flagged a
  revenue shortfall on tier-2 accounts.
prep_signals:
  - label: "Slack: acme-tier2 thread"
    href: "sources/slack/threads/2026-05-28-acme-tier2.md"
personalization_signals:
  - "Alice is in your Important people list"
  - "working hours applied"
source_link:
  label: "Q2 Business Review"
  url: "https://www.google.com/calendar/event?eid=abc123def456"
\`\`\`
`;

// ---------------------------------------------------------------------------
// Stub ViewToolContext factory
// ---------------------------------------------------------------------------

function makeCtx(body: string) {
  return {
    fs: {
      readFile: vi.fn().mockResolvedValue(Buffer.from(body, "utf-8")),
    },
  };
}

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

type ViewToolEntry = {
  descriptor: {
    name: string;
    outputSchema?: { required?: string[] };
    inputSchema?: {
      required?: string[];
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
  };
  handle: (
    args: Record<string, unknown>,
    ctx: ReturnType<typeof makeCtx>,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    structuredContent: Record<string, unknown>;
  }>;
};

type ViewMod = { viewTools: ViewToolEntry[] };

// ---------------------------------------------------------------------------
// Schedule handler — agntux_google_calendar_schedule_view
// ---------------------------------------------------------------------------

describe("agntux_google_calendar_schedule_view — structuredContent shape", () => {
  it("view module exports the schedule view tool", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    );
    expect(schedule).toBeDefined();
  });

  it("handle() returns structuredContent with draft_summary from the YAML block", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const ctx = makeCtx(SCHEDULE_ACTION_BODY);
    const result = await schedule.handle({ action_id: "test-schedule-action" }, ctx);

    const sc = result.structuredContent;
    // draft_summary is the on-disk field name per schedule-payload.md
    // (brief said draft_title — adjusted to draft_summary from file).
    expect(sc).toHaveProperty("draft_summary");
    expect(sc.draft_summary).toBe("Sync with Alice on ProjectX rollout");
  });

  it("handle() returns candidate_slots as an array", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const ctx = makeCtx(SCHEDULE_ACTION_BODY);
    const result = await schedule.handle({ action_id: "test-schedule-action" }, ctx);
    const sc = result.structuredContent;

    // candidate_slots is the on-disk field name per schedule-payload.md
    // (brief said suggested_slots — adjusted to candidate_slots from file).
    expect(sc).toHaveProperty("candidate_slots");
    expect(Array.isArray(sc.candidate_slots)).toBe(true);
  });

  it("handle() returns attendee_emails as an array", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const ctx = makeCtx(SCHEDULE_ACTION_BODY);
    const result = await schedule.handle({ action_id: "test-schedule-action" }, ctx);
    const sc = result.structuredContent;

    // attendee_emails per schedule-payload.md (brief said draft_attendees).
    expect(sc).toHaveProperty("attendee_emails");
    expect(Array.isArray(sc.attendee_emails)).toBe(true);
    expect((sc.attendee_emails as string[]).length).toBeGreaterThan(0);
  });

  it("handle() returns user_timezone as a string", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const ctx = makeCtx(SCHEDULE_ACTION_BODY);
    const result = await schedule.handle({ action_id: "test-schedule-action" }, ctx);
    const sc = result.structuredContent;

    expect(sc).toHaveProperty("user_timezone");
    expect(typeof sc.user_timezone).toBe("string");
    expect(sc.user_timezone).toBe("America/Denver");
  });

  it("handle() returns personalization_signals as an array", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const ctx = makeCtx(SCHEDULE_ACTION_BODY);
    const result = await schedule.handle({ action_id: "test-schedule-action" }, ctx);
    const sc = result.structuredContent;

    expect(sc).toHaveProperty("personalization_signals");
    expect(Array.isArray(sc.personalization_signals)).toBe(true);
  });

  it("handle() returns duration_minutes as a number", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const ctx = makeCtx(SCHEDULE_ACTION_BODY);
    const result = await schedule.handle({ action_id: "test-schedule-action" }, ctx);
    const sc = result.structuredContent;

    // duration_minutes per schedule-payload.md (brief said draft_duration_minutes).
    expect(sc).toHaveProperty("duration_minutes");
    expect(typeof sc.duration_minutes).toBe("number");
    expect(sc.duration_minutes).toBe(30);
  });

  it("action file with no ## Schedule payload section returns empty candidate_slots", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const bodyNoSection = `---\nid: no-section-action\ntype: action\n---\n\n## Why this is here\n\nSome text with no schedule payload.\n`;
    const ctx = makeCtx(bodyNoSection);
    const result = await schedule.handle({ action_id: "no-section-action" }, ctx);
    const sc = result.structuredContent;

    expect(Array.isArray(sc.candidate_slots)).toBe(true);
    expect((sc.candidate_slots as unknown[]).length).toBe(0);
  });

  it("structuredContent stays within 8 kB byte budget", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const ctx = makeCtx(SCHEDULE_ACTION_BODY);
    const result = await schedule.handle({ action_id: "test-schedule-action" }, ctx);
    const bytes = Buffer.byteLength(JSON.stringify(result.structuredContent), "utf-8");
    // 8 kB is a generous cap; a typical schedule payload is well under 2 kB.
    expect(bytes).toBeLessThan(8192);
  });

  // ── Dual-trigger: user-initiated (inline-args) path ─────────────────────────
  // The schedule view is reachable conversationally ("find a time to meet …")
  // with NO backing action file: the skill lane resolves attendees + window +
  // candidate slots and passes everything inline. The handler must build the
  // payload from inline args WITHOUT touching fs, and `action_id` may be absent.

  const INLINE_SCHEDULE_ARGS = {
    draft_summary: "Product roadmap sync",
    draft_description: "Agenda: Q3 roadmap priorities; align on owners.",
    attendee_emails: ["yousef@example.com", "dana@example.com"],
    duration_minutes: 45,
    search_window_start: "2026-06-09T00:00:00-06:00",
    search_window_end: "2026-06-13T23:59:59-06:00",
    candidate_slots: [
      {
        start: "2026-06-09T15:00:00-06:00",
        end: "2026-06-09T15:45:00-06:00",
        label: "Tue 3:00 PM",
      },
    ],
    include_google_meet: true,
    user_timezone: "America/Denver",
    personalization_signals: ["Last met with Dana 9 days ago about the roadmap."],
  };

  /** ctx whose fs.readFile throws if touched — proves the inline path never
   * reads disk (the EMPTY_PAYLOAD / action-file branch would). */
  function makeThrowingCtx() {
    return {
      fs: {
        readFile: vi
          .fn()
          .mockRejectedValue(new Error("fs must not be read on the inline path")),
      },
    };
  }

  it("inline args build a prefilled payload without reading fs (no action_id)", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const ctx = makeThrowingCtx();
    const result = await schedule.handle({ ...INLINE_SCHEDULE_ARGS }, ctx);
    const sc = result.structuredContent;

    expect(ctx.fs.readFile).not.toHaveBeenCalled();
    expect(sc.draft_summary).toBe("Product roadmap sync");
    expect(sc.attendee_emails).toEqual(["yousef@example.com", "dana@example.com"]);
    expect(sc.duration_minutes).toBe(45);
    expect(sc.user_timezone).toBe("America/Denver");
    expect(Array.isArray(sc.candidate_slots)).toBe(true);
    expect((sc.candidate_slots as unknown[]).length).toBe(1);
    // action_id absent → normalised to "" (never the string "undefined").
    expect(sc.action_id).toBe("");
    // Response envelope is present on the inline branch too (E29 / §3.1).
    expect(result.content[0].text).toContain("iframe");
  });

  it("inline candidate_slots survive into the payload prefilled (not []) ", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const ctx = makeThrowingCtx();
    const result = await schedule.handle({ ...INLINE_SCHEDULE_ARGS }, ctx);
    const slots = result.structuredContent.candidate_slots as Array<
      Record<string, unknown>
    >;
    expect(slots[0]).toMatchObject({
      start: "2026-06-09T15:00:00-06:00",
      end: "2026-06-09T15:45:00-06:00",
    });
  });

  it("inline path stays within the 8 kB byte budget", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const ctx = makeThrowingCtx();
    const result = await schedule.handle({ ...INLINE_SCHEDULE_ARGS }, ctx);
    const bytes = Buffer.byteLength(
      JSON.stringify(result.structuredContent),
      "utf-8",
    );
    expect(bytes).toBeLessThan(8192);
  });

  it("empty args ({}) render the empty placeholder payload (cold render)", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    // No inline fields, no action_id, fs untouched: the render-harness cold
    // path must degrade to placeholders, never build actions/undefined.md.
    const ctx = makeThrowingCtx();
    const result = await schedule.handle({}, ctx);
    const sc = result.structuredContent;

    expect(ctx.fs.readFile).not.toHaveBeenCalled();
    expect(sc.action_id).toBe("");
    expect(sc.draft_summary).toBe("");
    expect(Array.isArray(sc.candidate_slots)).toBe(true);
    expect((sc.candidate_slots as unknown[]).length).toBe(0);
  });

  it("descriptor inputSchema no longer requires action_id (dual-trigger)", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;
    const inputSchema = schedule.descriptor.inputSchema as {
      required?: string[];
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
    // action_id is optional now; inline scheduling fields are accepted.
    expect(inputSchema.required ?? []).not.toContain("action_id");
    expect(inputSchema.additionalProperties).toBe(true);
    expect(inputSchema.properties).toHaveProperty("attendee_emails");
    expect(inputSchema.properties).toHaveProperty("candidate_slots");
  });

  it("inline fields win over a co-present action_id (precedence: inline → disk → empty)", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    // Both an action_id AND an inline field are present. The load-bearing rule
    // is "inline wins unconditionally" — the fs must NOT be read, and action_id
    // is echoed back but the payload comes from the inline args. A branch
    // reorder that read disk first would break the cross-plugin handoff.
    const ctx = makeThrowingCtx();
    const result = await schedule.handle(
      { action_id: "should-be-ignored", draft_summary: "Inline wins" },
      ctx,
    );
    const sc = result.structuredContent;

    expect(ctx.fs.readFile).not.toHaveBeenCalled();
    expect(sc.draft_summary).toBe("Inline wins");
    expect(sc.action_id).toBe("should-be-ignored");
  });

  it("inline preferred_hours round-trips (exclude_weekends:false not defaulted true)", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const ctx = makeThrowingCtx();
    const result = await schedule.handle(
      {
        ...INLINE_SCHEDULE_ARGS,
        preferred_hours: { start: "08:00", end: "16:00", exclude_weekends: false },
      },
      ctx,
    );
    const ph = result.structuredContent.preferred_hours as Record<string, unknown>;
    expect(ph.start).toBe("08:00");
    expect(ph.end).toBe("16:00");
    // The explicit `false` must survive — a `||`-style default would clobber it to true.
    expect(ph.exclude_weekends).toBe(false);
  });

  it("inline malformed candidate_slots pass through without throwing (validated downstream)", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    // The handler passes candidate_slots through asUnknownArray verbatim;
    // per-element validation lives in ScheduleApp.tsx. Garbage entries must
    // neither throw nor be silently dropped at the handler boundary.
    const ctx = makeThrowingCtx();
    const result = await schedule.handle(
      { candidate_slots: [null, 42, { start: "a" }] as unknown[] },
      ctx,
    );
    const slots = result.structuredContent.candidate_slots as unknown[];
    expect(Array.isArray(slots)).toBe(true);
    expect(slots.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Respond handler — agntux_google_calendar_respond_view
// ---------------------------------------------------------------------------

describe("agntux_google_calendar_respond_view — structuredContent shape", () => {
  it("view module exports the respond view tool", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const respond = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_respond_view",
    );
    expect(respond).toBeDefined();
  });

  it("handle() returns event_id and event_summary from the YAML block", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const respond = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_respond_view",
    )!;

    const ctx = makeCtx(RESPOND_ACTION_BODY);
    const result = await respond.handle({ action_id: "test-respond-action" }, ctx);
    const sc = result.structuredContent;

    // event_id and event_summary: verbatim field names from respond-payload.md.
    expect(sc).toHaveProperty("event_id");
    expect(sc.event_id).toBe("abc123def456_20260605T140000Z");
    // event_summary per respond-payload.md (compose-payload.md confirms:
    // "maps to event.summary — canonical field name in the ## Respond payload").
    expect(sc).toHaveProperty("event_summary");
    expect(sc.event_summary).toBe("Q2 Business Review");
  });

  it("handle() returns calendar_id", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const respond = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_respond_view",
    )!;

    const ctx = makeCtx(RESPOND_ACTION_BODY);
    const result = await respond.handle({ action_id: "test-respond-action" }, ctx);
    const sc = result.structuredContent;

    expect(sc).toHaveProperty("calendar_id");
    expect(sc.calendar_id).toBe("primary");
  });

  it("handle() returns event_meet_url from the YAML block", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const respond = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_respond_view",
    )!;

    const ctx = makeCtx(RESPOND_ACTION_BODY);
    const result = await respond.handle({ action_id: "test-respond-action" }, ctx);
    const sc = result.structuredContent;

    // event_meet_url per respond-payload.md (brief said event_video_url
    // as a possible alternate; on-disk uses event_meet_url).
    expect(sc).toHaveProperty("event_meet_url");
    expect(sc.event_meet_url).toBe("https://meet.google.com/xyz-abcd-efg");
  });

  it("handle() returns organizer_name and organizer_email", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const respond = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_respond_view",
    )!;

    const ctx = makeCtx(RESPOND_ACTION_BODY);
    const result = await respond.handle({ action_id: "test-respond-action" }, ctx);
    const sc = result.structuredContent;

    // on-disk uses organizer_name + organizer_email (two fields);
    // brief said `organizer` (singular) — adjusted from on-disk content.
    expect(sc).toHaveProperty("organizer_name");
    expect(sc.organizer_name).toBe("Alice Doe");
    expect(sc).toHaveProperty("organizer_email");
    expect(sc.organizer_email).toBe("alice@example.com");
  });

  it("handle() returns attendees as an array with response_status entries", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const respond = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_respond_view",
    )!;

    const ctx = makeCtx(RESPOND_ACTION_BODY);
    const result = await respond.handle({ action_id: "test-respond-action" }, ctx);
    const sc = result.structuredContent;

    expect(sc).toHaveProperty("attendees");
    expect(Array.isArray(sc.attendees)).toBe(true);
    const attendees = sc.attendees as Array<Record<string, unknown>>;
    expect(attendees.length).toBeGreaterThan(0);
    const first = attendees[0];
    // Field names per respond-payload.md attendees[] schema: name, email, response_status.
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("email");
    expect(first).toHaveProperty("response_status");
  });

  it("handle() returns current_response_status", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const respond = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_respond_view",
    )!;

    const ctx = makeCtx(RESPOND_ACTION_BODY);
    const result = await respond.handle({ action_id: "test-respond-action" }, ctx);
    const sc = result.structuredContent;

    expect(sc).toHaveProperty("current_response_status");
    expect(sc.current_response_status).toBe("needsAction");
  });

  it("handle() returns prep_summary as a string", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const respond = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_respond_view",
    )!;

    const ctx = makeCtx(RESPOND_ACTION_BODY);
    const result = await respond.handle({ action_id: "test-respond-action" }, ctx);
    const sc = result.structuredContent;

    // prep_summary per respond-payload.md (brief said prep_bullets — on-disk
    // uses prep_summary (string) + prep_signals (array of {label,href})).
    expect(sc).toHaveProperty("prep_summary");
    expect(typeof sc.prep_summary).toBe("string");
  });

  it("handle() returns personalization_signals as an array", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const respond = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_respond_view",
    )!;

    const ctx = makeCtx(RESPOND_ACTION_BODY);
    const result = await respond.handle({ action_id: "test-respond-action" }, ctx);
    const sc = result.structuredContent;

    expect(sc).toHaveProperty("personalization_signals");
    expect(Array.isArray(sc.personalization_signals)).toBe(true);
  });

  it("action file with no ## Respond payload section defaults current_response_status to needsAction", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const respond = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_respond_view",
    )!;

    // Body with no ## Respond payload section — handler must return empty-payload fallback.
    const bodyNoSection = `---\nid: no-respond-section\ntype: action\n---\n\n## Why this is here\n\nSome text with no respond payload section.\n`;
    const ctx = makeCtx(bodyNoSection);
    const result = await respond.handle({ action_id: "no-respond-section" }, ctx);
    const sc = result.structuredContent;

    // Handler returns a safe default when the section is absent.
    expect(sc.current_response_status).toBe("needsAction");
  });

  it("structuredContent stays within 16 kB byte budget", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const respond = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_respond_view",
    )!;

    const ctx = makeCtx(RESPOND_ACTION_BODY);
    const result = await respond.handle({ action_id: "test-respond-action" }, ctx);
    const bytes = Buffer.byteLength(JSON.stringify(result.structuredContent), "utf-8");
    // 16 kB is a generous cap; the respond payload including prep_summary is
    // typically under 4 kB (compose-payload.md documents the 280-char
    // event_description_excerpt cap and the 5-entry prep_signals cap).
    expect(bytes).toBeLessThan(16384);
  });
});

// ---------------------------------------------------------------------------
// Descriptor outputSchema — keyset alignment (both tools)
// ---------------------------------------------------------------------------

describe("descriptor outputSchema — required keyset alignment", () => {
  it("schedule descriptor outputSchema.required covers draft_summary, candidate_slots, attendee_emails, duration_minutes", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const schedule = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_schedule_view",
    )!;

    const schema = schedule.descriptor.outputSchema;
    expect(schema).toBeDefined();
    const required: string[] = schema?.required ?? [];
    // Each of these is a stable, on-disk contract field from schedule-payload.md.
    for (const key of ["draft_summary", "candidate_slots", "attendee_emails", "duration_minutes", "user_timezone"]) {
      expect(required, `outputSchema.required should include "${key}"`).toContain(key);
    }
  });

  it("respond descriptor outputSchema.required covers event_id, event_summary, current_response_status, attendees", async () => {
    const mod = await import(VIEW_MODULE_PATH);
    const viewMod = mod.default as ViewMod;
    const respond = viewMod.viewTools.find(
      (t) => t.descriptor.name === "agntux_google_calendar_respond_view",
    )!;

    const schema = respond.descriptor.outputSchema;
    expect(schema).toBeDefined();
    const required: string[] = schema?.required ?? [];
    // Each of these is a stable, on-disk contract field from respond-payload.md.
    for (const key of ["event_id", "event_summary", "current_response_status", "attendees", "calendar_id"]) {
      expect(required, `outputSchema.required should include "${key}"`).toContain(key);
    }
  });
});
