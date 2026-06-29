# Changelog

All notable changes to the agntux-docusign plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] — 2026-06-29

### Fixed

- The Review-and-Sign view rendered blank with no signing button because the ingest pass never wrote the envelope fields the view reads. Action items for envelopes awaiting your signature now carry `envelope_id`, `envelope_subject`, `sender_name`, `sent_date`, `expiration_date`, `signer_position`, and `signing_url` in frontmatter, so the signing card and its open-in-DocuSign button populate correctly.
- Applied the same field-coverage fix to the reminder and void views (envelope context plus the pending-recipients and draft-message sections), preventing the same blank-iframe failure there.


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
