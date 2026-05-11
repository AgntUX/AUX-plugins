---
type: schema-seed
schema_version: "1.0.0"
updated_at: "2026-05-10"
---

# Schema seed for build-time test runs

Generic entity subtypes that fit most source plugins. Stage 9.5 of
agntux-build uses this seed plus the source plugin's
`marketplace/listing.yaml → proposed_schema` block to compose an
in-conversation contract for the analyze-only sync run. Nothing here is
written to the user's real `data/schema/`.

## Entity subtypes

### `person`

Required frontmatter: `name`, `email?`, `source_handles[]`, `last_active`.
Body sections: `## Summary`, `## Key Facts`, `## Recent signals`,
`## User notes`.

### `company`

Required frontmatter: `name`, `domain?`, `last_active`.
Body sections: `## Summary`, `## Key Facts`, `## Recent signals`,
`## User notes`.

### `project`

Required frontmatter: `name`, `status` (`active` | `paused` | `done`),
`owner?`, `last_active`. Body sections: `## Summary`, `## Key Facts`,
`## Recent signals`, `## User notes`.

### `topic`

Required frontmatter: `name`, `last_active`. Body sections:
`## Summary`, `## Key Facts`, `## Recent signals`, `## User notes`.

## Action shape

Required frontmatter: `id`, `type`, `schema_version`, `status`
(`open` | `done` | `deferred` | `dismissed` | `superseded`),
`priority` (`p0` | `p1` | `p2` | `p3`), `reason_class`, `created_at`,
`source`, `source_ref`, `related_entities[]`, `due_by?`,
`suggested_actions[]`. Body sections: `## Why this matters`,
`## Personalization fit`, optional `## Compose payload`.

## Extension contract

A source plugin's `proposed_schema` block in `marketplace/listing.yaml`
contributes:

- `entity_subtypes` — adds subtypes beyond the four above (e.g.,
  `slack-channel`, `gmail-thread`, `jira-issue`).
- `action_classes` — narrows or extends `reason_class` enum.
- `cursor_semantics` — how the source's cursor advances.
- `source_id_format` — the `source_ref` shape.

Stage 9.5 stitches these on top of this seed at test-run synthesis time.
