---
name: {{ui-handler-name}}
description: Render the {{ui-handler-display-name}} UI component for {{source-display-name}}, populated with source data and any orchestrator-drafted content. Engage when the SKILL.md routes a "{{primary-verb-phrase}}" request here.
tools: Read, mcp__{{source-slug}}__*, mcp__{{plugin-slug}}-ui__*

operational:
  catalogue_version: "1.0"
  verb_phrases:
    - "{{primary-verb-phrase}}"
    - "{{primary-verb-phrase}}, highlight: {ids}"
    - "{{primary-verb-phrase}}, propose reply: {text}"
    - "{{primary-verb-phrase}}, highlight: {ids}, propose reply: {text}"
  view_tool: {{ui-name}}_view
  resource_uri: "ui://{{ui-name}}"
  structured_content_schema:
    - {{structured-content-field-1}}
    - {{structured-content-field-2}}
    - {{structured-content-field-3}}
    - action_id
    - source_ref
  follow_up_intents:
    - {{primary-intent-key}}
  degraded_states:
    source_not_found:
      ui: "no-render"
      action: "Surface 'That {{source-display-name}} item is no longer available'; offer mark-done button."
    source_auth_failed:
      ui: "no-render"
      action: "Surface 'Couldn't fetch {{source-display-name}} data — check your {{source-display-name}} MCP connection'."
    draft_text_invalid:
      ui: "no-render"
      action: "Surface 'The orchestrator drafted incomplete content — try again'."
---

<!--
Build-time placeholders (P6 substitutes from per-source spec / plugin.json):

  {{plugin-slug}}                — kebab-case plugin slug; from manifest `name` field
  {{source-display-name}}        — human-readable label (e.g., "Slack"); from per-source spec
  {{source-slug}}                — short source identifier; appears in entity source maps,
                                    action-item `source:` fields, and `data/learnings/{{plugin-slug}}/sync.md`
  {{ui-handler-name}}            — kebab-case handler name (e.g., "slack-thread"); from per-source spec
  {{ui-handler-display-name}}    — human-readable handler name (e.g., "Slack thread"); from per-source spec
  {{ui-name}}                    — view-tool root name (e.g., "thread", "channel-summary"); from per-source spec
  {{primary-verb-phrase}}        — the canonical verb phrase from P9 §7.2 or a plugin-novel phrase;
                                   use lower-case prose, include {ref}; from per-source spec
  {{structured-content-field-1}} — first top-level field returned in structuredContent; from per-source spec
  {{structured-content-field-2}} — second field; from per-source spec
  {{structured-content-field-3}} — third field; from per-source spec
  {{primary-intent-key}}         — the send-action intent key declared in SKILL.md ## intent-key:{name};
                                   from per-source spec (e.g., "send-thread-reply")

Single-curly tokens like {ref}, {ids}, {text}, {action_id}, {source_ref} are runtime/host-filled —
NOT P6-substituted. They appear inside verb_phrases and intent templates only.

STUBS.md in canonical/prompts/ingest/ documents the full placeholder registry.
-->

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
  mcp-server-templates/ingest/src/tools/{{ui-name}}-view.ts (template)
  (per-plugin: mcp-server/src/tools/{{ui-name}}_view.ts)

View tools are stateless: they accept args, build structuredContent, return
_meta.ui.resourceUri. Zero network calls, zero file writes, zero source MCP calls.
-->

# {{ui-handler-display-name}} UI handler

## What this handler covers

Source: **{{source-display-name}}**
UI component: `ui://{{ui-name}}`
View tool: `mcp__{{plugin-slug}}-ui__{{ui-name}}_view`

This handler renders the **{{ui-handler-display-name}}** component. It is triggered when
ux's click-time drafting step dispatches a Lane B prompt matching one of the verb phrases
in `operational.verb_phrases` above.

## Verb phrases

The phrases declared in `operational.verb_phrases` follow the P9 §7.2 catalogue where
a matching seed phrase exists. Plugin-novel phrases (source-specific UI surfaces that
have no §7.2 equivalent) are free-form, lower-case prose, and MUST include `{ref}`.

| Phrase | Required slots | Source |
|---|---|---|
| `{{primary-verb-phrase}}` | `{ref}` | P9 §7.2 D-1 variant or plugin-novel |
| `{{primary-verb-phrase}}, highlight: {ids}` | `{ref}`, `{ids}` | optional highlight slot |
| `{{primary-verb-phrase}}, propose reply: {text}` | `{ref}`, `{text}` | optional drafted slot |
| `{{primary-verb-phrase}}, highlight: {ids}, propose reply: {text}` | `{ref}`, `{ids}`, `{text}` | all optional slots |

`{ref}` must be a valid {{source-display-name}}-native identifier (see P9 §7.4 format hints).
If `{ref}` is malformed or absent, surface one sentence describing what was missing and
suggest the closest matching action item.

## structuredContent schema

Fields returned by `{{ui-name}}_view` in `structuredContent`. The component reads these
via `useToolResult()`. Every field MUST default defensively (arrays → `[]`, strings → `''`)
because the envelope is also synthesised from streaming `tool-input-partial` notifications
during the 1–3s before `tool-result` arrives.

| Field | Type | Description |
|---|---|---|
| `{{structured-content-field-1}}` | array | Primary source data for this UI |
| `{{structured-content-field-2}}` | array | Secondary source data (members, participants, etc.) |
| `{{structured-content-field-3}}` | string | Orchestrator-authored content slot (reply, summary, etc.) |
| `action_id` | string | Forwarded into the follow-up intent |
| `source_ref` | string | Opaque {{source-display-name}}-native reference |

If the source returns an error (auth failure, item not found, network), the view tool
returns `{ error: "auth_failed" | "not_found" | "network" }` in structuredContent and
does NOT proceed with a partial render. The component renders the corresponding
`degraded_states` message.

## Send-action intents

The component emits `sendFollowUpMessage(intent)` when the user confirms a state-mutating
action (e.g., Send button). Each intent key below MUST appear as a
`## intent-key:{name}` heading in the plugin's SKILL.md (P9 §8.1).

### intent-key:{{primary-intent-key}}

```
{Imperative summary sentence — e.g., "User confirmed sending this reply..."}:
---
{Verbatim user-edited content}
---
After {expected source MCP call} succeeds, do ALL of the following silently:
1. Edit <agntux project root>/actions/{action_id}.md — set status=done and completed_at=<ISO now> in frontmatter.
2. Append to body section "## Resolution log":
   - <ISO now> — {action description}. {result details}
3. Do not emit any further tool calls or assistant text.
```

`<ISO now>` is a literal placeholder — the host substitutes ISO 8601 UTC at file-edit
time. Do NOT pre-fill on the component side (clock skew between iframe and host is
unspecified per P9 §8.2).

## Degraded states

| Key | ui | action |
|---|---|---|
| `source_not_found` | no-render | Surface "That {{source-display-name}} item is no longer available"; offer mark-done button. |
| `source_auth_failed` | no-render | Surface "Couldn't fetch {{source-display-name}} data — check your {{source-display-name}} MCP connection". |
| `draft_text_invalid` | no-render | Surface "The orchestrator drafted incomplete content — try again". |

`no-render` means the component does NOT attempt a partial render. It shows only the
degraded-state message and (for `source_not_found`) a single "Mark done" button that
emits `sendFollowUpMessage("ux: Use the agntux-core plugin to mark action item {action_id} done")`.
