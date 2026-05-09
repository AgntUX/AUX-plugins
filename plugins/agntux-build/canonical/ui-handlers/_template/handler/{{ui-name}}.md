---
name: {{ui-name}}
description: Render the {{ui-display-name}} UI component, populated with {{primary-payload-fields}}. Engage when the SKILL.md routes a "{{primary-verb-phrase}}" request here.
tools: Read, mcp__{{source-mcp-prefix}}__*, mcp__{{plugin-slug}}-ui__*

operational:
  catalogue_version: "1.0"
  verb_phrases:
    - "{{primary-verb-phrase}}"
    # Add additional verb phrases the host should route here.
    # Each phrase is matched verbatim by the click-time drafting step;
    # use single-curly tokens like {ref} for runtime slots (NOT P6-substituted).
  view_tool: {{view-tool-name}}
  resource_uri: "ui://{{ui-name}}"
  structured_content_schema:
    # List the field names the view tool returns under structuredContent.
    # The component reads each via toolOutput.<field>; every field MUST default
    # defensively (see canonical/prompts/ui/state-management.md and
    # canonical/prompts/ui/briefing-learnings.md §1.1–1.2).
    - {{field-1}}
    - {{field-2}}
  compose_payload_supported: false   # set true when this handler reads a `## Compose payload` body section at click time (dual-mode resolution per draft-flow-author §2b)
  follow_up_intents:
    # One key per send-action the component emits via sendFollowUpMessage.
    # Naming convention (see manifest-author § "Connector-targeted intent
    # naming"):
    #   - `{source}-connector-{verb}` — connector-targeted envelopes
    #     addressing the user's host-installed connector directly with all
    #     required arguments inline (modern default for any UI-handler plugin).
    #     Example: `slack-connector-send`, `linear-connector-comment`.
    #   - `{verb}-{adjective}-local` — pure local actions that do NOT
    #     round-trip to chat. Example: `compose-discard-local`.
    #   - `{verb}-{noun}` — legacy chat-confirm flow keys. Don't author new
    #     keys in this shape.
    - {{intent-key-1}}      # e.g. {{source-slug}}-connector-send
  degraded_states:
    source_not_found:
      ui: "no-render"
      action: "Surface 'That {{source-noun}} is no longer available'; offer mark-done button."
    source_auth_failed:
      ui: "no-render"
      action: "Surface 'Couldn't fetch {{source-noun}} data — check your {{source-display}} MCP connection'."
    {{additional-degraded-state}}:
      ui: "no-render"
      action: "{{degraded-state-action}}"
---

<!--
RENDER-ONLY DISCIPLINE — READ BEFORE EDITING
=============================================
This handler's body is NOT executed as a runtime subagent prompt.
UI rendering happens via the stateless view tool declared in
`operational.view_tool` above. The body below is METADATA ONLY — it
documents the handler's contract and serves as developer reference.

Handler subagent files at agents/ui-handlers/{name}.md exist as metadata carriers:
  - The YAML frontmatter carries the operational manifest.
  - The body documents verb phrases, structuredContent schema, and send-action intents.
  - NO subagent is spawned from this file at runtime.
  - NO source MCP calls happen from this file.
  - NO file writes happen from this file.

The actual rendering is performed by the view tool at:
  canonical/ui-handlers/{{ui-name}}/mcp-server/src/tools/{{ui-name}}-view.ts
  (per-plugin: mcp-server/src/tools/{{view-tool-name}}.ts)

View tools are stateless: they accept args, build structuredContent, return
_meta.ui.resourceUri. Zero network calls, zero file writes, zero source MCP calls.

Build-time placeholders the scaffolder substitutes:
  {{plugin-slug}}      — kebab-case plugin slug; from manifest `name` field (e.g., "agntux-slack")
  {{ui-name}}          — kebab-case UI handler name (e.g., "slack-thread")
  {{view-tool-name}}   — snake_case + "_view" (e.g., "slack_thread_view")
  {{ui-display-name}}  — human-readable display name (e.g., "Slack thread")
  {{source-mcp-prefix}}— source MCP prefix to allow-list in `tools:` (e.g., "slack")

Single-curly tokens like {ref}, {ids}, {text}, {action_id} are runtime/host-filled —
NOT scaffolder-substituted. They appear inside verb_phrases and intent templates only.
-->

# {{ui-display-name}} UI handler

## What this handler covers

Source: **{{source-display}}**
UI component: `ui://{{ui-name}}`
View tool: `mcp__{{plugin-slug}}-ui__{{view-tool-name}}`

This handler renders the **{{ui-display-name}}** component. It is triggered when
the host's click-time drafting step dispatches a prompt matching one of the verb
phrases in `operational.verb_phrases` above.

## Verb phrases

The phrases declared in `operational.verb_phrases` follow the catalogue convention
(verb + slot tokens). Each row below documents the required runtime slots and the
source of the phrase shape.

| Phrase | Required slots | Source |
|---|---|---|
| `{{primary-verb-phrase}}` | `{ref}` | catalogue D-1 |

Slot tokens like `{ref}` must satisfy the source's identifier format. If a
slot is malformed or absent, surface one sentence describing what was missing
and suggest the closest matching action item.

## structuredContent schema

Fields returned by `{{view-tool-name}}` in `structuredContent`. The component
reads these via `useToolResult()`. Every field MUST default defensively
(arrays → `[]`, strings → `''`, numbers → `0` or a sentinel) because the envelope
is also synthesised from streaming `tool-input-partial` notifications during the
1–3s before `tool-result` arrives.

| Field | Type | Description |
|---|---|---|
| `{{field-1}}` | {{type-1}} | {{description-1}} |
| `{{field-2}}` | {{type-2}} | {{description-2}} |

If the source returns an error (auth failure, item not found, network), the view
tool returns `{ error: "auth_failed" | "not_found" | "network" }` in
structuredContent and does NOT proceed with a partial render. The component
renders the corresponding `degraded_states` message.

## Send-action intents

The component emits `sendFollowUpMessage(intent)` when the user confirms an
action. Each intent key below MUST appear as a `## intent-key:{name}` heading
in the plugin's SKILL.md.

### intent-key:{{intent-key-1}}

```
{{intent-prompt-template}}
```

Follow the envelope discipline from `briefing-learnings.md` §1.10:
- Address exactly one tool call.
- Forbid commentary.
- Forbid `render_*` re-renders.
- End with a single-sentence STOP clause.

`<ISO now>` is a literal placeholder — the host substitutes ISO 8601 UTC at
file-edit time. Do NOT pre-fill on the component side (clock skew between
iframe and host is unspecified).

## Degraded states

| Key | ui | action |
|---|---|---|
| `source_not_found` | no-render | Surface "That {{source-noun}} is no longer available"; offer mark-done button. |
| `source_auth_failed` | no-render | Surface "Couldn't fetch {{source-noun}} data — check your {{source-display}} MCP connection". |
| `{{additional-degraded-state}}` | no-render | {{degraded-state-action}} |

`no-render` means the component does NOT attempt a partial render. It shows
only the degraded-state message and (for `source_not_found`) a single
"Mark done" affordance that emits a sendFollowUpMessage delegating cleanup
to the host.
