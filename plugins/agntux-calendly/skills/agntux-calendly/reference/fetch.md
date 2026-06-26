# Calendly fetch — Step 5 orchestration

Wholesale override for `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
Calendly uses a three-phase shape: seed catalog resources once per run (Step 5a),
page through scheduled events in the cursor window and expand invitees per event
(Step 5b), then page through routing-form submissions since the cursor (Step 5c).
Action items are raised for new bookings, cancellations, no-show follow-ups, and
inbound routing leads. Person entities are created from invitees; event-type
entities are seeded from the catalog phase.

## Step 5 — Fetch from Calendly

Call the tools listed below using the host-resolved names. The host UUID-prefixes
them at runtime (e.g. `mcp__<uuid>__list_scheduled_events`); call them by
whatever name the host exposes. All tools are read-only — do NOT call any write
or scheduling tool during ingest.

All cursors are read from `data/learnings/agntux-calendly/sync.md → cursor`
at Step 2. The cursor is a JSON object; parse it at Step 2 and keep
`events_updated_at` and `routing_submissions_since` in scope for Step 5.
Bootstrap state: `cursor: null` (treat both keys as null).

Do NOT hard-code any organisation slug, user URI, specific event-type name, or
scheduling URL — all organisation identity is resolved at runtime from
`user.md` or from the first Calendly API response that carries the organisation
URI. This fetch shape is general-purpose for any Calendly user.

---

### Step 5a — Seed catalog resources

Call these tools once per run. They are low-volume and return complete snapshots.
Results stay in working memory for the rest of the run.

**Event types:**

```
list_event_types({
  organization: <org_uri>,          # from user.md or resolved at Step 1 preflight
  active: true                      # skip inactive/archived types unless user.md requests them
})
```

Page until all active event types are returned (typically < 50; cap at 100 per
run). For each event type, create or update a reference entity:

- Entity subtype: `event-type`
- Source ID: `calendly:event-type:{event_type.uri_slug_or_uuid}`
- Key fields: `name`, `duration_minutes`, `scheduling_url`, `active`

Reference entities are written at Step 7 but do NOT produce action items.
They serve as lookup context when entity-matching invitees to bookings.

**Organisation members (person seeding):**

```
list_organization_memberships({
  organization: <org_uri>
})
```

For each member, upsert a person entity (`email`, `name`) using the
lookup-before-write protocol at Step 6. Members are internal team; mark the
entity body with `role: member` to distinguish from external invitees. This
call ensures internal meeting participants appear in the entity store without
waiting for them to book as an external invitee.

---

### Step 5b — Fetch scheduled events and expand invitees

This is the primary action-signal surface.

**Incremental fetch (cursor.events_updated_at non-null):**

Calendly's `list_scheduled_events` does not expose a server-side `updated_at`
filter. Use a rolling time window: set `min_start_time` to `now − 7 days`
(anchored to the run's `now` timestamp, NOT to `cursor.events_updated_at − 7
days` — anchoring to the cursor risks missing reschedules and cancellations
whose start_time moved after the prior run). Set `max_start_time` to
`now + 60 days` (upcoming meetings within a 60-day forward horizon).

```
list_scheduled_events({
  organization: <org_uri>,
  min_start_time: <ISO-8601 UTC>,   # rolling lookback — see above
  max_start_time: <ISO-8601 UTC>,   # now + 60 days
  count: 100,
  sort: "start_time:asc",
  status: "active"                  # fetch active events first; see cancellations below
})
```

After the active pass, repeat with `status: "canceled"` using the same time
window to capture cancellations that occurred since the last run.

**Client-side incremental filter.** For both passes, keep only events where
`updated_at > cursor.events_updated_at`. Events that fall in the rolling window
but predate the cursor are already processed; skip them.

**Bootstrap fetch (cursor null OR events_updated_at absent):**

```
list_scheduled_events({
  organization: <org_uri>,
  min_start_time: <ISO-8601 UTC of (now − bootstrap_window_days days)>,
  max_start_time: <ISO-8601 UTC of (now + 60 days)>,
  count: 100,
  sort: "start_time:asc"
  # no status filter — fetch all statuses on bootstrap
})
```

Default `bootstrap_window_days` is **30** (declared in `frontmatter.yaml`;
user-overridable via `user.md → bootstrap_window_days`).

**Pagination.** Continue paging while the response carries a `next_page` or
`next_page_token`. Cap at **150 events per run** across both status passes
combined. If the cap is reached, log `calendly-pagination-overflow` (kind:
`source`) with the count of deferred events, stop paging, and proceed to
Step 5c with events collected so far. Do NOT advance the cursor for events
beyond the cap — Step 11's transactional rule keeps `cursor.events_updated_at`
at its pre-run value when writes fail; the cap forces a natural advance on
the next run.

**Per-event detail fetch (selective).**

The list result carries `start_time`, `end_time`, `status`, `event_type` URI,
`location` (type + details), `name` (meeting title), and `updated_at`. This is
sufficient to triage most events. Call `get_scheduled_event` only when:

- The event is flagged as action-worthy (new booking or upcoming meeting) AND
  the location type requires richer detail (e.g., a custom location needing
  join-link resolution).
- The event has been recently updated AND you need to confirm the new time
  or status before writing to the action item.

```
get_scheduled_event({ uuid: <event_uuid> })
```

If `get_scheduled_event` returns 404 (event deleted or purged), log
`calendly-event-not-found` (kind: `source`) with the UUID, skip this event,
and continue. Do NOT abort the run.

**Per-event invitee fetch.**

For every event that passes the triage signals in Step 5b triage (below),
expand its invitees:

```
list_event_invitees({
  uuid: <event_uuid>,
  count: 100,
  sort: "created_at:asc"
})
```

Page until all invitees are collected (cap at 50 invitees per event; surface
the first 50 when an event has more). Key invitee fields: `name`, `email`,
`timezone`, `status` (`active` | `canceled`), `questions_and_answers` (booking
question responses), `no_show` (boolean flag set by the host after the meeting).

**Invitee display-name normalization.** Calendly stores names exactly as the
booker typed them, so they arrive with inconsistent casing. When composing a
person entity from an invitee, apply the following rule to the `name` field
before writing the entity's display name / title:

- If the raw name is entirely lowercase (e.g. `"trish"`) or entirely uppercase
  (e.g. `"JOHN SMITH"`), apply title-case (first letter of each word
  uppercased, remainder lowercased).
- If the raw name already contains mixed case, preserve it verbatim — do NOT
  alter intentional casing (e.g. `"danah boyd"` is mixed: no change).
- Store the original raw name as an additional alias on the entity so that
  search still matches what the booker originally typed.
- The entity's `source_id` remains the invitee email address, unchanged.

This rule applies to every invitee regardless of which event type, booking
page, or organisation they booked through.

If `list_event_invitees` fails for a specific event, log
`calendly-invitees-unavailable` (kind: `source`) with the event UUID, skip
invitee expansion for that event, and continue. Still raise the event-level
action item with whatever data the list result provided — do not drop the
event entirely.

**Step 5b triage signals.** Evaluate each scheduled event for the following
conditions. An event may satisfy more than one:

1. **New booking** (`status: active`, `created_at > cursor.events_updated_at` or
   bootstrap): a meeting was booked since the last run. Action class:
   `response-needed` (prep/awareness). Raise one action item per event.

   **Host-as-invitee guard.** Before raising a new-booking action, compare
   each invitee's email against the connected account owner's email (resolved
   from `users-get_current_user` in Step 5a; this is the host, not the
   external booker). If the ONLY active invitee on the event is the host
   themselves, do NOT raise a `response-needed` action — the host is blocking
   their own time or self-testing, not receiving an inbound booking. Still
   create or update the `scheduled-event` entity normally (the meeting record
   is real). If there is at least one active invitee whose email does NOT match
   the host's email, raise the action as usual — the host-as-invitee suppression
   applies only when no external invitee is present.

2. **Upcoming meeting** (`status: active`, `start_time` is within the next 48
   hours as of `now`): an imminent meeting the user should be aware of. Action
   class: `deadline`. Raise only when the event has not already generated an
   open deadline action item with the same `source_id` (dedup at Step 9).

3. **Cancellation** (`status: canceled`, `updated_at > cursor.events_updated_at`
   or bootstrap): a previously booked meeting was canceled. Action class:
   `other`. Include the canceler's name/email if determinable from invitee status.

4. **No-show invitee** (`status: active` meeting in the past, `no_show: true`
   on one or more invitees): one or more invitees did not attend. Action class:
   `other`. Raise a follow-up action item. Group all no-show invitees for the
   same event into a single action item.

Meetings with `status: active` that are more than 48 hours in the future and
were processed in a prior run (dedup check at Step 9 finds an existing open
action) do NOT produce new action items. Update the entity body with any
changed fields (reschedule, new invitees) but leave the existing action open.

---

### Step 5c — Fetch routing-form submissions

Routing-form submissions represent inbound leads who filled in a scheduling
intake form. Each submission is an independent action signal.

**Calendly's `list_routing_form_submissions` requires a form UUID or URI.** If
the user's organisation uses routing forms, the form URIs must be resolvable.
Attempt to discover available routing forms from the organisation context. If
no routing forms are available or discoverable for the connected organisation,
skip Step 5c silently for this run — do NOT log an error; routing forms are an
optional Calendly feature.

**Incremental fetch (cursor.routing_submissions_since non-null):**

```
list_routing_form_submissions({
  form: <routing_form_uri>,
  # pass the cursor as a min-time boundary if the tool supports it;
  # otherwise fetch all and client-filter by created_at
  count: 100,
  sort: "created_at:asc"
})
```

Client-side filter: keep only submissions where
`created_at > cursor.routing_submissions_since`.

**Bootstrap fetch (cursor.routing_submissions_since null):**

Fetch all submissions and client-filter by
`created_at >= (now − bootstrap_window_days)`.

**Pagination.** Page while `next_page` / `next_page_token` is present. Cap at
**100 submissions per run**. If the cap is reached, log
`calendly-pagination-overflow` (kind: `source`) with the count deferred.

**Routing-submission triage.** Every new routing-form submission is
action-worthy as an inbound lead. Action class: `response-needed`. Include:

- Submitter name and email (from submission fields).
- Routing outcome (which event type or queue the submission was routed to),
  if present in the submission payload.
- Up to 5 of the most informative question–answer pairs from the submission
  (longest non-empty answers first; omit blank responses).

Source ID: `calendly:routing-submission:{submission.uuid}`

If `list_routing_form_submissions` fails with a 404 for a specific form URI,
log `calendly-routing-form-not-found` (kind: `source`) with the form URI and
skip that form. Continue with any remaining form URIs.

---

### Step 5 summary — on fetch failure

On any failure from any Calendly tool call:

- Log to `data/learnings/agntux-calendly/sync.md → errors` with kind
  `network | auth | parse | source | internal` (or the calendly-specific
  extension from the permitted-error-kinds list in `frontmatter.yaml`).
- Slice the errors list to the last 10 entries (newest-first) before writing.
- **Auth failure (401 / 403):** release the lock and exit. Do NOT proceed —
  all subsequent calls will fail identically.
- **Rate limit (429 / `calendly-rate-limited`):** log, stop fetching, release
  lock, exit. Step 11's transactional rule keeps the cursor at its pre-run value.
- **Network failure:** log (kind: `network`), release lock, exit.
- **Per-event 404 (`calendly-event-not-found`):** log with UUID, skip that
  event, and continue. Do NOT abort the run.
- **Per-event invitee failure (`calendly-invitees-unavailable`):** log with event
  UUID, skip invitee expansion for that event, still raise the event-level action
  with list-level data, and continue.
- **Routing form 404 (`calendly-routing-form-not-found`):** log with form URI,
  skip that form, and continue.
- **Pagination overflow (`calendly-pagination-overflow`):** log deferred count,
  continue to action writes for items already collected. Step 11 advances the
  cursor to the newest item processed, not the newest item in the window.
- **Cursor JSON malformed (`calendly-cursor-malformed`):** log (kind: `parse`),
  treat both cursor keys as null (fall back to bootstrap window), and continue.

---

## Cursor shape for Calendly

The cursor is a JSON object serialised as a single-line string on the
`sync.md → cursor` key:

```yaml
# data/learnings/agntux-calendly/sync.md — bootstrap state
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
```

```yaml
# After the first successful run
cursor: '{"events_updated_at":"2026-06-21T10:00:00Z","routing_submissions_since":"2026-06-21T09:45:00Z"}'
```

| Key | Type | Meaning |
|---|---|---|
| `events_updated_at` | ISO-8601 UTC | Newest `updated_at` seen across all scheduled events processed this run. Anchors the rolling lookback window on the next run. |
| `routing_submissions_since` | ISO-8601 UTC | Newest `created_at` seen across all routing-form submissions processed this run. Drives the min-time boundary for the next routing-form fetch. |

Parse the cursor JSON at Step 2. If `cursor` is null (bootstrap) or unparseable,
log `calendly-cursor-malformed` (kind: `parse`) and treat both keys as null
(fall back to bootstrap window). Write the updated cursor JSON at Step 11.

**Advance rules (Step 11 transactional rule):**

- Advance `events_updated_at` to `max(updated_at)` across all scheduled events
  successfully processed this run (both active and canceled passes). Advance
  only when every action write in the run has succeeded.
- Advance `routing_submissions_since` to `max(created_at)` across all routing
  submissions successfully processed this run. Advance only when every action
  write in the run has succeeded.
- If the run exits early (auth, network, rate-limit, or any write failure),
  leave both cursor keys at their pre-run values.

---

## Entity subtype mapping table

| Calendly resource | Entity subtype | Plain-language label |
|---|---|---|
| Invitee / booking participant | `person` (source_id: invitee email address, NOT invitee UUID — a returning booker gets a new UUID each booking but the same email) | "person" |
| Scheduled meeting / event | `scheduled-event` | "meeting" |
| Event type (bookable meeting type) | `event-type` | "meeting type" |

`event-type` entities are reference-only (no action items). `person` entities
are created from invitees and org members (lookup-before-write at Step 6; never
create duplicates for the same email address). `scheduled-event` entities carry
the meeting title, start/end time, location, status, and a list of invitee
display names.

---

## Action item shapes by signal type

### New booking (response-needed)

```yaml
title: "New booking: {meeting_name} with {invitee_name}"
kind: response-needed
source_id: "calendly:booking:{event_uuid}"
suggested_actions:
  - label: "Prep for meeting"
    host_prompt: "Use the agntux-calendly plugin to open the meeting prep view for action {id}"
  - label: "Open in Calendly"
    url: "https://calendly.com/app/scheduled_events/{event_uuid}"
