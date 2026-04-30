---
type: schema-subtype
subtype: project
schema_version: "1.0.0"
updated_at: {{generated_at}}
---

# `project` subtype

Named workstreams, codenames, internal initiatives that span multiple people, companies, or sources.

## Required frontmatter

- `id`, `type: entity`, `schema_version`, `subtype: project`, `aliases`, `sources`, `created_at`, `updated_at`, `last_active`, `deleted_upstream`.

## Optional frontmatter

- `lead_slug` — slug pointing at a `person` entity who leads the project.
- `status` — free-form status (`active`, `on-hold`, `complete`, `cancelled`).
- `parent_project_slug` — slug pointing at a parent `project` entity.
- `target_date` — date-only `YYYY-MM-DD` for the next milestone.

## Body sections (required, in this order)

- `## Summary`
- `## Key Facts`
- `## Recent Activity`
- `## User notes`

## Aliases (subtype-level)

- `projects` — directory name (always plural).
- `initiative`, `workstream` — common synonyms; merge to `project` at install time.
- `epic` — Jira-specific term; the architect may approve as a distinct subtype OR merge to `project` depending on user preference (Mode B decision).

## Notes for ingest plugins

- Codenames go in `aliases` with the canonical display name first (e.g., `aliases: [Project Mango, mango]`).
- `# Glossary` in `user.md` is the disambiguation source — read it before deciding a codename → project mapping.
