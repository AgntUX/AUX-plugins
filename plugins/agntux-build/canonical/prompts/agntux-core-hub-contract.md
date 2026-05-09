# The agntux-core hub contract

`agntux-core` is the **central hub plugin** in the AgntUX marketplace. Source
plugins (`agntux-slack`, `agntux-gmail`, `agntux-linear`, …) feed the hub;
the hub renders the unified triage list view, dispatches suggested-action
buttons, and owns the action-mutation surface.

This file documents what the hub renders for free and what your source plugin
must emit to consume the hub correctly. If a behaviour described here surprises
you while authoring a source plugin, the hub probably owns it — don't
re-implement it inside your plugin.

The asymmetry matters because the toolkit's other agent specs treat plugins
generically, but a source plugin authored without knowing the hub contract
either re-builds capabilities the hub already provides (waste) or emits the
wrong shape and the hub silently ignores it (correctness bug). Read this
section before scaffolding any source plugin's UI handler or
`suggested_actions` block.

---

## 1. What `agntux-core` renders (you DON'T ship)

The hub plugin's triage handler reads every source plugin's
`<root>/actions/{YYYY-MM-DD}-{slug}.md` files and renders them in a single
unified list view. Source plugins do **not** ship their own list view — they
emit action files to disk in the contracted shape and the hub takes care of
display.

What the hub provides for free:

- **Triage list view** at `<plugin-toolkit-root>/agntux-core/ui-handlers/triage/`
  — sortable, paginated, deduplicated across sources.
- **Suggested-action button row** on every action card. Each button supports
  **dual dispatch**:
  - `host_prompt` → routed via `client.sendFollowUpMessage()`. Used for
    composition / chat-style verbs (`Draft a reply`, `Summarise to canvas`).
  - `url` → routed via `client.openLink()`. Used for stable deep links
    (`Open in Slack`, `Open in Linear`). The hub validates the URL is a safe
    scheme (only `https:` and `http:`; `javascript:`, `data:`, `file:` are
    rejected).
- **Inline expansion panels** anchored to action rows for action card
  details / snooze / dismiss / "Do something else" — replacing the older
  centred-modal pattern.
- **In-list feedback rows** for status mutations (replacing toasts):
  `✓ Marked done · {action title}` appears in the slot the resolved item
  vacated, then drops out after ~5 seconds. Preserves the user's scroll
  position in the list.
- **Optimistic-hide** for terminating prompts (`set_status`, `dismiss`,
  `snooze`): clicked items vanish from the list immediately, before the
  status mutation round-trips, so the user sees instant feedback.
- **Sort dropdown** (Priority / Due date / Most recently created).
- **"Send prompt" CTA** on every card for free-form follow-ups (renamed from
  the older "Send to AgntUX" copy in agntux-core 6.1.0+).

You should not duplicate any of this inside a source plugin's UI handler —
even if your plugin ships its own UI handler for a specific compose/canvas
flow, the triage view itself stays in the hub.

## 2. What a source plugin emits to consume the hub

The hub reads what your sync skill writes to disk. The shape contract:

### Entity files

```
<root>/entities/{subtype}/{slug}.md
```

Frontmatter must conform to the schema-as-runtime contract approved by the
data-architect (see `manifest-author.md` and `skills/author/SKILL.md` §3).
The hub does not touch these directly — it walks them via
`<root>/entities/_sources.json` (which the PostToolUse `maintain-index.mjs`
hook upserts after every entity Write). Your plugin reads `_sources.json`;
never writes to it.

### Action files

```
<root>/actions/{YYYY-MM-DD}-{slug}.md
```

Required frontmatter fields (the hub renders from these):

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable slug; used for action-mutation MCP calls. |
| `priority` | enum | `high` / `medium` / `low`. Drives the sort dropdown's Priority order. |
| `reason_class` | enum | One of the closed `action_classes` from `schema.lock.json` (currently `deadline`, `response-needed`, `knowledge-update`, `risk`, `opportunity`, `other`). The hub colour-codes the card by class. |
| `reason_detail` | free text | Sub-categorisation. Bracketed prefix tags are conventional (`[dm] direct message…`). |
| `source` | string | Bare source slug (e.g. `slack`, `linear`). Must equal `{{plugin-slug}}` minus the `agntux-` prefix. |
| `source_ref` | string | Stable cross-source reference back to the source artefact (Slack thread id, Linear issue key, etc.). |
| `related_entities` | array | Entity slugs this action relates to (cross-references). |
| `created_at` | ISO 8601 UTC | The hub's "Most recently created" sort key. |
| `suggested_actions` | array of objects | See dispatch shape below. |

