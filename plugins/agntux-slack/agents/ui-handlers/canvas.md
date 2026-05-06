---
name: canvas
description: UI handler for the Slack canvas summary card. Renders editable canvas sections (title, TL;DR, decisions, open questions, participants) and a "Create canvas + post link" action. Engage when the host routes an "open the canvas summariser for action {id}" prompt to canvas_view.
tools: Read, mcp__agntux-slack__agntux_slack_canvas_view

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
  view_tool: agntux_slack_canvas_view
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
    # 3.0.0: canvas commit emits a "Use the Slack Connector in two steps …"
    # envelope addressed at the host's Slack Connector tools directly
    # (slack_create_canvas + slack_send_message). Discard is a pure local
    # action — emits nothing to chat.
    - "slack-connector-create-canvas-and-post"
    - "canvas-discard-local"
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

Source: **Slack thread context** (pre-composed at ingest in the action file's `## Canvas payload`)
UI component: `ui://slack-canvas`
View tool: `mcp__agntux-slack__agntux_slack_canvas_view`

This handler renders the **Canvas** card — the inline editor for creating a
Slack canvas thread summary. The sync skill (1.1.0+) pre-composes the canvas
sections at ingest time and stores them in the action file's `## Canvas
payload` body section. At click time, the host routes the `open the canvas
summariser for action {id}` prompt directly to `canvas_view`, which reads
the action file, lifts the payload, and returns `structuredContent` for the
iframe. The user can edit the title, TL;DR, decisions, and open questions
before committing. A preview tab shows the assembled markdown.

## Verb phrases

| Phrase | Required slots | Note |
|---|---|---|
| `open the canvas summariser for action` | `action_id` only | Click-time path (1.1.0+) — view tool lifts the rest from the action file |
| `summarise the thread for action` | full canvas args | Legacy path retained for action items written by 2.x.x sync runs |

This view tool is not user-callable from a generic chat prompt — the host's
tool-descriptor matching routes the suggested-action click directly to
`canvas_view`. Inline structured args still win when supplied; otherwise
the view tool lifts everything from the action file's `## Canvas payload`.

## Committed envelope encoding (5.0.0+)

The envelope **targets the user's Slack Connector directly** — there is no
agntux-slack draft skill in the routing chain (the skill was removed in
5.0.0). The host reads the envelope, performs two MCP calls in sequence,
and uses the channel_id + thread_ts inline in the envelope (no disk read
needed).

```
Use the Slack Connector in two steps:
1. Create a Slack canvas titled «{title}» with body assembled from TL;DR «{tldr}», decisions «{JSON}», open_questions «{JSON}». Use slack_create_canvas.
2. Take the canvas URL returned by step 1 and post it as a thread reply in channel_id: {channel.id} (#{channel.name}), thread_ts: {thread.parent_ts}, with body «{followup_message}» followed by the canvas URL formatted as a Slack mrkdwn link `<{canvas_url}|{title}>` (substitute the URL from step 1). Reply in-thread; if no thread exists yet on the parent message, this reply will start one. Use slack_send_message.
 (action_id: {action_id})
```

Unicode guillemets `«»` delimit each field.

**Scalar fields** (`title`, `tldr`, `followup_message`): each value's literal
`«` is doubled to `««`, literal `»` to `»»`, before wrapping in the outer
`«…»`. A reader reverses the doubling after extracting content between the
outermost `«»`.

**List fields** (`decisions`, `open_questions`): the array is JSON-stringified
into the value slot. The `«…»` outer wrapper still applies, but the inner
contents are a valid JSON array literal — no custom escape rules. A reader
does `JSON.parse(capturedGroup)` to recover the array. JSON natively handles
literal `|`, `«`, `»`, newlines, and quotes within string items, so no
item-level escaping is needed.

**Canvas linking.** `slack_create_canvas` returns a URL of the form
`https://{workspace}.slack.com/docs/{team}/{file_id}`. Slack auto-unfurls
that URL into a canvas-preview card when posted in a channel. The envelope
instructs the host to format the link as Slack mrkdwn `<URL|title>` so it
reads as the canvas title rather than as a raw URL. The iframe cannot
precompute the URL — it only exists after step 1 completes.

**Discard** (5.0.0+) is a pure local action. The component sets a local
`discarded` flag, replaces the form with a banner, and emits nothing to
chat. The action item stays open in triage.

## Degraded states

| Key | ui | Action |
|---|---|---|
| `action_not_found` | no-render | "Couldn't find that action item." |
| `action_already_handled` | no-render | "This action is no longer open." |
| `agntux_root_missing` | no-render | "Run /agntux-onboard." |
| `license_paused` | no-render | "Upgrade at app.agntux.ai/billing." |
