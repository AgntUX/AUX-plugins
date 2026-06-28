# Changelog

All notable changes to the agntux-jira plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] — 2026-06-28

### Fixed

- The comment view now reads the namespaced `## Compose payload (jira)` section as a fallback so a cross-source-merged "Draft a jira reply" action no longer renders blank; ingest guidance in `step-10-append.md` updated to require the Comment payload schema (`draft_body`, `cloud_id`, `issue_*`, `personalization_signals`) in that section — not the generic `drafted_body` compose shape.

## [0.3.0] — 2026-06-27

### Added

- Ingestion now pre-composes the view payload at ingest time for every action that opens a view (mandatory Step 10.1), so clicking a CTA surfaces pre-drafted content lifted from the action file instead of re-deriving it at click time.
- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content and regenerated draft — across all reason classes, not just response-needed.

## [0.2.0] — 2026-06-15

### Fixed

- **The comment, transition, assign, edit, and log-work views no longer render
  "… data is unavailable".** The ingest skill now writes the matching
  `## <Name> payload` body section each view reads (Step 10); previously only
  `## Compose payload` was documented, so every action view came back empty.
- **Suggested-action prompts now use a natural-language description** (`Use the
  agntux-jira plugin to …`) instead of a `/agntux-jira …` slash command, which
  the host can't route when sent programmatically.

## [0.1.2] — 2026-06-09

### Changed

- Removed a contributor's personal name from the plugin metadata: the
  `author` block, the README contributors list, the DCO signature, and an
  example assignee name in a test now use the AgntUX org identity / a generic
  placeholder.

## [0.1.1] — 2026-06-09

### Changed

- Switched the listed prompt to the current `/agntux-jira` slash-command
  syntax (was the legacy `ux:` prefix).
- Plain-language pass on the plugin description and README — less jargon,
  clearer about what the plugin does for you.

## [0.1.0] — 2026-06-09

### Added

- Initial scaffold of the agntux-jira plugin.
