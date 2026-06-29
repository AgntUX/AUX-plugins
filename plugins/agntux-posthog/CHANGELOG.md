# Changelog

All notable changes to the agntux-posthog plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] — 2026-06-29

### Fixed

- The "Update issue" button on the resolve view did nothing when clicked, because numeric PostHog issue ids written unquoted in an action's frontmatter were parsed as numbers and dropped during payload coercion — leaving the issue id empty so the button's guard silently aborted. The view now coerces numeric ids to strings (also hardening the experiment view), and the resolve view surfaces a clear message instead of failing silently.


## [0.2.0] — 2026-06-27

### Added

- Fixed: the resolve / reply / experiment / report views now pre-fill correctly — the ingest skill writes the exact draft + metadata fields each view reads from the action's frontmatter (`draft_body`, `candidate_assignees`, `occurrence_summary`, `variants`, `report_summary`, …), closing the field-coverage gap that previously left fields blank.
- Ingestion now pre-composes the view payload at ingest time for every action that opens a view (mandatory Step 10.1), so clicking a CTA surfaces pre-drafted content lifted from the action file instead of re-deriving it at click time.
- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content and regenerated draft — across all reason classes, not just response-needed.

## [0.1.0] — 2026-06-19

### Added

- Initial release of agntux-posthog plugin.
- Error tracking issue ingestion with triage and resolution actions.
- Alert firing detection and acknowledgment actions.
- Experiment state tracking with variant decision actions.
- Comment mention detection and reply actions.
- Inbox report flagging and review actions.
- Per-resource timestamp-based cursor semantics (errors, alerts, experiments, comments, inbox reports).
- Hourly sync schedule during business hours (7am–7pm weekdays local time).
- Natural-language query support for PostHog analytics data.

[Unreleased]: https://github.com/AgntUX/AUX-plugins/compare/agntux-posthog-0.1.0...HEAD
[0.1.0]: https://github.com/AgntUX/AUX-plugins/releases/tag/agntux-posthog-0.1.0
