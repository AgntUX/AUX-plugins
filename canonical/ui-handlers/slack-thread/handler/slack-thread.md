---
name: slack-thread
description: Render the Slack thread UI component for Slack, populated with thread messages and any orchestrator-drafted proposed reply. Engage when the SKILL.md routes a "display the slack thread UI for {ref}" request here.
tools: Read, mcp__slack__*, mcp__{{plugin-slug}}-ui__*

operational:
  catalogue_version: "1.0"
  verb_phrases:
    - "display the slack thread UI for {ref}"
    - "display the slack thread UI for {ref}, highlight: {ids}"
    - "display the slack thread UI for {ref}, propose reply: {text}"
    - "display the slack thread UI for {ref}, highlight: {ids}, propose reply: {text}"
    - "reply to {ref}"
    - "respond to {ref}"
    - "post message in {ref}"
    - "post reply to {ref}"
  view_tool: slack_thread_view
  resource_uri: "ui://slack-thread"
  structured_content_schema:
    - thread_messages
    - thread_members
    - highlighted_msg_ids
    - proposed_reply
    - action_id
    - channel_id
    - channel_name
  follow_up_intents:
    - send-thread-reply
  degraded_states:
    source_not_found:
      ui: "no-render"
      action: "Surface 'That Slack thread is no longer available'; offer mark-done button."
    source_auth_failed:
      ui: "no-render"
      action: "Surface 'Couldn't fetch Slack data — check your Slack MCP connection'."
    draft_text_invalid:
      ui: "no-render"
      action: "Surface 'The orchestrator drafted incomplete reply text — try again'."
---

<!--
RENDER-ONLY DISCIPLINE — READ BEFORE EDITING
=============================================
This handler's body is NOT executed as a runtime subagent prompt (P9 §7 note).
UI rendering happens via the stateless view tool declared in `operational.view_tool`
above. The body below is METADATA ONLY — it documents the handler's contract and
serves as developer reference.

Handler subagent files at agents/ui-handlers/{name}.md exist as metadata carriers:
  - The YAML frontmatter carries the operational manifest (P9 §5).
  - The body documents verb phrases, structuredContent schema, and send-action intents.
  - NO subagent is spawned from this file at runtime.
  - NO source MCP calls happen from this file.
  - NO file writes happen from this file.

The actual rendering is performed by the view tool at:
  canonical/ui-handlers/slack-thread/mcp-server/src/tools/slack-thread-view.ts
  (per-plugin: mcp-server/src/tools/slack_thread_view.ts)

View tools are stateless: they accept args, build structuredContent, return
_meta.ui.resourceUri. Zero network calls, zero file writes, zero source MCP calls.

Build-time placeholders (P6 substitutes from per-source spec / plugin.json):
  {{plugin-slug}}   — kebab-case plugin slug; from manifest `name` field (e.g., "slack-ingest")

Single-curly tokens {ref}, {ids}, {text}, {action_id} are runtime/host-filled —
NOT P6-substituted. They appear inside verb_phrases and intent templates only.
-->

# Slack thread UI handler

## What this handler covers

Source: **Slack**
UI component: `ui://slack-thread`
View tool: `mcp__{{plugin-slug}}-ui__slack_thread_view`

This handler renders the **Slack thread** component. It is triggered when
ux's click-time drafting step dispatches a Lane B prompt matching one of the verb phrases
in `operational.verb_phrases` above.

## Verb phrases

The phrases declared in `operational.verb_phrases` follow the P9 §7.2 catalogue (D-1 variant)
plus the four shorthand verb phrases declared in the T22 task spec.

| Phrase | Required slots | Source |
|---|---|---|
| `display the slack thread UI for {ref}` | `{ref}` | P9 §7.2 D-1 |
| `display the slack thread UI for {ref}, highlight: {ids}` | `{ref}`, `{ids}` | P9 §7.2 D-1 with highlight slot |
| `display the slack thread UI for {ref}, propose reply: {text}` | `{ref}`, `{text}` | P9 §7.2 D-1 with propose-reply slot |
| `display the slack thread UI for {ref}, highlight: {ids}, propose reply: {text}` | `{ref}`, `{ids}`, `{text}` | P9 §7.2 D-1 full |
| `reply to {ref}` | `{ref}` | T22 shorthand |
| `respond to {ref}` | `{ref}` | T22 shorthand |
| `post message in {ref}` | `{ref}` | T22 shorthand |
| `post reply to {ref}` | `{ref}` | T22 shorthand |

`{ref}` must be a valid Slack `thread_ts` — digits-dot-digits format (e.g., `1714043640.001200`).
If `{ref}` is malformed or absent, surface one sentence describing what was missing and
suggest the closest matching action item.

## structuredContent schema

Fields returned by `slack_thread_view` in `structuredContent`. The component reads these
via `useToolResult()`. Every field MUST default defensively (arrays → `[]`, strings → `''`)
because the envelope is also synthesised from streaming `tool-input-partial` notifications
during the 1–3s before `tool-result` arrives.

| Field | Type | Description |
|---|---|---|
| `thread_messages` | array of `{ id, ts, user_id, text }` | Messages in the thread, ordered oldest-first |
| `thread_members` | array of `{ user_id, name, real_name }` | Participants looked up from Slack |
| `highlighted_msg_ids` | array of strings | Message IDs to visually highlight |
| `proposed_reply` | string | Orchestrator-authored draft reply (may be empty) |
| `action_id` | string | Forwarded from action item for use in follow-up intent |
| `channel_id` | string | Slack channel ID (e.g., `C09ABCDEF`) |
| `channel_name` | string | Human-readable channel name (e.g., `acme-renewal`) |

If the source returns an error (auth failure, item not found, network), the view tool
returns `{ error: "auth_failed" | "not_found" | "network" }` in structuredContent and
does NOT proceed with a partial render. The component renders the corresponding
`degraded_states` message.

## Send-action intents

The component emits `sendFollowUpMessage(intent)` when the user clicks Send (confirmed).
Each intent key below MUST appear as a `## intent-key:{name}` heading in the plugin's
SKILL.md (P9 §8.1).

### intent-key:send-thread-reply

```
User confirmed sending this Slack reply to thread {thread_ts} in channel {channel_id} (#{channel_name}):
---
{final reply text — verbatim from textarea}
---
After posting via mcp__slack__post_message succeeds, do ALL of the following silently:
1. Edit ~/agntux-code/actions/{action_id}.md — set status=done and completed_at=<ISO now> in frontmatter.
2. Append to body section "## Resolution log":
   - <ISO now> — Sent reply via slack. permalink: <permalink from step 0>
3. Do not emit any further tool calls or assistant text.
```

`<ISO now>` is a literal placeholder — the host substitutes ISO 8601 UTC at file-edit
time. Do NOT pre-fill on the component side (clock skew between iframe and host is
unspecified per P9 §8.2).

## Degraded states

| Key | ui | action |
|---|---|---|
| `source_not_found` | no-render | Surface "That Slack thread is no longer available"; offer mark-done button. |
| `source_auth_failed` | no-render | Surface "Couldn't fetch Slack data — check your Slack MCP connection". |
| `draft_text_invalid` | no-render | Surface "The orchestrator drafted incomplete reply text — try again". |

`no-render` means the component does NOT attempt a partial render. It shows only the
degraded-state message and (for `source_not_found`) a single "Mark done" button that
emits `sendFollowUpMessage("ux: Use the agntux-core plugin to mark action item {action_id} done")`.
