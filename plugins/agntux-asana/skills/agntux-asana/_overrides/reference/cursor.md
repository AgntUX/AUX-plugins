# Asana cursor strategy — reference

Companion to `../SKILL.md` Step 11 and `fetch.md`. This file documents
the source-side runtime semantics for the `agntux-asana` cursor and is
consumed verbatim by the render pipeline as the `reference/cursor.md`
slot. Read it once during Step 2 (state read); act on it in Step 11
(cursor advance).

---

## Cursor type and storage shape

The Asana cursor is a **single scalar ISO 8601 UTC string** — not a JSON
map, not a per-channel or per-container object. It is stored as a plain
string value in `data/learnings/agntux-asana/sync.md` frontmatter under
the `cursor:` key.

```yaml
cursor: "2026-06-26T14:30:00.000Z"   # incremental steady state
cursor: null                          # bootstrap / never run
```

There is no per-task entry, no per-project entry, and no compound key.
A single low-water-mark covers all items the `get_my_tasks` feed returns
for the authenticated user.

---

## Why a single low-water-mark suffices (no tracked-parent registry)

The question every new ingest source must answer: when a reply or
comment arrives on an existing item, does the parent's timestamp bump?

For Asana: **yes**. Adding a story (comment) to a task bumps the task's
`modified_at` in Asana's data model. This means:

- A task with a new comment re-surfaces in `get_my_tasks?modified_since=<cursor>`
  on the next run.
- Step 5c then fetches the task's stories and filters them to
  `created_at >= cursor`, isolating only the new comments.
- The task is the atomic unit for entity dedup (`source_id` is the
  task GID); comment authors are resolved as `person` entities
  separately.

**Consequence:** Asana is a "parent bumps" source (same class as Jira,
Linear, GitHub PRs, HubSpot CRM records). The tracked-parent registry
pattern documented in the cursor-strategies catalogue is **not needed**
here. There is no risk of missing comments on old tasks as long as
the cursor is valid.

---

## Advance rule

Set the new cursor to `max(modified_at)` across all tasks processed
this run.

Do NOT use the run-start time as the cursor value. Using the task's
own `modified_at` field ensures that tasks modified during the run
(after fetch but before cursor write) are not silently skipped — they
will re-surface on the next run because their `modified_at` will be
newer than the stored cursor.

`modified_since` is **exclusive at the boundary** in Asana's API.
Passing the stored cursor directly to `modified_since` will not
re-return the boundary task. No off-by-one fence is needed.

---

## Two-level time filter (non-default pattern)

Asana requires a secondary time filter at the story level that has no
equivalent in the canonical fetch loop:

1. **Task-level gate:** `get_my_tasks?modified_since=<cursor>` surfaces
   tasks whose `modified_at` is newer than the cursor. This is the
   primary gate.

2. **Story-level gate:** within each fetched task, stories (comments)
   are filtered to `created_at >= cursor`. This secondary gate prevents
   re-processing old comments that predate the current run window but
   live inside a task that re-surfaced because of a different mutation
   (e.g., a field change that also bumped `modified_at`).

Both filters use the same cursor value. The secondary filter is applied
in Step 5c after `get_task` returns the full story list; it is not a
server-side filter (Asana's `get_task` stories endpoint does not expose
a `since` parameter).

This pattern does not require a per-story cursor or any additional state
beyond the single scalar cursor. It is idempotent: re-running with the
same cursor produces the same story subset.

---

## Onboarding mode (bootstrap)

Bootstrap condition: `cursor: null` AND `last_success: null` in
`sync.md`.

On bootstrap, use `modified_since: <now − bootstrap_window_days>T00:00:00Z`
(where `bootstrap_window_days` defaults to 30 per `frontmatter.yaml`).

The standard 200-task / 50-story-task caps apply on bootstrap as well
as incremental runs. If the bootstrap window contains more than 200
tasks, process the 200 with the oldest `modified_at` first (ascending
sort) and advance the cursor to the newest `modified_at` processed.
The next scheduled run continues from that point.

Asana volumes are typically lower than Gmail or Slack (users have one
task feed, not a multi-channel workspace), so the initial run is
unlikely to hit the cap hard. No tighter first-run scope is required
beyond the standard caps.

---

## Gap recovery

| Condition | Detection | Recovery |
|---|---|---|
| Null cursor (bootstrap or loss) | `cursor: null` | Use `modified_since: <now − bootstrap_window_days>T00:00:00Z`; process oldest-first. |
| Stale cursor outside Asana's retention window | API returns no results for a window that should have had activity | Set cursor to null; treat as bootstrap. Log `asana-cursor-evicted` with `kind: source`. |
| Large backlog (extended offline period) | >200 tasks returned | Apply 200-task cap, advance cursor to newest processed; subsequent runs drain the queue. |
| Task GID returns 404 or permission error | `get_task` error | Log `asana-task-deleted` with `kind: source`; skip. Do not evict cursor unless this is the third consecutive failure for the same GID. |

---

## Cursor-lifetime identity fields

Two fields are co-resident with the cursor in `sync.md` frontmatter but
are NOT the cursor:

- `user_gid` — the authenticated user's Asana GID. Resolved once via
  Step 5a and persisted in the same atomic write as the cursor in
  Step 11. Used for deep-link construction and for filtering
  "assigned to me" tasks.
- `workspace_gid` — the primary workspace GID. Same lifecycle. Used as
  a fallback for task permalink construction when `permalink_url` is
  null.

Once non-null, neither field is re-derived. They survive cursor resets
(if the cursor is cleared for gap recovery, `user_gid` and
`workspace_gid` are preserved as-is).

---

## Step 11 procedural note

The cursor advance diff format and the all-writes-succeeded gate are
documented in `../step-11-append.md`. This file documents the
**strategy**; that file documents the **procedure**. Do not duplicate
the diff-format lines here.

---

## Catalogue entry (for cursor-strategies.md)

The following block is the entry to be added to
`canonical/prompts/ingest/cursor-strategies.md` by the
`@agntux/marketplace-maintainers` team as part of the same PR that
ships this plugin. It is reproduced here so the build validator can
confirm the catalogue and the local reference are consistent.

```
### Asana

- **Cursor type:** Single scalar ISO 8601 UTC string (`modified_at` of
  the newest task processed this run).
- **Storage form:** Plain string in `sync.md → cursor:`. Not a JSON map.
  Value example: `"2026-06-26T14:30:00.000Z"`.
- **Advance rule:** Set to `max(modified_at)` across all tasks processed
  this run at Step 11, gated on all-writes-succeeded. Do NOT use
  run-start time. Asana's `modified_since` is exclusive at the boundary,
  so the cursor value is safe to re-pass verbatim.
- **Secondary filter:** Stories (comments) within each fetched task are
  additionally filtered to `created_at >= cursor` in Step 5c. This
  prevents re-processing old comments when a task resurfaces due to a
  non-comment mutation. Uses the same cursor value; requires no
  additional state.
- **Tracked-parent registry:** Not needed. Asana bumps a task's
  `modified_at` when a comment is added, so new comments surface via
  the task feed without a separate parent tracker.
- **Gap recovery:** Null cursor → bootstrap with
  `modified_since: <now − bootstrap_window_days>T00:00:00Z`. Stale
  cursor outside retention → reset to null, re-bootstrap. Extended
  offline backlog → 200-task cap per run drains monotonically.
- **Onboarding mode:** Standard 200-task cap applies from first run;
  no tighter scope required (single-user task feed, not a
  multi-channel workspace).
```
