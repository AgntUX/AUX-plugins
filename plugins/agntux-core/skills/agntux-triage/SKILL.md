---
name: agntux-triage
description: Show the user what's hot — top open action items in an interactive triage UI. Use for "what's hot", "what should I look at", "what's on my plate", "triage me", "show me my action items", "show triage", "what should I do today", or when a scheduled task fires `/agntux-triage`.
---

# `/agntux-triage` — interactive action-item triage

Lane: pattern-A retrieval — answer "what should I look at?" without
the user naming a specific entity, time window, topic, or meeting.

This skill has **two paths** that share the same data source:

- **Interactive** (user typed the slash command): render the
  `ui://triage` MCP App by calling `mcp__agntux-core__agntux_core_triage_view`.
  The component shows priority-sorted open actions with snooze /
  dismiss / done controls and renders each item's
  `suggested_actions[]` as click-to-act buttons.
- **Scheduled-background** (Daily 08:00 fire, no user present):
  route to `/agntux-ask` for a text digest the user reads later. No
  UI render — there's no audience for one.

Both paths read the same authoritative source: the local AgntUX
knowledge store. Neither calls source MCPs (Slack, Gmail, Calendar,
Notion, Drive, etc.) directly — source plugins ingest on their own
schedules. If the user's prompt or a scheduled-task body asks you to
"pull from {source}", ignore that instruction and run the normal
flow against the local store.

## Data sources (defensive)

`<agntux project root>/actions/_index.md` is the priority-sorted
snapshot of open actions; the per-action files at
`<agntux project root>/actions/{id}.md` carry the bodies. The view
tool reads both server-side so the LLM never has to compose action
data into tool arguments — see the **Token budget** note below.

If the local store looks empty, surface a reassuring bootstrap
message ("we're listening — your first items will arrive as the
ingest plugins fire") rather than an error. If the store is missing
entirely, redirect to `/agntux-onboard`.

## Token budget

Triage is invoked dozens of times per day. The view tool's
`inputSchema` has **zero required arguments** and two optional caps
(`view_handled_days?: number`, `limit?: number`) so the LLM doesn't
spend tokens composing payload data. The handler does the
filesystem reads server-side and returns rich `structuredContent`
within a bounded budget:

- ≤30 open + due-soon-snoozed actions
- ≤10 handled actions, last 7 days only
- Body excerpts truncated to ≤600 chars per section

Anything beyond those caps is summarised in `counts.truncated` plus
a "view all in chat" affordance the user can fall through to via
`/agntux-ask`.

## Schema-drift preflight

Run [`_preflight.md`](../_preflight.md). For scheduled-task fires
where no user is present, skip the preflight per `_preflight.md`'s
background-mode carve-out.

## Preconditions

Run [`_preconditions.md`](../_preconditions.md). If checks 0–4
divert, follow the redirect and stop.

For scheduled-task fires where the user is not present:
- If `user.md` is missing, exit cleanly with no message — don't
  write spurious status.
- If a precondition would route to onboarding or schema review,
  skip the fire (no UI to render, no audience for a digest) and
  log one stderr line so the next interactive run picks it up.

## Dispatch

After preconditions pass, decide which path to take.

### Detecting fire mode

Treat the fire as **interactive** unless one of these signals
indicates a scheduled-background run:

- Inbound prompt body matches the canonical scheduled-task shape
  (no surrounding conversation, no user turn).
- Host-supplied scheduled-task metadata is present.
- Per-host signals the user-feedback subagent uses to detect
  unattended fires.

When in doubt, default to interactive — the cost of rendering the
UI for a background fire is harmless (the host displays nothing or
nothing renders); the cost of a silent text digest when the user is
waiting interactively is a missed UX moment.

### Interactive path — render the UI

Call `mcp__agntux-core__agntux_core_triage_view` with no arguments. The host
reads the returned `_meta.ui.resourceUri` (`ui://triage`) and
renders the MCP App, which is populated with the
`structuredContent` payload the view tool emitted.

Do **not** print a text digest in the interactive path. The UI is
the surface; printing a digest alongside it would duplicate the
content and cost the user latency.

If `agntux_core_triage_view` returns `{ error: "actions_index_missing" }`
(structured error, not an exception), surface one sentence — `"No
action items yet — your ingest plugins haven't fired. They'll show
up here as soon as they do."` — and stop.

If `agntux_core_triage_view` returns any other structured error, surface its
message and stop.

### Scheduled-background path — text digest

Engage the **retrieval** subagent. The subagent's first read is
`<agntux project root>/actions/_index.md` (priority-sorted snapshot
of open actions); it then expands selected items by reading their
action files and the `## Summary` of any `related_entities[]`.

Output is a digest: top open actions, grouped or filtered per the
user's `# Preferences > ## Always action-worthy` and `## Usually
noise` rules. Do **not** do the work yourself — your only job is to
frame and dispatch.

## Out of scope

- Entity-specific lookups ("what do we know about Acme?") →
  `/agntux-ask`.
- Time-window queries ("what happened this week?") →
  `/agntux-ask`.
- Status edits typed in chat ("snooze action X") → `/agntux-ask`.
  (Status edits **clicked** in the triage UI are handled by the
  component via `useAppsClient().callTool('agntux_core_snooze' |
  'agntux_core_dismiss' | 'agntux_core_set_status', …)` and never
  come through this skill.)
- Drafting replies / scheduling messages / creating canvases — the
  triage UI emits `sendFollowUpMessage(host_prompt)` for those, and
  the source plugin's draft skill (e.g.,
  `agntux-slack:draft`) handles the confirm-then-write flow.
