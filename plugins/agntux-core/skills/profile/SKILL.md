---
name: profile
description: Edit the user's AgntUX profile (`~/agntux-code/user.md`) — cross-workflow preferences, glossary terms, identity, responsibilities, sources, generic action-worthy/noise rules, "remember PRD means Product Requirements Document", "my role changed". Also handles graduation review ("any patterns to approve?") and proactive captures from the orchestrator. Use for "edit my profile" / "update my preferences" / "add to my glossary" intents that do NOT mention a specific plugin or source. Source-specific imperatives ("never raise email from X", "ignore #random") go to `/agntux-core:teach` instead.
---

# `/agntux-core:profile` — personalization edits

Lane: any edit to `~/agntux-code/user.md`. Cross-workflow rules and
identity live here; per-plugin/per-source rules go through
`/agntux-core:teach` instead.

## Preconditions

Run [`_preconditions.md`](../_preconditions.md). If checks 0–4 divert,
follow the redirect and stop.

## Dispatch

Engage the **personalization** subagent. It auto-detects mode from
state and the inbound prompt:

- **Mode B** — ongoing edits (preferences, glossary, identity,
  responsibilities, sources, plugin lists). Default for direct
  invocations like "add 'Globex escalations' to action-worthy",
  "remember PRD = Product Requirements Document", "my role changed".
- **Mode C** — graduation review when `user.md → # Auto-learned` has
  at least one `[graduation-candidate]` tag and the user said "any
  patterns to approve?".
- **Mode D** — proactive ask when the orchestrator forwarded "user
  mentioned X that may belong in `user.md`".

Pass `$ARGUMENTS` through verbatim so the subagent gets the full
edit instruction.

## Lane disambiguation

- "Teach `{plugin}`" / source-specific imperatives ("never raise
  email from X", "ignore #random") → use `/agntux-core:teach` —
  those write per-plugin instructions, not `user.md`.
- Schema/data-model edits ("add a `health_score` field to
  `company`", "add an `awaiting-customer` action class") → use
  `/agntux-core:schema`.
- Cadence changes for ingest plugins → handled in the host's
  scheduled-task UI; cadence is not stored in `user.md`. The
  personalization subagent has the canonical redirect message.