```

Body: include meeting start time (local timezone from `user.md`), duration,
event type name, invitee name(s) and email(s), any booking question answers, and
meeting location / join link if available.

### Upcoming meeting (deadline)

```yaml
title: "Meeting in <N> hours: {meeting_name}"
kind: deadline
source_id: "calendly:upcoming:{event_uuid}"
suggested_actions:
  - label: "Review booking details"
    host_prompt: "Use the agntux-calendly plugin to review the meeting details for action {id}"
  - label: "Open in Calendly"
    url: "https://calendly.com/app/scheduled_events/{event_uuid}"
```

Body: start time and timezone, invitee list, location / join link.

### Cancellation (other)

```yaml
title: "Cancellation: {meeting_name}"
kind: other
source_id: "calendly:canceled:{event_uuid}"
suggested_actions:
  - label: "Open in Calendly"
    url: "https://calendly.com/app/scheduled_events/{event_uuid}"
```

Body: original meeting time, who canceled (invitee name/email if determinable
from invitee status), cancellation timestamp (`updated_at`).

### No-show follow-up (other)

```yaml
title: "No-show: {invitee_name} did not attend {meeting_name}"
kind: other
source_id: "calendly:no-show:{event_uuid}"
suggested_actions:
  - label: "Follow up with invitee"
    host_prompt: "Use the agntux-calendly plugin to open the follow-up composer for action {id}"
  - label: "Open in Calendly"
    url: "https://calendly.com/app/scheduled_events/{event_uuid}"
