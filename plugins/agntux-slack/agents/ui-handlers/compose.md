---
name: compose
description: UI handler for the Slack-reply compose card. Renders thread context, the agent-drafted reply body, mode tabs (Send / Schedule / Save Slack draft), and the committed-envelope emitter. Engage when the draft skill calls compose_view after composing the draft body.
tools: Read, mcp__agntux-slack__compose_view

operational:
  catalogue_version: "1.0.0"
  verb_phrases:
    # Only invoked programmatically by the draft skill at click time — it has the
    # required `drafted_body` + `thread_context` + `channel` args. The view tool
    # is NOT user-callable from a generic chat prompt because those args can't
    # be hallucinated.
    - "draft a reply for action"
    - "draft a reply and schedule it for action"
  view_tool: compose_view
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
    - "agntux-slack-commit-send"
    - "agntux-slack-commit-schedule"
    - "agntux-slack-commit-save-draft"
    - "agntux-slack-discard"
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
  mcp-server/src/tools/compose-view.ts (registered as `compose_view`)
-->

# Compose UI handler

## What this handler covers

Source: **Slack thread context** (passed by the draft skill from its working memory)
UI component: `ui://slack-compose`
View tool: `mcp__agntux-slack__compose_view`

This handler renders the **Compose** card — the inline edit surface for drafting
Slack replies. The draft skill fetches thread context, composes a reply body,
then calls `compose_view` with the structured arguments. The view tool reads the
action file (status check only), packages the agent-supplied context, and returns
`structuredContent` for the iframe.

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
| `draft a reply for action` | full compose args | Invoked by draft skill (only path) |
| `draft a reply and schedule it for action` | full compose args + `proposed_send_time` | Invoked by draft skill (only path) |

This view tool has 5 required arg objects (`action_id`, `initial_verb`,
`drafted_body`, `thread_context`, `channel`). It is not user-callable from a
generic chat prompt — the draft skill is the only path that can populate the
args from working-memory thread context fetched via `slack_read_thread`.

## structuredContent schema

See `operational.structured_content_schema` in the frontmatter.

## Send-action intents

### Committed envelope encoding

The component emits `sendFollowUpMessage(host_prompt)` when the user confirms.
The envelope shape is deterministic so the draft skill can parse it:

```
ux: Use the agntux-slack plugin to commit the drafted reply for action {action_id} with body «{edited_body}» (mode: {send|schedule|save_draft}{, send_at: {RFC3339}}).
```

Unicode guillemets `«»` delimit the body field. Literal `«` or `»` in the body
are escaped by doubling (`««`, `»»`). The draft skill parser reverses the
doubling after extracting content between the outermost `«»`.

The `send_at` clause is present only when `mode === "schedule"` and a send_at
value was selected.

### intent-key:agntux-slack-commit-send

```
ux: Use the agntux-slack plugin to commit the drafted reply for action {action_id} with body «{edited_body}» (mode: send).
```

### intent-key:agntux-slack-commit-schedule

```
ux: Use the agntux-slack plugin to commit the drafted reply for action {action_id} with body «{edited_body}» (mode: schedule, send_at: {RFC3339}).
```

### intent-key:agntux-slack-commit-save-draft

```
ux: Use the agntux-slack plugin to commit the drafted reply for action {action_id} with body «{edited_body}» (mode: save_draft).
```

### intent-key:agntux-slack-discard

```
ux: Use the agntux-slack plugin to discard the draft for action {action_id}.
```

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