Optional frontmatter:

| Field | Type | Notes |
|---|---|---|
| `due_at` | ISO 8601 UTC | If present, drives the "Due date" sort. |
| `status` | enum | `open` (default) / `snoozed` / `done` / `dismissed`. Set via `agntux-core`'s MCP tools, not direct edits. |
| `snoozed_until` | ISO 8601 UTC | Required when `status: snoozed`. |
| `outcome` | string | Set by `set_status`/`dismiss` when terminating. See action-mutation tools below. |

### Suggested-action shape

```yaml
suggested_actions:
  - label: "Draft a reply"
    host_prompt: "ux: Use the agntux-slack plugin to open the reply composer for action {id}"
  - label: "Open in Slack"
    url: "https://acme.slack.com/archives/C012345/p1714400000000200"
```

Each suggested action MUST carry `label` plus exactly one of `host_prompt`
or `url` (not both). The hub dispatches:

- `host_prompt`-only → `client.sendFollowUpMessage(host_prompt_minus_ux_prefix)`.
- `url`-only → `client.openLink(url)` if the URL is a safe scheme.

Optional `## Compose payload` / `## Canvas payload` body sections (see §4)
let UI-handler plugins lift inline args at click time without re-fetching
context.

## 3. Action-mutation MCP tools (agntux-core owns these)

Source plugins **read** these — they don't define them. Hub-published
mutation surface:

- `mcp__agntux-core__agntux_core_set_status({ action_id, status, outcome?, outcome_note? })`
  — flip status to `open` / `snoozed` / `done` / `dismissed`. When the
  transition is to `done` or `dismissed`, the hub appends a structured
  `## Outcome` section to the action body using the optional `outcome` +
  `outcome_note` arguments.
- `mcp__agntux-core__agntux_core_dismiss({ action_id, outcome?, outcome_note? })`
  — convenience wrapper for `set_status` with `status: dismissed`.
- `mcp__agntux-core__agntux_core_snooze({ action_id, until })`
  — sets `status: snoozed` plus `snoozed_until: until` (ISO 8601 UTC).
- `mcp__agntux-core__agntux_core_pivot({ entity_slug })`
  — entity cross-reference navigation.

(Tool names are prefixed with the plugin slug post-agntux-core 6.0.0; the
older bare names like `mcp__agntux-core__set_status` are retired.)

Your plugin's drafting flow (or your UI handler's commit step) calls these
when the action's lifecycle resolves. **Don't direct-Edit action
frontmatter** — the hub's tool handles atomic mutation, the optional
`## Outcome` body append, and the index regeneration in one call.

`outcome` values are conventional but not enum-locked at the runtime layer.
Recommended values:

- `completed-externally` — the user already handled the action in the
  source (replied in Slack manually, etc.).
- `noise` — false positive; the source signal didn't actually warrant a
  user-facing item.
- `irrelevant` — fine signal but not relevant to *this* user's workflow.

Bare dismissals (no `outcome`) are bucketed by the hub as **ambiguous** and
excluded from `pattern-feedback` learning signals. If your plugin's
`suggested_actions` carry outcome-revealing copy (`"Stop raising items like
this"` vs `"Snooze for a week"`), encode the outcome in the `host_prompt`
so the drafting flow can pass it through.

## 4. Two write-back patterns for source plugins

When the user takes action *back into the source* (sends a Slack reply,
schedules a Linear comment, drafts a Gmail response), the source plugin owns
the write call. There are two sanctioned patterns:

### Primary — UI-handler plugins use connector-targeted envelopes

The plugin ships a UI handler with a Send-style commit button. The button is
the **explicit authorisation gate**: clicking Send is the moment of consent.
The component emits a connector-targeted envelope addressing the user's
host-installed connector directly with all required arguments inline.

