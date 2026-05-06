---
name: triage
description: UI handler for the AgntUX action-item triage component. Renders priority-sorted open action items, recent handled items, and per-action suggested-action buttons. Engage when `/agntux-triage` (interactive) routes here, or when a verb phrase below matches.
tools: Read, mcp__agntux-core__*

operational:
  catalogue_version: "2.0.0"
  verb_phrases:
    - "show triage"
    - "show my action items"
    - "what's hot"
    - "what should I look at"
    - "what's on my plate"
    - "triage me"
    - "what should I do today"
  view_tool: agntux_core_triage_view
  resource_uri: "ui://triage"
  structured_content_schema:
    # ── Open + due-soon-snoozed actions (capped at 30) ─────────────
    - "actions[].id (string — kebab-case slug from filename, no `.md` suffix)"
    - "actions[].title (string, ≤120 chars — derived from reason_detail or first sentence of why_matters)"
    - "actions[].summary (string, ≤200 chars — truncated first paragraph of ## Why this matters)"
    - "actions[].priority ('high' | 'medium' | 'low')"
    - "actions[].status ('open' | 'snoozed')"
    - "actions[].reason_class (string, kebab-case — e.g. response-needed, production-incident)"
    - "actions[].due_by (ISO date string | null)"
    - "actions[].snoozed_until (ISO datetime string | null)"
    - "actions[].source (string — e.g. slack, gmail, calendar; null if not source-bound)"
    - "actions[].related_entities (string[] — subtype/slug form, capped at 6)"
    - "actions[].suggested_actions[].label (string, ≤60 chars)"
    - "actions[].suggested_actions[].host_prompt (string — full ux: prompt, including the leading 'ux: ')"
    - "actions[].why_matters_excerpt (string, ≤600 chars — full first paragraph of ## Why this matters)"
    - "actions[].personalization_fit_excerpt (string, ≤600 chars — first 4 bullets of ## Personalization fit)"
    # ── Recently handled (last 7 days, capped at 10) ───────────────
    - "handled_recent[].id (string)"
    - "handled_recent[].title (string, ≤120 chars)"
    - "handled_recent[].priority ('high' | 'medium' | 'low')"
    - "handled_recent[].status ('done' | 'dismissed')"
    - "handled_recent[].handled_at (ISO datetime string — completed_at or dismissed_at)"
    - "handled_recent[].outcome (string | null — last ## Outcome marker, if any)"
    # ── Aggregates + state ─────────────────────────────────────────
    - "counts.open (number)"
    - "counts.snoozed (number)"
    - "counts.handled_recent (number)"
    - "counts.truncated (boolean — true if the open list exceeded 30)"
    - "last_updated_at (ISO datetime string — from actions/_index.md frontmatter)"
    - "bootstrap_mode (boolean — true when actions/_index.md is absent or entry_count is 0)"
  follow_up_intents:
    - "agntux-feedback-stop-raising"
  degraded_states:
    # `source_not_found` is the marketplace-contract canonical key (lint rule E12)
    # — required across all UI handlers. For agntux-core the data source is the
    # local AgntUX project root rather than a third-party MCP, so it maps 1:1 to
    # `actions_index_missing` below; both surface the same run-onboard CTA.
    source_not_found:
      ui: no-render
      action: "Surface 'No action items yet — your ingest plugins haven't fired. They'll show up here as soon as they do.' and direct the user to install/onboard a source plugin. Routes to the same component branch as actions_index_missing."
    actions_index_missing:
      ui: no-render
      action: "Surface 'No action items yet — your ingest plugins haven't fired. They'll show up here as soon as they do.' and direct the user to install/onboard a source plugin."
    license_paused:
      ui: no-render
      action: "Surface 'Your trial is paused. Upgrade at app.agntux.ai/billing to keep AgntUX active.' and stop."
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
  mcp-server/src/tools/triage-view.ts (registered as `agntux_core_triage_view`)

Triage is the one MCP App in this marketplace where the view-tool
handler reads the local filesystem (per the AgntUX project root) to
populate structuredContent. This is a justified deviation from the
canonical "view tools must be stateless / no fs reads" rule because
the source data IS local files — there is no third-party MCP for the
LLM to call first. The handler remains read-only (zero writes, zero
network) and stateless across calls.
-->

# Triage UI handler

## What this handler covers

Source: **AgntUX local knowledge store** (`<agntux project root>/actions/`)
UI component: `ui://triage`
View tool: `mcp__agntux-core__agntux_core_triage_view`

This handler renders the **Triage** component — the primary inline
UI for AgntUX. It surfaces priority-sorted open action items with
inline mutation controls (snooze / dismiss / done), per-item
suggested-action buttons that re-route into source plugins, and a
collapsed "recently handled" accordion.

## Verb phrases

The phrases declared in `operational.verb_phrases` follow the
catalogue convention. Every phrase routes to the same render — the
view tool takes no required arguments — so there are no runtime
slot tokens to validate.

| Phrase | Required slots | Source |
|---|---|---|
| `show triage` | none | catalogue T-1 |
| `show my action items` | none | catalogue T-1 |
| `what's hot` | none | catalogue T-1 |
| `what should I look at` | none | catalogue T-1 |
| `what's on my plate` | none | catalogue T-1 |
| `triage me` | none | catalogue T-1 |
| `what should I do today` | none | catalogue T-1 |

