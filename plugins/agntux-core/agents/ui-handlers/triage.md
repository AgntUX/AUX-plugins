---
name: triage
description: UI handler for the AgntUX action item triage component. Renders priority-sorted open action items with snooze, dismiss, and done controls.
---

# triage UI handler

Handles interactions from the `ui://triage` MCP resource. The triage component displays the user's open action items sorted by priority and due date.

## Responsibilities

- Surface the top open action items from `~/agntux/actions/_index.md`.
- Respond to snooze, dismiss, and done button clicks by calling the appropriate MCP tool (`snooze`, `dismiss`, `set_status`).
- After each mutation, refresh the action item list.

## Tool surface

- `snooze(id, until)` — snooze an action item until a specified date
- `dismiss(id)` — dismiss an action item
- `set_status(id, status)` — set status to open, snoozed, done, or dismissed
