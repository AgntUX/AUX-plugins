# Changelog

All notable changes to the agntux-imessage plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] — 2026-06-29

### Changed

- Replaced the hard-coded sample contact name in the cursor and fetch skill examples with a neutral placeholder.

## [0.2.1] — 2026-06-28

### Fixed

- View handler now reads the namespaced `## Compose payload (imessage)` section first (falling back to bare `## Compose payload`), preventing cross-source payload bleed when both headings appear in the same action file.

## [0.2.0] — 2026-06-27

### Added

- Ingestion now pre-composes the view payload at ingest time for every action that opens a view (mandatory Step 10.1), so clicking a CTA surfaces pre-drafted content lifted from the action file instead of re-deriving it at click time.
- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content and regenerated draft — across all reason classes, not just response-needed.

## [0.1.0] — 2026-06-18

### Added

- Initial release of agntux-imessage plugin.
- Ingest iMessages and conversations from your device, indexed by contact.
- Priority-based filtering: high-priority reply-needed messages, personal messages, and low-priority promotional/automated content.
- Draft and send replies safely via AgntUX before messages reach iMessage.
- Natural-language querying of message history.
- Syncs every 15 minutes during work hours (7am–7pm weekdays, local timezone).
