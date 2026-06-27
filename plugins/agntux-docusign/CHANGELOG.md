# Changelog

All notable changes to the agntux-docusign plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-06-27

### Added

- Ingestion now pre-composes the view payload at ingest time for every action that opens a view (mandatory Step 10.1), so clicking a CTA surfaces pre-drafted content lifted from the action file instead of re-deriving it at click time.
- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content and regenerated draft — across all reason classes, not just response-needed.

## [0.1.0] — 2026-06-26

### Added

- Initial scaffold of the agntux-docusign plugin.
- DocuSign envelope tracking: see signature requests with status and signer progress.
- Agreement monitoring: track executed contracts and upcoming renewals/expirations.
- Action items for pending signers, envelopes awaiting user signature, and status changes.
- Send reminder nudges to pending signers via connector-targeted action button.
- Void envelopes with a reason via connector-targeted action button.
- Open-in-DocuSign affordance for envelopes awaiting user signature.
