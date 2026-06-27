# Changelog

All notable changes to the agntux-apple-notes plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-06-27

### Added

- Fixed: the note composer now pre-fills correctly. The ingest skill writes the exact `## Compose payload` fields the create-note and update-note views read (draft_title, draft_body, target_folder, available_folders, and the update-note fields), closing the field-name mismatch that previously left the composer blank.
- Ingestion now pre-composes the view payload at ingest time for every action that opens a view (mandatory Step 10.1), so clicking a CTA surfaces pre-drafted content lifted from the action file instead of re-deriving it at click time.
- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content and regenerated draft — across all reason classes, not just response-needed.

## [0.1.0] — 2026-06-16

### Added

- Apple Notes integration — check for new and updated notes every 4 hours.
- Create new notes directly from AgntUX.
- Update existing notes and check off checklist items.
- Two UI handlers for note creation and editing workflows.
- Automatic note deduplication and modification-time tracking.
