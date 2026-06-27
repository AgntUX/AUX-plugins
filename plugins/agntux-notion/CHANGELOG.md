# Changelog

All notable changes to the agntux-notion plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-06-27

### Added

- Fixed: the comment / update / create-page views now pre-fill correctly — the ingest skill writes the exact draft + metadata fields each view reads from the action's frontmatter (`page_title`, `comment_thread`, `draft_body`, `current_properties`, `parent_options`, …), closing the field-coverage gap that previously left fields blank.
- Ingestion now pre-composes the view payload at ingest time for every action that opens a view (mandatory Step 10.1), so clicking a CTA surfaces pre-drafted content lifted from the action file instead of re-deriving it at click time.
- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content and regenerated draft — across all reason classes, not just response-needed.

## [0.1.0] — 2026-06-26

### Added

- Ingest pages, database items, and comment threads from your Notion workspace on a 4-hour cadence.
- Surface action items for comments awaiting replies, recently updated pages, tasks with deadlines, and important items.
- Reply to comments directly from AgntUX.
- Update page properties and fields without leaving AgntUX.
- Create new pages in your Notion workspace.
- Full-text search and question-answering over your Notion data.
