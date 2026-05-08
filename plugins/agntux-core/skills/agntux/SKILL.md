---
name: agntux
description: The AgntUX command center. One entry point for onboarding, editing your profile, editing the schema, capturing per-plugin rules, syncing a source, and asking natural-language questions about your knowledge store. Use for "/agntux", "onboard me", "set me up", "edit my preferences", "edit my profile", "review my schema", "edit my schema", "teach {plugin} about X", "sync slack", "ingest gmail now", "what's hot today", "what should I look at", "what do we know about Acme", "what happened this week", "snooze action X", "dismiss Y", "mark Z done", or any AgntUX-related request.
argument-hint: "[onboard|profile|schema|teach|sync|ask|feedback-review|triage-digest] [args…]"
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

For sub-commands other than `onboard` / `schema`, run
[`_preflight.md`](../_preflight.md) before the resource body. The two
background sub-commands (`feedback-review`, `triage-digest`) follow
`_preflight.md`'s background-mode carve-out — skip the nudge when no
user is present.

`onboard` runs its own walkthrough; `schema` IS what resolves the
preflight nudge state — neither runs the preflight themselves.

## Preconditions

Run [`_preconditions.md`](../_preconditions.md). Check 0 walks
[`_resolve-root.md`](../_resolve-root.md). On a divert, follow the
redirect and stop.

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

The remaining sub-commands (`profile`, `schema`, `teach`, `sync`,
`ask`) run the full check ladder.

## Routing table

| `$ARGUMENTS` first token | Resource loaded | Notes |
|---|---|---|
| (empty / natural language) | infer from chat; default to [`reference/ask.md`](reference/ask.md) | Catch-all behaviour preserved. |
| `onboard` | [`reference/onboard.md`](reference/onboard.md) | Re-entry mode handled inside the resource. |
| `profile` | [`reference/profile.md`](reference/profile.md) | Edit `user.md`. |
| `schema` (+ optional `review {slug}` / `edit`) | [`reference/schema.md`](reference/schema.md) | Sub-modes preserved from old skill. |
| `teach` (+ optional `{plugin-slug}`) | [`reference/teach.md`](reference/teach.md) | Per-plugin instructions. |
| `sync {plugin-slug}` | [`reference/sync.md`](reference/sync.md) | Accepts `slack`, `agntux-slack`, with-or-without leading `/`. Re-dispatches `/{normalized-slug} sync`. |
| `ask {…}` | [`reference/ask.md`](reference/ask.md) | Explicit form; same as the empty-args default. |
| `feedback-review` | [`reference/feedback-review.md`](reference/feedback-review.md) | **Background-only.** Resource refuses-and-redirects if invoked interactively. |
| `triage-digest` | [`reference/triage-digest.md`](reference/triage-digest.md) | **Background-only.** Daily 08:00 text digest. Interactive triage UI is owned by the `agntux_core_triage_view` MCP tool — the host's tool selector matches its description's trigger phrases (`show triage`, `what's hot`, …) without a skill in the loop. |

## Argument parsing

1. Trim `$ARGUMENTS`; treat the empty string as natural-language mode.
2. Lowercase the first token. If it matches a sub-command above, load
   `reference/{token}.md` and follow it. The remainder of `$ARGUMENTS`
   is the resource's input (e.g., `agntux schema review agntux-slack`
   loads `reference/schema.md` with sub-args `review agntux-slack`).
3. **No match** → infer intent from the natural-language prompt and
   pick the matching resource. Heuristics:
   - "onboard / set me up / get started / I added a new plugin" →
     `onboard.md`.
   - "edit my preferences / glossary / role / sources" → `profile.md`.
   - "review my schema / edit my schema / add a field" → `schema.md`.
   - "teach {plugin} / never raise X from {source}" → `teach.md`.
   - "sync {source} / ingest {source} now" → `sync.md`.
   - "what's hot / what should I look at / show triage" → invoke
     `mcp__agntux-core__agntux_core_triage_view` directly (the
     interactive UI). Do NOT load `triage-digest.md` for this case —
     that resource is background-only.
   - Anything else (entity lookups, time queries, prep, status edits)
     → `ask.md`.
4. When the prompt could plausibly match `profile` (global) or
   `teach` (per-plugin), ask one short clarifying question. Otherwise
   pick the closest match and proceed.

## Out of scope

- Interactive triage UI — host invokes
  `mcp__agntux-core__agntux_core_triage_view` directly via the tool
  description's trigger phrases.
- Per-plugin sync work — `reference/sync.md` only re-dispatches.
- Scheduled-task creation/edit — host UI primitive (referenced from
  `reference/onboard.md` and `reference/profile.md` Mode B).
