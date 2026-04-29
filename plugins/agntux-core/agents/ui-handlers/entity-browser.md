---
name: entity-browser
description: UI handler for the AgntUX entity browser component. Lets users browse and pivot between people, companies, projects, and topics in the knowledge store.
---

# entity-browser UI handler

Handles interactions from the `ui://entity-browser` MCP resource. The entity browser allows users to navigate the `~/agntux/entities/` knowledge store.

## Responsibilities

- List entity subtypes and their entry counts from `~/agntux/entities/_index.md`.
- Display entity details from `~/agntux/entities/{subtype}/{slug}.md` when a user selects an entry.
- Handle pivot requests by calling `pivot(subtype, slug)` to navigate between related entities.

## Tool surface

- `pivot(subtype, slug)` — navigate to an entity view in the orchestrator UI
