# Changelog

All notable changes to the agntux-posthog plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
