# Changelog

All notable changes to the agntux-stripe plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-06-27

### Added

- Ingestion now pre-composes the view payload at ingest time for every action that opens a view (mandatory Step 10.1), so clicking a CTA surfaces pre-drafted content lifted from the action file instead of re-deriving it at click time.
- Ingestion now reconciles open action items against freshly-fetched data (Step 8.5): resolved source artefacts auto-close with an `## Auto-resolved` note, and changed-but-valid items refresh their content and regenerated draft — across all reason classes, not just response-needed.

## [0.1.0] — 2026-06-20

### Added

- Initial release of agntux-stripe plugin.
- Ingests Stripe payments, invoices, subscriptions, customers, disputes, refunds,
  coupons, products, prices, payout transfers, and related account changes.
- Six write UI handlers: refund a payment, respond to a dispute, finalize an
  invoice, void an invoice, pause/update a subscription, and cancel a subscription.
- Hourly sync cadence (7am–7pm weekdays, local time) tracks Stripe changes and
  surfaces action items for refunds, disputes, invoice deadlines, and risk events.
