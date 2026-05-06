---
name: compose
description: UI handler for the Slack-reply compose card. Renders thread context, the agent-drafted reply body, mode tabs (Send / Schedule / Save Slack draft), and the committed-envelope emitter. Engage when the host routes an "open the reply composer for action {id}" prompt to compose_view.
tools: Read, mcp__agntux-slack__agntux_slack_compose_view

operational:
  catalogue_version: "1.0.0"
  verb_phrases:
    # In 1.1.0+ the draft body and thread_context are pre-composed at ingest
    # time and live in the action file's `## Compose payload` body section.
    # The host can route these click-time prompts directly to compose_view
    # with only `{action_id}` and `initial_verb` — the view tool lifts the
    # rest from disk. The legacy `draft a reply for action` / `draft a reply
    # and schedule it for action` shapes are still matched here for backward
    # compat with action items written by 2.x.x ingest runs.
    - "open the reply composer for action"
    - "open the reply composer in schedule mode for action"
    - "draft a reply for action"
    - "draft a reply and schedule it for action"
  view_tool: agntux_slack_compose_view
  resource_uri: "ui://slack-compose"
  structured_content_schema:
    - "action_id (string — kebab-case slug from filename, no .md suffix)"
    - "initial_verb ('draft' | 'schedule' | 'save_draft' — which mode tab to pre-select)"
    - "channel.id (string)"
    - "channel.name (string)"
    - "channel.is_dm (boolean)"
    - "thread.parent_ts (string)"
    - "thread.parent_author_real_name (string)"
    - "thread.parent_excerpt (string, ≤300 chars)"
    - "thread.last_reply_ts (string | null)"
    - "thread.last_reply_author_real_name (string | null)"
    - "thread.last_reply_excerpt (string | null, ≤300 chars)"
    - "thread.total_replies (number)"
    - "thread.participants (string[], ≤6 real names)"
    - "messages_preview[].ts (string)"
    - "messages_preview[].author (string)"
    - "messages_preview[].body_excerpt (string, ≤200 chars)"
    - "messages_truncated (boolean)"
    - "drafted_body (string, ≤4000 chars — agent-composed reply)"
    - "personalization_signals (string[], ≤4 × ≤120 chars)"
    - "proposed_send_time (string | null — RFC 3339, only for schedule mode)"
    - "slack_permalink (string | null)"
  follow_up_intents:
    # 3.0.0: each commit intent now emits a "Use the Slack Connector to …"
    # envelope addressed at the host's Slack Connector tools directly.
    # Discard is a pure local action — emits nothing to chat.
    - "slack-connector-send"
    - "slack-connector-schedule"
    - "slack-connector-save-draft"
    - "compose-discard-local"
  degraded_states:
    source_not_found:
      ui: no-render
      action: "Same handling as action_not_found. Surface 'Couldn't find that action item — it may have been resolved or removed.'"
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
UI rendering happens via the stateless view tool declared in
`operational.view_tool` above. The body below is METADATA ONLY — it
documents the handler's contract and serves as developer reference.

Handler subagent files at agents/ui-handlers/{name}.md are metadata carriers:
  - The YAML frontmatter carries the operational manifest.
  - The body documents verb phrases, structuredContent schema, and send-action intents.
  - NO subagent is spawned from this file at runtime.
  - NO source MCP calls happen from this file.
  - NO file writes happen from this file.

The actual rendering is performed by the view tool at:
  mcp-server/src/tools/compose-view.ts (registered as `agntux_slack_compose_view`)
-->

# Compose UI handler

## What this handler covers

