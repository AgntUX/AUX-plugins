# Changelog

All notable changes to the agntux-google-calendar plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