```

Body: original meeting time, names/emails of no-show invitees, meeting type.
When multiple invitees from the same event are no-shows, group them into one
action item (single `source_id` per event).

### Inbound routing-form lead (response-needed)

```yaml
title: "New lead from routing form: {submitter_name or submitter_email}"
kind: response-needed
source_id: "calendly:routing-submission:{submission_uuid}"
suggested_actions:
  - label: "Open in Calendly"
    url: "https://calendly.com/app/routing_forms/{form_uuid}/submissions/{submission_uuid}"
```

Body: submitter name and email, routing outcome (event type routed to, if
known), up to 5 question–answer pairs from the submission (longest non-empty
answers first).

---

## Deduplication

Before raising any action item at Steps 8–9, look up the candidate `source_id`
in `_sources.json` and `actions/_index.md`:

- An existing **open** action with the same `source_id` means the item was
  already raised. Update the entity body with any changed fields (new invitee,
  rescheduled start time, updated location) but do NOT raise a new action.
- A **closed or dismissed** action with the same `source_id` may be re-raised
  ONLY if the underlying event has materially changed (e.g., a rescheduled
  event has a new `start_time`, or an invitee previously marked as active has
  become canceled). Substantive changes justify re-opening; a cosmetic field
  change does not.
- New `source_id` → create a new action item normally.

The `source_id` namespaces (`calendly:booking:`, `calendly:upcoming:`,
`calendly:canceled:`, `calendly:no-show:`, `calendly:routing-submission:`) are
distinct. The same `event_uuid` can produce at most one open action per
namespace simultaneously without conflict (e.g., a booking action and a
no-show follow-up for the same event are separate items).

---

## Failure modes

| Symptom | kind | Action |
|---|---|---|
| Auth failure (401 / 403) from any tool | `auth` | exit, release lock, retry next run |
| Network-level failure | `network` | exit, release lock, retry next run |
| Rate limit (429) from any tool | `source` + `calendly-rate-limited` | stop fetching, release lock, retry next run |
| `get_scheduled_event` returns 404 for a known UUID | `source` + `calendly-event-not-found` | log with UUID, skip event, continue |
| `list_event_invitees` fails for a specific event | `source` + `calendly-invitees-unavailable` | log with event UUID, skip invitee expansion, still raise event-level action, continue |
| `list_routing_form_submissions` returns 404 for a form URI | `source` + `calendly-routing-form-not-found` | log with form URI, skip that form, continue |
| Per-run event cap (150) reached | `source` + `calendly-pagination-overflow` | log deferred count, continue to writes for collected events; advance cursor only to newest processed |
| Per-run submission cap (100) reached | `source` + `calendly-pagination-overflow` | log deferred count, continue to writes; advance routing cursor only to newest processed |
| Cursor JSON malformed / not parseable | `parse` + `calendly-cursor-malformed` | treat both keys as null, fall back to bootstrap window, log, continue |
| Routing forms feature not in use | — | skip Step 5c silently; not an error |
