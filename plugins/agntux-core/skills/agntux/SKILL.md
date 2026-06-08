---
name: agntux
description: The AgntUX command center. One entry point for onboarding, seeing your action items, editing your profile, editing the schema, capturing per-plugin rules, syncing a source, and asking questions about your information. Use for "/agntux", "onboard me", "set me up", "edit my preferences", "edit my profile", "review my schema", "edit my schema", "teach {plugin} about X", "sync slack", "ingest gmail now", "triage", "show my action items", "what's hot today", "what should I look at", "what do we know about Acme", "what happened this week", "snooze action X", "dismiss Y", "mark Z done", or any AgntUX-related request.
argument-hint: "[onboard|triage|profile|schema|teach|sync|ask|feedback-review|triage-digest] [args…]"
---

# `/agntux` — AgntUX command center

Lane: single user-facing entry into agntux-core. Route to the right
sub-task by reading the first token of `$ARGUMENTS`; if empty, infer
from the user's natural-language prompt.

## Voice rules

Speak as a single AgntUX voice. Never reference internal architecture:
do NOT say "subagent", "dispatch", "Mode A / B / C / D", "orchestrator",
"router", or "sub-command" to the user. Sub-task transitions are
silent — load the matching `reference/{name}.md` resource and follow
its body.

## Schema-drift preflight

For sub-commands other than `onboard` / `schema` / `triage`, run
[`_preflight.md`](../_preflight.md) before the resource body. The two
background sub-commands (`feedback-review`, `triage-digest`) follow
`_preflight.md`'s background-mode carve-out — skip the nudge when no
user is present.

`onboard` runs its own walkthrough; `schema` IS what resolves the
preflight nudge state — neither runs the preflight themselves. `triage`
skips the preflight too so the action-items UI opens instantly (see the
Preconditions carve-out below).

## Preconditions

For sub-commands other than `triage` (and the two background commands
`feedback-review` / `triage-digest`), run
[`_preconditions.md`](../_preconditions.md). Check 0 walks
[`_resolve-root.md`](../_resolve-root.md). On a divert, follow the
redirect and stop. `triage` skips the ladder entirely and calls the
view tool immediately — see its carve-out below.

Carve-outs:

- `onboard` opts out of checks 2 / 3 / 4 (its own flow handles
  missing schema, missing-contract plugins, and queued
  schema-requests end-to-end).
- `feedback-review` and `triage-digest` opt out of the **entire**
  check ladder. Their resources own unattended-aware preconditions
  inline because the router-level checks would route a missing
  `user.md` or unbootstrapped schema to `/agntux onboard`, which is
  the wrong behaviour for a Daily 16:00 / Daily 08:00 fire with no
  user present. Inline preconditions exit silently on divert and let
  the next user-initiated session surface and fix.
- `triage` opts out of the **entire** check ladder (and the
  preflight). It calls `agntux_core_triage_view` immediately with `{}`
  so the action-items UI opens with zero ramp. Skipping the ladder is
  safe because the tool is self-sufficient: it resolves the project
  root and gathers its own data server-side, and when the store isn't
  set up it surfaces an onboarding pointer inside the UI (the
  `actions_index_missing` / `bootstrap_mode` states) rather than
  diverting. The schema-review / new-plugin nudges and plugin
  reconciliation still run on every other `/agntux` command.

The remaining sub-commands (`profile`, `schema`, `teach`, `sync`,
`ask`) run the full check ladder.

## Routing table

| `$ARGUMENTS` first token | Resource loaded | Notes |
|---|---|---|
| (empty / natural language) | infer from chat; default to [`reference/ask.md`](reference/ask.md) | Catch-all behaviour preserved. |
| `onboard` | [`reference/onboard.md`](reference/onboard.md) | Re-entry mode handled inside the resource. |
| `triage` | invoke `mcp__agntux-core__agntux_core_triage_view` directly — no reference file | Opens your action-items list (the interactive triage UI). Call the tool immediately with `{}` — no preflight, no preconditions. The tool resolves the project root and gathers its own data, and shows an onboarding pointer in-UI if the store isn't set up. |
| `profile` | [`reference/profile.md`](reference/profile.md) | Edit `user.md`. |
| `schema` (+ optional `review {slug}` / `edit`) | [`reference/schema.md`](reference/schema.md) | Sub-modes preserved from old skill. |
| `teach` (+ optional `{plugin-slug}`) | [`reference/teach.md`](reference/teach.md) | Per-plugin instructions. |
| `sync {plugin-slug}` | [`reference/sync.md`](reference/sync.md) | Accepts `slack`, `agntux-slack`, with-or-without leading `/`. Re-dispatches `/{normalized-slug} sync`. |
| `ask {…}` | [`reference/ask.md`](reference/ask.md) | Explicit form; same as the empty-args default. |
| `feedback-review` | [`reference/feedback-review.md`](reference/feedback-review.md) | **Background-only.** Resource refuses-and-redirects if invoked interactively. |
| `triage-digest` | [`reference/triage-digest.md`](reference/triage-digest.md) | **Background-only.** Daily 08:00 text digest. The interactive action-items UI is the separate `triage` command above (the same `agntux_core_triage_view` tool the host invokes for `show triage` / `what's hot`). |

## Argument parsing

1. Trim `$ARGUMENTS`; treat the empty string as natural-language mode.
2. Lowercase the first token. If it matches a sub-command above, load
   `reference/{token}.md` and follow it. The remainder of `$ARGUMENTS`
   is the resource's input (e.g., `agntux schema review agntux-slack`
   loads `reference/schema.md` with sub-args `review agntux-slack`).
   **`triage` is the one exception — it has no `reference/triage.md`,
   and it skips the preflight + preconditions.** Invoke
   `mcp__agntux-core__agntux_core_triage_view` immediately with `{}`
   to open the interactive action-items UI with zero ramp.
3. **No match** → infer intent from the natural-language prompt and
   pick the matching resource. Heuristics:
   - "onboard / set me up / get started / I added a new plugin" →
     `onboard.md`.
   - "edit my preferences / glossary / role / sources" → `profile.md`.
   - "review my schema / edit my schema / add a field" → `schema.md`.
   - "teach {plugin} / never raise X from {source}" → `teach.md`.
   - "sync {source} / ingest {source} now" → `sync.md`.
   - "what's hot / what should I look at / show triage" → invoke
     `mcp__agntux-core__agntux_core_triage_view` immediately with `{}`
     (the interactive UI), skipping the preflight + preconditions just
     like the explicit `triage` command. Do NOT load `triage-digest.md`
     for this case — that resource is background-only.
   - Anything else (entity lookups, time queries, prep, status edits)
     → `ask.md`.
4. When the prompt could plausibly match `profile` (global) or
   `teach` (per-plugin), ask one short clarifying question. Otherwise
   pick the closest match and proceed.

## Out of scope

- Interactive triage UI internals — the `agntux_core_triage_view` MCP
  tool renders it. This skill only invokes that tool (via the `triage`
  command or the `show triage` / `what's hot` heuristic) and never
  reimplements the UI.
- Per-plugin sync work — `reference/sync.md` only re-dispatches.
- Scheduled-task creation/edit — host UI primitive (referenced from
  `reference/onboard.md` and `reference/profile.md` Mode B).
