# Changelog

All notable changes to the agntux-mercury plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-06-27

### Added

- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content — across all reason classes.
- Refreshed the canonical ingest procedural body (reconcile step + pre-draft step generalisation) shared by every AgntUX ingest plugin.

## [0.1.1] — 2026-06-23

### Fixed

- Improved resilience of date anchoring in sync: now uses Mercury's `getCurrentDate` with one retry before falling back to host date. This prevents transient `getCurrentDate` failures from surfacing as noisy notes and ensures balance and account fetching remain unaffected.

## [0.1.0] — 2026-06-19

### Added

- Initial scaffold of the agntux-mercury plugin.
