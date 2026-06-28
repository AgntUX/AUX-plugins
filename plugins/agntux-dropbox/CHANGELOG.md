# Changelog

All notable changes to the agntux-dropbox plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] — 2026-06-28

### Fixed

- The view now reads its namespaced `## Compose payload (dropbox)` section first so a cross-source-merged action file no longer renders blank — the bare `## Compose payload` fallback is only used when the namespaced section is absent.

## [0.2.0] — 2026-06-27

### Added

- Fixed: the share / organize / new-folder / file-request views now pre-fill correctly. The ingest skill writes the exact `## Compose payload` fields each view reads, closing the field-name mismatch that previously rendered blank fields.
- Ingestion now pre-composes the view payload at ingest time for every action that opens a view (mandatory Step 10.1), so clicking a CTA surfaces pre-drafted content lifted from the action file instead of re-deriving it at click time.
- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content and regenerated draft — across all reason classes, not just response-needed.

## [0.1.0] — 2026-06-26

### Added

- Initial release of the agntux-dropbox plugin.
- Sync of Dropbox files, folders, shared links, and file requests into AgntUX.
- Search and query support for natural-language questions about files and folders.
- UI handlers for sharing files (create shareable links with permission control).
- UI handlers for organizing files (move or copy to different folders).
- UI handlers for creating new folders.
- UI handlers for setting up file requests.
- Recommended ingest cadence: every 4 hours during work hours (7am–7pm weekdays local).
