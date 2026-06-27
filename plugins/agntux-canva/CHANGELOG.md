# Changelog

All notable changes to the agntux-canva plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-06-27

### Added

- Ingestion now pre-composes the view payload at ingest time for every action that opens a view (mandatory Step 10.1), so clicking a CTA surfaces pre-drafted content lifted from the action file instead of re-deriving it at click time.
- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content and regenerated draft — across all reason classes, not just response-needed.

## [0.1.0] — 2026-06-26

### Added

- Initial release of the agntux-canva plugin.
- Canva design ingestion via polling by modification date.
- Comment and mention surfacing as action items.
- Reply-to-comment, comment-on-design, and export-design action buttons.
- Support for `response-needed`, `knowledge-update`, and `other` action classes.
- Hourly sync cadence during weekday working hours (7am–7pm local).
