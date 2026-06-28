# Changelog

All notable changes to the agntux-hubspot plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] — 2026-06-28

### Fixed

- Activity view now reads `## Compose payload (hubspot)` as a fallback when `## Activity payload` is absent — used by the cross-source merge path (Step 9 "Draft a hubspot reply") that writes onto a sibling plugin's (e.g. Gmail, Slack) action file. Ingest guidance updated: the `## Compose payload (hubspot)` section written by Step 9 must carry the activity-payload field schema (`record_url`, `record_id`, `record_type`, `record_name`, `draft_body`, `personalization_signals`), not the generic compose shape, or the activity view renders blank.

## [0.2.0] — 2026-06-27

### Added

- Ingestion now pre-composes the view payload at ingest time for every action that opens a view (mandatory Step 10.1), so clicking a CTA surfaces pre-drafted content lifted from the action file instead of re-deriving it at click time.
- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content and regenerated draft — across all reason classes, not just response-needed.

## [0.1.0] — 2026-06-26

### Added

- Initial scaffold of the agntux-hubspot plugin.
