# Changelog

All notable changes to the agntux-jira plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
