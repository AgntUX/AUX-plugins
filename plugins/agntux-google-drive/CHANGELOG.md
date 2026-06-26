# Changelog

All notable changes to the agntux-google-drive plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-06-21

### Fixed

- Resilient document reads when the connector's comment path is down: if
  `read_file_content` fails with comments included, the sync now retries
  without comments so document content and change-summaries still ingest.
  Mention-detection is cleanly deferred (logged as
  `google-drive-comments-unavailable`) and resumes automatically once the
  connector's comment path recovers — files no longer stall on retry.

## [0.1.0] — 2026-06-20

### Added

- Initial scaffold of the agntux-google-drive plugin.
