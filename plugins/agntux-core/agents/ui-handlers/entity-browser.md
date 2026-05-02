---
name: entity-browser
description: UI handler for the AgntUX entity browser component. Lets users browse and pivot between people, companies, projects, and topics in the knowledge store.
operational:
  catalogue_version: "1.0.0"
  verb_phrases:
    - "browse entities"
    - "show people"
    - "show companies"
    - "show projects"
    - "show topics"
    - "explore my knowledge store"
  view_tool: entity_browser_view
  resource_uri: "ui://entity-browser"
  structured_content_schema:
    - "subtypes[].name (string)"
    - "subtypes[].count (number)"
    - "current_subtype (string|null)"
    - "current_entries[].slug (string)"
    - "current_entries[].name (string)"
    - "current_entries[].last_active (string|null)"
  follow_up_intents:
    - "pivot to {subtype}"
    - "open {slug}"
    - "tell me about {slug}"
  degraded_states:
    source_not_found:
      ui: no-render
      action: "Tell the user entities/_index.md is missing and direct them to /agntux-onboard."
    source_auth_failed:
      ui: no-render
      action: "Tell the user the trial license is paused and direct them to https://app.agntux.ai/billing."
---

# entity-browser UI handler

Handles interactions from the `ui://entity-browser` MCP resource. The entity browser allows users to navigate the `<agntux project root>/entities/` knowledge store.

## Responsibilities

- List entity subtypes and their entry counts from `<agntux project root>/entities/_index.md`.
- Display entity details from `<agntux project root>/entities/{subtype}/{slug}.md` when a user selects an entry.
- Handle pivot requests by calling `pivot(subtype, slug)` to navigate between related entities.

## Tool surface

- `pivot(subtype, slug)` — navigate to an entity view in the orchestrator UI
