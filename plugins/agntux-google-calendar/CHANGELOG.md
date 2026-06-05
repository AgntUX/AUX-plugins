# Changelog

All notable changes to the agntux-google-calendar plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-06-03

### Fixed

- Added missing keyword aliases (`gcal`, `meeting`, `rsvp`) so the plugin surfaces when users search the marketplace for common shorthand and natural-language terms for Google Calendar.
- Re-grounded `cold-start`, `cursor-map`, `draft-flow`, and `idempotent` test suites on the plugin's machine-readable contract (parsed `listing.yaml` `proposed_schema`, `requires_plugins`, `requires_source_mcp`) instead of override-prose substrings, so future text-only edits to `_overrides/**` no longer cause false-positive test failures.

## [0.1.0] — 2026-06-02

### Added

- Initial release — daily look-ahead ingest plus schedule and respond write-back.
