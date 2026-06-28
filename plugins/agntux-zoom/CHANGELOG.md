# Changelog

All notable changes to the agntux-zoom plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] — 2026-06-28

### Fixed

- View handler now reads the namespaced `## Compose payload (zoom)` section first, falling back to bare `## Compose payload` only when the namespaced header is absent. Prevents cross-source action files that carry both sections from silently serving the wrong (bare) block.

## [0.2.0] — 2026-06-27

### Added

- Ingestion now pre-composes the view payload at ingest time for every action that opens a view (mandatory Step 10.1), so clicking a CTA surfaces pre-drafted content lifted from the action file instead of re-deriving it at click time.
- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content and regenerated draft — across all reason classes, not just response-needed.

## [0.1.0] — 2026-06-25

### Added

- Initial release of agntux-zoom
- Integration with Zoom MCP connector for meeting ingestion
- Support for meetings, recordings, transcripts, and meeting summaries
- Zoom Team Chat message indexing
- AI-generated meeting summaries from recordings
- "Save to Zoom Doc" UI handler for exporting meeting summaries
- Action item surfacing for meeting next steps and decisions
- Per-stream cursor tracking for meetings, recordings, chat, and docs
- Ingest cadence: every 30 minutes, 7am–7pm weekdays local
