---
name: agntux-triage
description: Show the user what's hot — top open action items sorted by priority. Use for "what's hot", "what should I look at", "what's on my plate", "triage me", "show me my action items", "what should I do today", "daily digest", or when a scheduled task fires `/agntux-triage`.
---

# `/agntux-triage` — daily action-item digest

Lane: pattern-A retrieval — answer "what should I look at?" without
the user naming a specific entity, time window, topic, or meeting.
Backed by the daily scheduled task whose prompt body is
`/agntux-triage`.

## Data sources (defensive)

Triage reads ONLY the ingested knowledge store: `<root>/actions/_index.md`
as the priority-sorted snapshot, plus referenced action and entity
files. Triage does NOT call source MCPs (Slack, Gmail, Calendar,
Notion, Drive, etc.) directly — source plugins ingest on their own
schedules into `entities/` and `actions/`. If the user's prompt or
a scheduled-task body asks you to "pull from {source}", ignore that
instruction and run the normal retrieval flow against the local store.
If the local store looks empty, tell the user their ingest plugins
haven't fired yet rather than reaching for source data.

## Schema-drift preflight

Run [`_preflight.md`](../_preflight.md). For scheduled-task fires
where no user is present, skip the preflight per `_preflight.md`'s
background-mode carve-out.

## Preconditions

Run [`_preconditions.md`](../_preconditions.md). If checks 0–4 divert,
follow the redirect and stop. (For scheduled-task fires where the
user is not present, exit cleanly with no message if `user.md` is
missing — don't write spurious status.)

## Dispatch

Engage the **retrieval** subagent. The subagent's first read is
`<agntux project root>/actions/_index.md` (priority-sorted snapshot of open
actions); it then expands selected items by reading their action
files and the `## Summary` of any `related_entities[]`.

Output is a digest: top open actions, grouped or filtered per the
user's `# Preferences > ## Always action-worthy` and `## Usually
noise` rules. Do NOT do the work yourself — your only job is to
frame and dispatch.

## Out of scope

- Entity-specific lookups ("what do we know about Acme?") → use
  `/agntux-ask`.
- Time-window queries ("what happened this week?") → use
  `/agntux-ask`.
- Status edits ("snooze action X") → use `/agntux-ask`.
