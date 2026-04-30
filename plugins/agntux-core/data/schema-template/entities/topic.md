---
type: schema-subtype
subtype: topic
schema_version: "1.0.0"
updated_at: {{generated_at}}
---

# `topic` subtype

Recurring themes, products, contracts, areas of concern. Topics are MOC-style (Map of Content) — they aggregate wiki-links to related people, companies, projects.

## Required frontmatter

- `id`, `type: entity`, `schema_version`, `subtype: topic`, `aliases`, `sources`, `created_at`, `updated_at`, `last_active`, `deleted_upstream`.

## Optional frontmatter

- `parent_topic_slug` — slug pointing at a parent `topic` entity (for subtopic hierarchies).
- `category` — free-form bucket (`product`, `contract`, `research`, `incident`).

## Body sections (required, in this order)

- `## Summary`
- `## Key Facts`
- `## Recent Activity`
- `## User notes`

## Aliases (subtype-level)

- `topics` — directory name (always plural).
- `theme` — common synonym; merge to `topic` at install time.

## Notes for ingest plugins

- Topics are typically created reactively — when retrieval sees the same word/phrase repeatedly across sources, it offers to promote to a topic MOC (with user confirmation).
- Ingest plugins may create topics directly when a source has explicit topic-tag semantics (Slack channels mapping to topics, Jira labels mapping to topics).
