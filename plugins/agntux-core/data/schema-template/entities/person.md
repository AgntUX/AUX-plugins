---
type: schema-subtype
subtype: person
schema_version: "1.0.0"
updated_at: {{generated_at}}
---

# `person` subtype

Individuals the user interacts with: colleagues, customers, contacts, candidates.

## Required frontmatter

- `id` — the slug (matches the filename without `.md`).
- `type` — literal string `entity`.
- `schema_version` — semver matching this contract.
- `subtype` — literal string `person`.
- `aliases` — array of strings. The canonical display name MUST appear in `aliases`. Other variations (nicknames, full names, email-local-parts) MAY appear. Empty array allowed only when the slug is the canonical name verbatim.
- `sources` — map. Keys are source slugs (`gmail`, `slack`, `notes`, etc.); values are scalar IDs or arrays of IDs (per P3 §3.1). Reserved key `email_domains` excluded from `_sources.json` indexing.
- `created_at` — date-only `YYYY-MM-DD` (when this entity first appeared in the store).
- `updated_at` — date-only `YYYY-MM-DD` (last write).
- `last_active` — date-only `YYYY-MM-DD` (last time the entity was referenced in source data).
- `deleted_upstream` — `null` or RFC 3339 timestamp (set when source confirms deletion).

## Optional frontmatter

- `email` — string, primary email address.
- `role` — string, free-form role description.
- `employer_slug` — slug pointing at a `company` entity.
- `phone` — string, primary phone number (rarely populated).

## Body sections (required, in this order)

- `## Summary` — one-paragraph synthesis.
- `## Key Facts` — bulleted structured facts.
- `## Recent Activity` — newest-first timeline (auto-pruned at 30 days).
- `## User notes` — user-authored, preserved verbatim across re-ingests.

## Aliases (subtype-level)

- `people` — directory name (always plural).

## Notes for ingest plugins

- Slug derivation: see P3 §2.4 (lowercase, NFKD strip diacritics, hyphenate, trim, 64-char cap).
- Disambiguation: when two real people share a slug, append a stable secondary identifier (employer slug). Add the bare name to `aliases:` on both files.
- `## User notes` is load-bearing: never overwrite it (P3 §3.2.1 section preservation).
