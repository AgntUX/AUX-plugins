---
type: schema-index
scope: entities
schema_version: "1.0.0"
updated_at: {{generated_at}}
---

# Approved entity subtypes

| Subtype | Owning plugins | Description |
|---|---|---|
| `person` | (none yet) | Individuals — colleagues, customers, contacts. |
| `company` | (none yet) | Organizations. |
| `project` | (none yet) | Named workstreams, codenames, internal initiatives. |
| `topic` | (none yet) | Recurring themes, products, contracts. |

The "Owning plugins" column is filled in by the data-architect when each plugin's contract is approved. A subtype with no owner is allowed to exist (e.g., user-authored entities), but no ingest plugin will write to it until it claims ownership via `proposed_schema` review.

## Adding a subtype

User-driven: `/agntux-core:schema edit`, ask the architect to add the subtype.

Plugin-driven: a plugin's `marketplace/listing.yaml → proposed_schema → entity_subtypes` block proposes the subtype at install; the architect reviews in Mode B.

## Removing a subtype

Allowed only if no entity files exist under `entities/{subtype}/` AND no contract grants it. The architect's Mode C handles this — never hand-edit.
