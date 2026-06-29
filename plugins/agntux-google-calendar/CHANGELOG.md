# Changelog

All notable changes to the agntux-google-calendar plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.3] — 2026-06-29

### Fixed

- **Finding a meeting time now reliably opens the interactive slot picker
  instead of replying with a plain-text list of times.** When the scheduling
  flow needed to look up free/busy times — both on an initial "schedule a
  meeting" request and when the user clicked "Find available times" inside the
  card — it asked Claude to "re-open the schedule view," but the wording was too
  soft, so Claude often answered in chat with the times as text and never
  re-rendered the picker. The hand-off now explicitly requires calling the
  `agntux_google_calendar_schedule_view` tool with the found times as
  `candidate_slots` and forbids presenting them as a text reply, so the user
  always gets a selectable slot picker.

## [0.7.2] — 2026-06-29

### Fixed

- **"Sources" links in the "Respond to invite" view are no longer dead.** Each
  prep-source entry rendered as a blue, underlined link (with a ↗ arrow) even
  when its target was a local filesystem path or was empty — neither of which a
  sandboxed iframe can open via `openLink()` — so clicking did nothing. The view
  now treats an entry as a clickable link only when its `href` is an openable
  web/mail URL (`https`, `http`, or `mailto`); every other entry renders as
  plain text with no link styling. The prep-signal guidance now requires ingest
  to emit openable source deep-links (Slack permalink, Gmail thread URL, event
  `htmlLink`) rather than filesystem paths.

## [0.7.1] — 2026-06-28

### Fixed

- **The "Respond to invite" view no longer shows "Untitled event" for a calendar
  invite that arrived by email.** When another plugin (e.g. agntux-gmail) had
  already raised an action for the emailed invite, the cross-source merge wrote
  the event details under a namespaced `## Compose payload (google-calendar)`
  body section — but the respond view only read the canonical `## Respond
  payload` header, so it received an empty envelope and rendered "Untitled
  event". The view now reads the namespaced header as a fallback (the canonical
  header still wins when both are present), and the ingest guidance now requires
  that namespaced section to carry the full event schema (title, time,
  organizer, attendees) rather than a sparse `event_id`-only block.

### Note

- An invite that was already merged onto another plugin's action file under the
  old sparse shape will pick up its title on the next `/agntux-google-calendar`
  sync — the title is recomposed at ingest, not recoverable from the existing
  sparse section alone.

## [0.7.0] — 2026-06-27

### Added

- Ingestion now pre-composes the view payload at ingest time for every action that opens a view (mandatory Step 10.1), so clicking a CTA surfaces pre-drafted content lifted from the action file instead of re-deriving it at click time.
- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content and regenerated draft — across all reason classes, not just response-needed.

## [0.6.0] — 2026-06-15

### Fixed

- **The respond view no longer shows "Untitled event" and the schedule view no
  longer renders blank.** The ingest skill now writes the `## Respond payload`
  and `## Schedule payload` body sections those views read (Step 10); they were
  previously never written, so the views received an empty envelope.
- **Suggested-action and cross-plugin prompts now use a natural-language
  description** (`Use the agntux-google-calendar plugin to …`) instead of a
  `/agntux-google-calendar …` slash command, which the host can't route when
  sent programmatically.

## [0.5.1] — 2026-06-09

### Changed

- Removed a contributor's personal name from the DCO signature file (now the
  AgntUX org identity).

## [0.5.0] — 2026-06-09

### Added

- A `/agntux-google-calendar` slash command to check your upcoming calendar
  on demand.

### Changed

- Plain-language pass on the tagline, description, listing copy, and README —
  led with what you get and dropped the internal jargon.

## [0.4.0] — 2026-06-08

### Fixed

- **Schedule and Send-response now actually work.** Clicking Schedule (or
  Send response) previously failed with `Tool not found:
  …__create_event`. The view was calling the Google Calendar connector by a
  hard-coded name that doesn't exist in your host — connector tool names differ
  per host. The Send button now hands the request to the assistant, which runs
  your Google Calendar connector to create the event / submit the RSVP. Same
  one-click authorisation; it just reaches the connector reliably now.
- **"Find available times" works the same way** — it now asks the assistant to
  recompute free/busy and re-open the scheduler pre-filled, instead of calling a
  connector tool the iframe can't reach.

## [0.3.0] — 2026-06-08

### Fixed

- **"Open in Google Calendar" (and "Join Google Meet" / prep "Sources") links
  now actually open.** They were plain links that a secure embedded view
  silently blocks, so clicking did nothing. They now open through the host so
  the page loads in your browser as expected.

### Changed

- **Scheduling now finds people in your AgntUX data reliably.** When you ask to
  "schedule a meeting with Dana and Yousef", the assistant now knows where your
  AgntUX project lives, connects to it if needed, looks people up in the right
  place (`entities/person/`, with a fallback to recent action items for an email
  address), and pre-fills attendees — instead of opening an empty form and
  asking you to type the addresses. Fixes a wrong internal path that pointed the
  lookup at a folder that doesn't exist.

## [0.2.0] — 2026-06-08

### Added

- **User-initiated scheduling.** You can now ask conversationally — "find a
  time to meet next week with Alice and Bob about the roadmap" — and the
  scheduling view opens **pre-populated** with the meeting title, attendees,
  and candidate time slots where everyone is free. Pick a slot and click
  Schedule. Previously the schedule view only opened from a pre-existing
  action item, so ad-hoc requests fell through to a plain-chat answer.
- **`schedule` command lane.** `/agntux-google-calendar schedule …` (and
  natural "find a time / set up a meeting / book time" phrasing) routes to the
  new scheduling lane. The lane only reads (`suggest_time`); the event is
  created solely when you click Schedule in the iframe.

### Changed

- **`agntux_google_calendar_schedule_view` is now dual-trigger.** The handler
  resolves its payload inline → on-disk action file → empty. The tool
  description leads with the user-initiated trigger so the host selects the
  view for conversational requests, and the input schema accepts the inline
  scheduling fields (`action_id` is no longer required).
- **Field-name reconciliation.** The cross-plugin schedule handoff
  (`reference/cross-plugin.md`) now uses the handler's field names
  (`draft_summary`, `attendee_emails`, `candidate_slots`,
  `user_primary_calendar_id`) so a Slack/Gmail "Schedule a meeting" handoff
  maps onto the same inline path. No on-disk schema change.

## [0.1.1] — 2026-06-03

### Fixed

- Added missing keyword aliases (`gcal`, `meeting`, `rsvp`) so the plugin surfaces when users search the marketplace for common shorthand and natural-language terms for Google Calendar.
- Re-grounded `cold-start`, `cursor-map`, `draft-flow`, and `idempotent` test suites on the plugin's machine-readable contract (parsed `listing.yaml` `proposed_schema`, `requires_plugins`, `requires_source_mcp`) instead of override-prose substrings, so future text-only edits to `_overrides/**` no longer cause false-positive test failures.

## [0.1.0] — 2026-06-02

### Added

- Initial release — daily look-ahead ingest plus schedule and respond write-back.
