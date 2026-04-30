---
type: schema-subtype
subtype: company
schema_version: "1.0.0"
updated_at: {{generated_at}}
---

# `company` subtype

Organizations: customers, vendors, partners, competitors.

## Required frontmatter

- `id`, `type: entity`, `schema_version`, `subtype: company`, `aliases`, `sources`, `created_at`, `updated_at`, `last_active`, `deleted_upstream` (see `person.md` for shared semantics).

## Optional frontmatter

- `domain` — primary email/web domain (e.g., `acme.com`).
- `industry` — free-form industry tag.
- `size` — free-form size descriptor (e.g., `500 employees`, `Series B`, `enterprise`).
- `parent_company_slug` — slug pointing at a parent `company` entity (for subsidiaries).

## Body sections (required, in this order)

- `## Summary`
- `## Key Facts`
- `## Recent Activity`
- `## User notes`

## Aliases (subtype-level)

- `companies` — directory name (always plural).
- `customer` — alias allowed at install time when a plugin proposes `customer` as a subtype; merges to `company`.
- `account` — alias allowed at install time when a plugin proposes `account`; merges to `company`.

## Notes for ingest plugins

- Email-domain entities (`sources.email_domains: [acme.com]`) feed company resolution but are excluded from `_sources.json` per P3 §3.6.5.
- Re-resolve via `_sources.json` lookup before creating a new `company` file (P3 §3.6.4 lookup-before-write).