Source: **Slack thread context** (pre-composed at ingest in the action file's `## Compose payload`)
UI component: `ui://slack-compose`
View tool: `mcp__agntux-slack__agntux_slack_compose_view`

This handler renders the **Compose** card — the inline edit surface for drafting
Slack replies. The sync skill (1.1.0+) pre-composes the draft body and thread
context at ingest time and stores them in the action file's `## Compose payload`
body section. At click time, the host routes the `open the reply composer for
action {id}` prompt directly to `compose_view`, which reads the action file,
lifts the payload, and returns `structuredContent` for the iframe.

The user sees:
- Channel/thread header with an "Open in Slack" button (via `openLink`).
- Collapsible original-thread panel.
- Editable textarea prefilled with the drafted body.
- "Why this draft?" personalization disclosure.
- Mode tabs: Send now / Schedule / Save as Slack draft.
- Footer: primary action + Discard.

## Verb phrases

| Phrase | Required slots | Note |
|---|---|---|
| `open the reply composer for action` | `action_id` only | Click-time path (1.1.0+) — view tool lifts the rest from the action file |
| `open the reply composer in schedule mode for action` | `action_id` only | Same, schedule-mode preselect |
| `draft a reply for action` | full compose args | Legacy path retained for action items written by 2.x.x sync runs |
| `draft a reply and schedule it for action` | full compose args + `proposed_send_time` | Legacy path retained for action items written by 2.x.x sync runs |

This view tool is not user-callable from a generic chat prompt — the
host's tool-descriptor matching routes the suggested-action click directly
to `compose_view`. Inline structured args still win when supplied (e.g.,
during testing); otherwise the view tool lifts everything from the action
file's `## Compose payload`.

## structuredContent schema

See `operational.structured_content_schema` in the frontmatter.

## Send-action intents

### Committed envelope encoding (5.0.0+)

The component emits `sendFollowUpMessage(host_prompt)` when the user confirms.
**The envelope targets the user's Slack Connector directly** — there is no
agntux-slack draft skill in the routing chain (the skill was removed in
5.0.0). The host reads the envelope, sees `Use the Slack Connector to …`,
and dispatches to the relevant Slack write tool with the channel_id and
thread_ts that are already inline in the envelope.

Unicode guillemets `«»` still delimit the body field. Literal `«` or `»` in
the body are escaped by doubling (`««`, `»»`). The host (or any future
parser) reverses the doubling after extracting content between the outermost
`«»`.

### intent-key:slack-connector-send

```
Use the Slack Connector to send a Slack message as a thread reply. channel_id: {channel.id} (#{channel.name}), thread_ts: {thread.parent_ts}. Reply in-thread; if no thread exists yet on the parent message, this reply will start one when posted. Body: «{edited_body}». (action_id: {action_id})
```

### intent-key:slack-connector-schedule

```
Use the Slack Connector to schedule a Slack message as a thread reply. channel_id: {channel.id} (#{channel.name}), thread_ts: {thread.parent_ts}, send_at: {RFC3339}. Reply in-thread; if no thread exists yet on the parent message, this reply will start one when posted. Body: «{edited_body}». (action_id: {action_id})
```

### intent-key:slack-connector-save-draft

```
Use the Slack Connector to save a Slack draft (do NOT send) of a thread reply. channel_id: {channel.id} (#{channel.name}), thread_ts: {thread.parent_ts}. Reply in-thread; if no thread exists yet on the parent message, this reply will start one when posted. Save as draft only — do not send. Body: «{edited_body}». (action_id: {action_id})
```

### intent-key:compose-discard-local

Discard is a pure local action — no host round-trip. The component sets a
local `discarded` flag, replaces the form with a "Discarded — no message
was sent. The action item is still open." banner, and emits **nothing**
to chat. The action item stays open in triage so the user can come back
to it.

## Degraded states

| Key | ui | Action |
|---|---|---|
| `action_not_found` | no-render | "Couldn't find that action item — it may have been resolved or removed." |
| `action_already_handled` | no-render | "This action is no longer open — already done, dismissed, or snoozed." |
| `agntux_root_missing` | no-render | "Run /agntux-onboard to set up your AgntUX workspace." |
| `license_paused` | no-render | "Your trial is paused. Upgrade at app.agntux.ai/billing to keep AgntUX active." |

## Distribution

Component bundle is embedded into the compiled MCP server at build time via
`mcp-server/scripts/embed-bundle.mjs`. There is no S3 fetch; the bundle ships
inside the plugin tree.