See `${CLAUDE_PLUGIN_ROOT}/canonical/prompts/ui/connector-envelopes.md` for
the full envelope shape, escaping rules, and worked examples. The reference
shape:

```
Use the {Source} Connector to {verb} a {Source} {object} as {qualifier}.
{required_field}: {value}, {required_field}: {value}.
Body: «{user_text}». ({metadata})
```

This is the **default** pattern for any source plugin with a UI handler and
write tools. It supersedes the older `ux: Use the {plugin-slug} plugin to
draft a reply…` envelopes that routed to the now-retired `skills/draft/`
flow (see §5 "Anti-patterns").

### Legacy — chat-only plugins use the chat-confirm-then-write skill

When a source plugin has write tools but **no UI handler** (rare today), the
write flow lives in a top-level `skills/draft/SKILL.md` skill that draws
from `${CLAUDE_PLUGIN_ROOT}/skills/author/templates/draft-skill.md`.
The skill receives a `ux: Use the {plugin-slug} plugin to draft …` envelope,
parses the action id and verb, fetches fresh context, drafts the payload,
shows it in chat, and prompts `Send this now? (yes / no / edit)`. Only an
explicit `yes` turn permits the write.

The chat-confirm pattern is the older flow, retained for chat-only sources.
For any plugin shipping a UI handler, prefer the connector-envelope pattern
above — the iframe Send button is a stronger, more visible authorisation
gate than a chat round-trip.

## 5. The url field — safe-scheme contract

When a `suggested_action` carries a `url` (not `host_prompt`), the hub
validates the URL **before** dispatching to `client.openLink()`. Only
`https:` and `http:` schemes are accepted; `javascript:`, `data:`, and
`file:` URLs are rejected and silently dropped (the button still renders
and clicks become no-ops).

Source plugins emit; the hub validates. You don't need to URL-encode beyond
standard practice — the hub treats the value as a literal href and the
host's `openLink` API handles the navigation. Your responsibility is to
construct the URL from authoritative source-side identifiers (e.g. Slack
permalink built from `workspace_subdomain` + `channel_id` + `thread_ts`,
captured once during ingest discovery — see `source-semantics-advisor.md`
§5 "Deep-link templates" for the per-source recipes).

If the URL is dynamic and you don't have all parts at action-write time,
omit the `url` field and rely on `host_prompt` instead. A missing `url` is
better than a no-op button.

---

## Anti-patterns

- **Building your own list view in a source plugin.** The hub renders the
  unified triage list across all sources. A plugin-local list view
  duplicates effort and competes with the canonical surface.
- **Direct-editing action frontmatter from your plugin's drafting flow.**
  Use the `mcp__agntux-core__agntux_core_set_status` tool — it handles atomic
  mutation, `## Outcome` body append, and index regeneration in one call.
- **Emitting `ux: Use the {plugin-slug} plugin to draft a reply…`
  envelopes when your plugin has a UI handler.** Those envelopes route to
  the retired chat-confirm flow. Use connector-targeted envelopes from the
  iframe Send button instead — see `connector-envelopes.md`.
- **Embedding `javascript:` / `data:` / `file:` URLs in
  `suggested_actions[].url`.** The hub silently drops them. Use
  `host_prompt` for any non-https flow.
- **Pre-filling the action body's `## Compose payload` with stale data.**
  The fresher you author it (per-ingest), the better the click-time
  experience. See `ingest-prompt-author.md` Step 10.1.

---

## Where this fits in the toolkit

- `manifest-author` § Suggested actions cite this file when explaining the
  `host_prompt` vs `url` choice.
- `ingest-prompt-author` Step 10.1 cites §2's "Suggested-action shape" when
  documenting the optional `url` field.
- `draft-flow-author` §1 cites §4 (the two write-back patterns) when
  picking a gate.
- `ui-handler-author` §6 (view tool wiring) cites §4's primary pattern
  when explaining connector-envelope dispatch.
- `agntux-core-hub-contract.md` (this file) is read by the orchestrator
  `skills/author/SKILL.md` §2 contract table.