## Token budget

The view tool's `inputSchema` has **zero required arguments**.
Two optional caps exist for advanced callers:

- `view_handled_days?: number` (default 7, max 30) — controls the
  `handled_recent[]` time window.
- `limit?: number` (default 30, max 50) — caps `actions[]` length.

Defaults are tuned so that a typical fire produces a payload under
~30 KB. The handler enforces hard caps even when the LLM passes
larger numbers, to keep the iframe payload bounded.

## structuredContent schema

See the precise field list under `operational.structured_content_schema`
in the frontmatter. Component-side defensive defaults (per
`briefing-learnings.md` §1.1–1.2):

- Arrays default to `[]`.
- Strings default to `''`.
- Numbers default to `0`.
- Booleans for "should I show this?" default to `true` (per §1.6).
- Booleans for "should I take destructive action?" default to `false`.

Field-level rationales:

- **`actions[].suggested_actions`** — the ingest plugin pre-fills
  these in the action item file (e.g., agntux-slack writes "Draft
  a reply", "Open in Slack", "Snooze 24h"). Triage renders them as
  buttons; click → `sendFollowUpMessage(host_prompt)`. The host
  routes the prompt into the source plugin's draft skill, which
  runs the chat-confirm-then-write flow before any external call.
- **`actions[].related_entities`** — rendered as **non-interactive
  badges in v1**. Click-to-ask is a v1.1 follow-up.
- **`why_matters_excerpt` / `personalization_fit_excerpt`** —
  shown in the expanded detail drawer. Truncated server-side to
  bound the payload.
- **`bootstrap_mode`** — true when the user has installed
  agntux-core but no ingest plugin has fired yet. Component shows
  a reassuring empty state per the bootstrap-tone rules in
  `ui-designer-discipline.md`.

If the source returns a structured error, the view tool returns
`{ error: "actions_index_missing" | "license_paused" }` in
`structuredContent` and the component renders the corresponding
`degraded_states` message.

## Send-action intents

The component emits `sendFollowUpMessage(intent)` only for the
"Stop raising items like this" affordance. Inline status
mutations (snooze / dismiss / mark done) call MCP tools directly
via `useAppsClient().callTool(name, args)` (with the `agntux_core_`
prefixed tool names — see "Component → MCP tool calls" below) and
never round-trip through the model.

Suggested-action buttons emit the action item's pre-authored
`host_prompt` verbatim — those host_prompts are NOT routed
through this handler's intent table because their templates are
defined by the source plugin (e.g., agntux-slack writes the "Draft
a reply" prompt at ingest time).

### intent-key:agntux-feedback-stop-raising

Emitted when the user clicks "Stop raising items like this" on an
expanded action.

```
ux: Use the agntux-core plugin to engage the user-feedback subagent so the user can capture a `# Never raise` rule for items like {action_id} (reason_class: {reason_class}, source: {source}).
```

The component fills `{action_id}`, `{reason_class}`, and `{source}`
from the expanded action's `structuredContent`. Per the envelope
discipline in `briefing-learnings.md` §1.10:
- Addresses exactly one downstream subagent.
- No commentary.
- No `render_*` re-render request.
- Trailing one-sentence STOP clause is owned by the receiving
  subagent's prompt — this envelope hands off cleanly.

## Component → MCP tool calls (not LLM-routed)

For inline status mutations the component calls these tools
directly via `useAppsClient().callTool(...)`:

| Trigger | Tool | Args | After success |
|---|---|---|---|
| "Done" button | `agntux_core_set_status` | `{ id, status: 'done', outcome?: 'completed-externally' \| ... }` | re-call `agntux_core_triage_view`, optimistic-strike-through until refresh |
| "Snooze 24h" preset | `agntux_core_snooze` | `{ id, until: <now+24h ISO> }` | re-call `agntux_core_triage_view` |
| "Snooze (custom)" with date picker | `agntux_core_snooze` | `{ id, until: <user-picked ISO> }` | re-call `agntux_core_triage_view` |
| "Dismiss" with outcome | `agntux_core_dismiss` | `{ id, outcome: 'noise' \| 'irrelevant' \| 'completed-externally' \| <free-form>, outcome_note?: string }` | re-call `agntux_core_triage_view`, append to handled_recent |

The component caches the in-flight tool call's `id` in
`useState<string \| null>()` (per `briefing-learnings.md` §1.12) so
the row can show its own loading/success/error state without
blocking other rows.

## Degraded states

| Key | ui | Action |
|---|---|---|
| `actions_index_missing` | no-render | Surface "No action items yet — your ingest plugins haven't fired. They'll show up here as soon as they do." Suggest installing a source plugin via the host's marketplace. |
| `license_paused` | no-render | Surface "Your trial is paused. Upgrade at app.agntux.ai/billing to keep AgntUX active." |

`no-render` means the component does NOT attempt a partial render.
It shows only the degraded-state message.

## Distribution

Component bundle is embedded into the compiled MCP server at build
time via `mcp-server/scripts/embed-bundle.mjs` — see the canonical
`_template/` for the build pipeline. There is **no S3 fetch**;
the previous distribution model was retired in `agntux-core@5.0.0`
along with the entity-browser surface.
