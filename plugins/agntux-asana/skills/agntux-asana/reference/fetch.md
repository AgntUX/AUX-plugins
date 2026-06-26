# Asana fetch — Step 5 orchestration

Companion to `../SKILL.md` Step 5. Wholesale override for the
agntux-asana plugin — replaces the canonical `reference/fetch.md`
skeleton entirely.

## Step 5 — Fetch from Asana

The Asana connector tools are inherited from the dispatch context.
Cowork prefixes them as `mcp__<uuid>__get_my_tasks` etc.; call them
by their host-resolved names. The three sub-steps below run in order
every pass.

### Step 5a — Resolve current user identity

If `user_gid` in `data/learnings/agntux-asana/sync.md` is non-null,
skip this sub-step entirely.

Call `get_user` with `user_gid: "me"`. Extract:
- `gid` → persist as `user_gid` (Step 11 sub-step 5).
- `workspaces[0].gid` → persist as `workspace_gid` (Step 11 sub-step
  5). If the response carries multiple workspaces, use the first one
  (the API's default workspace for the token).

These values are cursor-lifetime state; once non-null, never
re-derive.

### Step 5b — Fetch tasks modified in the time window

Call `get_my_tasks` with:
- `modified_since: <cursor ISO 8601>` (incremental), OR
- `modified_since: <now − bootstrap_window_days>T00:00:00Z` (bootstrap,
  when cursor is null).
- `opt_fields: "gid,name,completed,completed_at,due_on,due_at,modified_at,assignee,projects,memberships,permalink_url,notes"`.
- Paginate using the `offset` token returned in `next_page` until
  exhausted or the 200-item cap is reached.

Asana's `modified_since` is **exclusive at the boundary**: the
cursor value is safe to re-pass without re-fetching the boundary
task. The cursor is the ISO 8601 string of the newest `modified_at`
seen this run (not now); this prevents a race with tasks modified
during the run.

**Cap:** stop after 200 tasks total (across all pages). Sort by
`modified_at` ascending before processing; the oldest-first order
ensures the cursor advances over the most-stale tasks when the cap
fires.

**Completed-task filter:** include completed tasks only when they were
completed within the time window (`completed_at` ≥ cursor). Completed
tasks older than the window are already stable and generate no new
signals.

### Step 5c — Fetch stories (comments/mentions) for each task

For each task from Step 5b, call `get_task` with:
- `task_gid: <gid>`.
- `opt_fields: "gid,name,completed,completed_at,due_on,due_at,modified_at,assignee,assignee.name,assignee.email,projects,projects.name,projects.gid,memberships,memberships.project.name,memberships.project.gid,permalink_url,notes,stories,stories.gid,stories.type,stories.created_at,stories.created_by,stories.created_by.name,stories.created_by.email,stories.text"`.

From `stories`, retain only:
- `type: comment` — user-authored comments. Discard system-generated
  activity stories (`type: system`).
- Filter to stories with `created_at` ≥ cursor (incremental) or
  ≥ bootstrap cutoff, to avoid re-processing old comments.

If `get_task` returns a 404 or permission error for a task GID, log
`asana-task-deleted` with `kind: source` and skip; do not evict the
cursor unless this is the third consecutive failure for the same GID
(see runbook).

**Per-task cap:** fetch stories for up to 50 tasks per run. If
Step 5b returned more than 50 tasks, process the 50 with the oldest
`modified_at` first (they've waited longest for triage). The
remaining tasks are covered in subsequent runs as the cursor advances.

### Step 5d — Project-status sweep (every run, separate from task feed)

For each distinct project GID referenced in the tasks fetched above
(collect from `projects[].gid` across all task results), call
`get_status_overview` with `project_gid: <gid>`.

Retain only overviews where the status was authored (created/modified)
within the time window. A project-status update is a signal-worthy
event (see Step 8 signals).

**Dedup:** cache the set of project GIDs already covered this run;
call `get_status_overview` at most once per GID per run.

Cap at 20 project-status calls per run.

## Since-parameter contract

Asana's `modified_since` is ISO 8601 (UTC), exclusive at the boundary.
The cursor stores the exact `modified_at` of the newest task processed
this run. The next run passes the same value to `modified_since`; the
boundary task is NOT re-returned. This is class-2 ("precision-safe")
— no boundary ambiguity and no re-fetch of already-processed items.

## On fetch failure

Log to `data/learnings/agntux-asana/sync.md → errors` with
`kind: auth | network | parse | source | internal`, update
`last_run`, release the lock, exit. The transactional rule (Step 11)
keeps the cursor at its pre-run value; the next scheduled run retries
the same window.

**Rate limits (HTTP 429):** log `kind: network`, skip the affected
call, continue processing remaining tasks. Asana's free tier enforces
150 req/min; a single pass over 50 tasks at 1 call each stays well
under that budget.

## Gap recovery

- **Null cursor (bootstrap or cursor loss):** use
  `modified_since: <now − bootstrap_window_days>T00:00:00Z`. If
  bootstrap returns more than 200 tasks, process the 200 with the
  oldest `modified_at` first and advance the cursor to the newest
  one processed; the next run picks up.
- **Stale cursor referent (tasks older than Asana's 7-year retention):**
  treat as bootstrap; set cursor to null and start over.
- **Large backlog after extended offline period:** the 200-item / 50
  story-task caps bound each run; the cursor advances monotonically
  until caught up.
