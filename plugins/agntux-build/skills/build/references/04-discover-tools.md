# Stage 4 — discover what the connector can do

The connector is connected; now we look at what it exposes. The goal
is a plain-language summary the user can confirm — *"here's what your
new plugin will be able to read, and what it'll be able to do."*

## Read the tool inventory

The host exposes the connector's tools under a namespaced prefix —
typically `mcp__claude_ai_{ConnectorName}__{tool}` (Slack, Gmail,
Linear, etc.) or `mcp__{slug}__{tool}` for npm-installed servers.

Use `ToolSearch` with the connector display name as the query, with
`max_results: 30` so the full inventory comes back. For each tool,
read the `description` field — that's the connector's own plain
description.

## When the inventory came back empty (Cowork recovery path)

If `ToolSearch` returns zero matches for the connector display name,
the connector probably isn't authorized — stage 3 either skipped or
the auth lapsed. Before walking the user back through manual auth,
try the Cowork MCP registry as a recovery path:

1. Resolve the registry tools:
   `ToolSearch({query: "select:mcp__mcp-registry__search_mcp_registry,mcp__mcp-registry__suggest_connectors", max_results: 5})`.
2. If `search_mcp_registry` resolves, call it with
   `{keywords: ["{connector-display-name}"]}`. The result shows which
   connectors match and whether each is already connected.
3. If a matching connector exists but `connected` is false, render
   `mcp__mcp-registry__suggest_connectors({uuids: ["{directoryUuid}"], keywords: ["{connector-display-name-lowercase}"]})`.
   The card shows a Connect button right in the chat — one click and
   the user is back through auth. After the user clicks Connect, re-run
   the tool-inventory `ToolSearch` from the top of this section.
4. If neither registry tool resolves (non-Cowork host) or the
   connector isn't in the registry at all, fall through to the
   existing flow: tell the user *"{connector-display-name} doesn't
   look connected right now — let's reconnect quickly"* and re-load
   [`03-connect-source.md`](03-connect-source.md). Don't reference
   "stage 3" or any stage number in user-facing prose — silent
   transitions, same as everywhere else in this skill.

Never narrate the registry-tool resolution itself ("I'll check the
MCP registry…") — silent lookup, card-or-prose handoff. Same voice
rule as everywhere else in this skill.

## Categorise

Group the tools into three buckets:

1. **Read** — tools that fetch data without side effects. Names
   typically `list_*`, `get_*`, `search_*`, `read_*`. These power the
   sync flow — the new plugin runs these on a cadence to populate
   the user's knowledge store.
2. **Write** — tools that create / update / delete on the source.
   Names typically `send_*`, `create_*`, `update_*`, `comment_*`,
   `transition_*`, `complete_*`. These power the action buttons —
   one UI handler per meaningful verb (see stage 5).
3. **Auth / meta** — `whoami`, `authenticate`, `complete_authentication`.
   Don't surface to the user; we use these only for stage 3.

If the inventory is large (10+ tools per bucket), trim to the
load-bearing ones. Bias toward what a knowledge worker actually does
in this system — for Slack that's reading DMs/threads/mentions and
sending replies; for Linear that's reading issues/comments/cycles
and commenting/transitioning.

## Translate to plain language

Write a 3–6 line summary, each line one sentence. Avoid the verb
the connector uses — translate. `slack_search_public_and_private` →
"search through messages in the channels you can see." Drop any
technical noun the user wouldn't know.

## What you say to the user

> Here's what `agntux-{slug}` will be able to do with
> {connector-display-name}:
>
> **Read** — refreshes every {recommended-cadence}:
> - {plain-language line 1}
> - {plain-language line 2}
> - {plain-language line 3}
>
> **Action buttons** — when an action item from
> {connector-display-name} appears in your AgntUX triage, you'll be
> able to:
> - {plain-language verb 1}
> - {plain-language verb 2}
> - {plain-language verb 3}
>
> Anything missing, or look right?

If the user says "missing X" → re-read the tool inventory; if X
exists, add the line; if X doesn't exist, tell the user the
connector doesn't expose it ("the connector doesn't have a way to
{X}; that's a connector-side gap, not something we can fix in the
plugin").

If the user says "looks right" → confirm and advance.

## Pick a recommended ingest cadence

Based on what the connector exposes:

- **Communication / chat** (DMs, mentions, threads): every 15–30 min,
  business-hours-aware.
- **Email**: every 30 min, business-hours-aware.
- **Project tracking** (Linear, Jira, GitHub Issues): every 60 min.
- **Notes** (Notion, Bear, Apple Notes): every 4 hours.
- **Calendar / meeting transcripts**: every 30 min during business
  hours.
- **CRM** (HubSpot, Salesforce): every 2 hours.

Confirm with the user:

> Sync cadence — sounds like every {cadence}. Sound right? You can
> change this later.

Save:
```json
{
  ...,
  "tool_inventory": {
    "read": ["list_issues", "get_issue", "search_issues", ...],
    "write": ["create_comment", "update_issue_state", ...]
  },
  "primary_write_verbs": ["comment_on_issue", "transition_state", "assign_user", "edit_description"],
  "recommended_cadence": "Every 60 min, 7am–10pm weekdays"
}
```

## What you DON'T do

- Don't enumerate every tool to the user. They don't care about
  `list_workspace_members` if the connector is a project tracker.
  Trim to what affects the plugin's job.
- Don't translate the cadence to "polling" or "scheduling" — say
  "refreshes every X."
- Don't ask about the schema (entities + actions) yet — that's
  internal, you'll handle it during stage 7's build pass.
- **Cover the connector's meaningful write verbs.** Default
  posture: every distinct write verb that a knowledge worker
  actually uses gets a UI handler. For project trackers (Linear,
  Jira, GitHub Issues) that's typically 4–5: comment, transition
  state, assign, edit description, set priority/labels. For chat
  (Slack, Discord) it's typically 1–2: reply, plus thread-level
  actions. The plugin should let the user complete their everyday
  work *without bouncing back to the source app*.
- **Collapse only when inputs collapse.** Two verbs that take the
  same input shape (e.g., "reply to thread" vs "reply with
  schedule") become tabs over one Send button, not two handlers.
  Two verbs with genuinely different inputs (comment text vs
  transition picker) get two handlers.

## When the connector is read-only

Some sources have no write tools (read-only feeds, log streams).
The plugin will be ingest-only, with no in-host action button —
action items will surface "Open in {connector-display-name}" as
their only affordance. Tell the user:

> {Connector-display-name} doesn't have a way to take action back —
> we'll surface action items with an "Open in
> {connector-display-name}" link. Anywhere it does have actions
> (newer API, etc.), we'll add buttons in a follow-up.

Save `primary_write_verbs: []`.

Note: even on write-capable plugins, "Open in {connector}" is a
standard *secondary* link in every action item's iframe header
(matches `agntux-slack` and `agntux-gmail`'s `Open ↗` link). It's
never the primary surface, and never replaces an in-host handler
when the source supports the verb. See stage 5.

## Path forward

Move to [`05-plan-ui.md`](05-plan-ui.md). If `primary_write_verbs`
is empty (read-only source), stage 5 is a one-line confirmation
rather than a full UI plan.
