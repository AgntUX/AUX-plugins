---
type: plugin-instructions
plugin: agntux-calendly
schema_version: "1.0.0"
updated_at: 2026-06-21T00:00:00Z
authored_by: personalization
status: draft
---

# Always raise

- Meetings starting within 48 hours (`start_time` within 48 h of now)
  where the invitee list has not been reviewed: raise a `deadline`
  action regardless of meeting size or event-type category.
  (source: 2026-06-21 canonical Calendly upcoming-meeting handling)

- Inbound routing-form submissions (`calendly:routing-submission:*`):
  always raise a `response-needed` action. Every submission represents
  an active lead who booked through a qualifying-questions intake form.
  (source: 2026-06-21 canonical Calendly routing-form handling)

- No-show invitees (`no_show: true` on one or more invitees for a past
  active meeting): always raise a follow-up action. A no-show without
  a follow-up action leaves the invitee relationship unresolved.
  (source: 2026-06-21 canonical Calendly no-show handling)

# Never raise

- Meetings that were already cancelled by the same connected account
  (i.e. the host user is the canceller, not an invitee): the
  cancellation is intentional; no follow-up action is needed.

- Routine recurring-meeting instances where the prior instance already
  has an open or recently-resolved action and the invitee list,
  location, and duration are unchanged. Update the existing entity body
  instead of raising a new action item.

- Event types that are marked `active: false` in the catalog: they are
  archived and produce no bookings.

# Rewrites

(None defined in initial stub. User-feedback Mode A may add label
rewrites here, e.g. event-type name aliases or invitee-display-name
normalisation rules.)

# Notes

## Write-back handler summary

Three iframe handlers are authorised write surfaces. Each handler's
Send/Confirm button is the authorisation gate — no operation executes
without that click. Do not pre-execute or simulate any of these
write-back actions in chat.

1. **Cancel meeting** — calls `meetings-cancel_event` with the selected
   `event_uri` and a user-authored cancellation reason. The cancellation
   is visible to the invitee immediately via Calendly's notification
   system. Raise the action's status to `done` after a successful
   cancel.

2. **Mark no-show** — calls `meetings-create_invitee_no_show` once per
   selected invitee URI. The invitee's `no_show` flag is set on
   Calendly's side. Raise the action's status to `done` after all
   selected invitees are marked.

3. **Generate single-use scheduling link** — calls
   `scheduling_links-create_single_use_scheduling_link` with
   `max_event_count: 1`, the selected `event_type_uri` as `owner`, and
   `owner_type: EventType`. The host extracts `booking_url` from the
   response and shares it in chat. This is a two-step envelope; the
   component cannot precompute the URL — only the host has it after
   step 1 succeeds. Raise the action's status to `done` after the link
   is shared.

## Compose payload sections

These handlers are user-initiated (ad-hoc trigger mode): the host skill
lane resolves meeting details via Calendly read tools and passes them
inline when opening the view. No `## Compose payload` body section is
written to the action file at ingest time for these handlers. The view
tools degrade gracefully to a placeholder when neither inline args nor a
readable action file are present.

The `## Compose payload` body section IS written for ingest-side triage
actions (new bookings, upcoming meetings, no-show follow-ups) — the
section carries meeting context that the skill lane uses to pre-fill
the iframe. See `_overrides/reference/fetch.md` for the per-signal-type
body shapes.

## Tone

Terse and factual. Calendly actions are scheduling logistics — use
direct language without filler phrases. Surface the meeting name,
invitee names, and start time in every action context so the user can
identify the meeting at a glance without opening Calendly. For cancel
and no-show actions, surface the original meeting time even when it is
in the past.

## Deduplication

Source IDs are namespaced by signal type:
- `calendly:booking:{event_uuid}` — new booking
- `calendly:upcoming:{event_uuid}` — upcoming-meeting deadline
- `calendly:canceled:{event_uuid}` — cancellation
- `calendly:no-show:{event_uuid}` — no-show follow-up
- `calendly:routing-submission:{submission_uuid}` — inbound lead

The same `event_uuid` can produce at most one open action per namespace
simultaneously. A booking action and a no-show follow-up for the same
event are separate items and do not conflict.
