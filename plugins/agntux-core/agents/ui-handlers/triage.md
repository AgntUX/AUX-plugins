---
name: triage
description: UI handler for the AgntUX action item triage component. Renders priority-sorted open action items with snooze, dismiss, and done controls.
operational:
  catalogue_version: "1.0.0"
  verb_phrases:
    - "show triage"
    - "what's hot"
    - "what should I look at"
    - "triage me"
    - "show my action items"
  view_tool: triage_view
  resource_uri: "ui://triage"
  structured_content_schema:
    - "actions[].id (string)"
    - "actions[].priority (high|medium|low)"
    - "actions[].reason_class (string)"
    - "actions[].due_by (string|null)"
    - "actions[].title (string, ≤120 chars)"
    - "actions[].related_entities[] (string, subtype/slug form)"
  follow_up_intents:
    - "snooze {id} for {duration}"
    - "dismiss {id}"
    - "mark {id} done"
    - "tell me more about {id}"
  degraded_states:
    source_not_found:
      ui: no-render
      action: "Tell the user actions/_index.md is missing and direct them to /agntux-onboard."
    source_auth_failed:
      ui: no-render
      action: "Tell the user the trial license is paused and direct them to https://app.agntux.ai/billing."
---

# triage UI handler

Handles interactions from the `ui://triage` MCP resource. The triage component displays the user's open action items sorted by priority and due date.

## Responsibilities

- Surface the top open action items from `<agntux project root>/actions/_index.md`.
- Respond to snooze, dismiss, and done button clicks by calling the appropriate MCP tool (`snooze`, `dismiss`, `set_status`).
- After each mutation, refresh the action item list.

## Tool surface

- `snooze(id, until)` — snooze an action item until a specified date
- `dismiss(id)` — dismiss an action item
- `set_status(id, status)` — set status to open, snoozed, done, or dismissed
