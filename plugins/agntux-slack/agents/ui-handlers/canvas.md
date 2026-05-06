---
name: canvas
description: UI handler for the Slack canvas summary card. Renders editable canvas sections (title, TL;DR, decisions, open questions, participants) and a "Create canvas + post link" action. Engage when the draft skill calls canvas_view after composing the canvas sections.
tools: Read, mcp__agntux-slack__canvas_view

operational:
  catalogue_version: "1.0.0"
  verb_phrases:
    # In 1.1.0+ the canvas sections are pre-composed at ingest time and live
    # in the action file's `## Canvas payload` body section. The host can
    # route the click-time prompt directly to canvas_view with only
    # `{action_id}` — the view tool lifts the rest from disk. The legacy
    # `summarise the thread for action` shape is still matched here for
    # backward compat with action items written by 2.x.x ingest runs.
    - "open the canvas summariser for action"
    - "summarise the thread for action"
  view_tool: canvas_view
  resource_uri: "ui://slack-canvas"
  structured_content_schema:
    - "action_id (string — kebab-case slug from filename, no .md suffix)"
    - "channel.id (string)"
    - "channel.name (string)"
    - "thread.parent_ts (string)"
    - "thread.total_replies (number)"
    - "thread.participants (string[], ≤12)"
    - "drafted_canvas.title (string, ≤80 chars)"
    - "drafted_canvas.tldr (string, ≤500 chars)"
    - "drafted_canvas.decisions (string[], ≤8 × ≤200 chars)"
    - "drafted_canvas.open_questions (string[], ≤8 × ≤200 chars)"
    - "drafted_canvas.participants (string[], ≤12 real names)"
    - "proposed_followup_message (string, ≤200 chars)"
  follow_up_intents:
    - "agntux-slack-canvas-commit-create"
    - "agntux-slack-canvas-discard"
  degraded_states:
    source_not_found:
      ui: no-render
      action: "Same as action_not_found."
    action_not_found:
      ui: no-render
      action: "Surface 'Couldn't find that action item — it may have been resolved or removed.'"
    action_already_handled:
      ui: no-render
      action: "Surface 'This action is no longer open — already done, dismissed, or snoozed.'"
    agntux_root_missing:
      ui: no-render
      action: "Surface 'Run /agntux-onboard to set up your AgntUX workspace.'"
    license_paused:
      ui: no-render
      action: "Surface 'Your trial is paused. Upgrade at app.agntux.ai/billing to keep AgntUX active.'"
---

<!--
RENDER-ONLY DISCIPLINE — READ BEFORE EDITING
=============================================
This handler's body is NOT executed as a runtime subagent prompt.
UI rendering happens via the stateless view tool in `operational.view_tool`.
The body is METADATA ONLY.
-->

# Canvas UI handler

## What this handler covers

Source: **Slack thread context** (passed by the draft skill)
UI component: `ui://slack-canvas`
View tool: `mcp__agntux-slack__canvas_view`

This handler renders the **Canvas** card — the inline editor for creating a
Slack canvas thread summary. The user can edit the title, TL;DR, decisions,
and open questions before committing. A preview tab shows the assembled markdown.

## Verb phrases

| Phrase | Required slots | Note |
|---|---|---|
| `summarise the thread for action` | full canvas args | Invoked by draft skill (only path) |

This view tool has 5 required arg objects (`action_id`, `drafted_canvas`,
`channel`, `thread`, `proposed_followup_message`). It is not user-callable
from a generic chat prompt — the draft skill is the only path that can
populate the args from working-memory thread context.

## Committed envelope encoding

```
ux: Use the agntux-slack plugin to commit the drafted canvas for action {action_id}
with title «{title}», tldr «{tldr}», decisions «{JSON.stringify(decisions)}»,
open_questions «{JSON.stringify(open_questions)}», followup_message «{proposed_followup_message}».
```

Unicode guillemets `«»` delimit each field.

**Scalar fields** (`title`, `tldr`, `followup_message`): each value's literal
`«` is doubled to `««`, literal `»` to `»»`, before wrapping in the outer
`«…»`. The draft skill parser reverses the doubling after extracting content
between the outermost `«»`.

**List fields** (`decisions`, `open_questions`): the array is JSON-stringified
into the value slot. The `«…»` outer wrapper still applies, but the inner
contents are a valid JSON array literal — no custom escape rules. The draft
skill parser does `JSON.parse(capturedGroup)` to recover the array. JSON
natively handles literal `|`, `«`, `»`, newlines, and quotes within string
items, so no item-level escaping is needed.

This replaces an earlier `||`-doubling/join scheme that had a single-pipe
correctness gap (an item containing a single literal `|` could not round-trip).
JSON sidesteps that entirely because the array boundaries are JSON syntax,
not a chosen sentinel.

## Degraded states

| Key | ui | Action |
|---|---|---|
| `action_not_found` | no-render | "Couldn't find that action item." |
| `action_already_handled` | no-render | "This action is no longer open." |
| `agntux_root_missing` | no-render | "Run /agntux-onboard." |
| `license_paused` | no-render | "Upgrade at app.agntux.ai/billing." |
