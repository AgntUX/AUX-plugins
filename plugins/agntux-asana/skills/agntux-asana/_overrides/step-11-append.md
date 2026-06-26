**Asana cursor advance (Step 11 sub-step 3):**

The Asana cursor is a single scalar ISO 8601 string (not a JSON map).
Express the diff as:

```
cursor: null → "2026-06-26T14:30:00.000Z"   # first run
cursor: "2026-06-25T09:00:00.000Z" → "2026-06-26T14:30:00.000Z"  # incremental
```

Set the new cursor to `max(modified_at)` across all tasks processed
this run — NOT to the run start time. Using `modified_at` of the newest
task prevents re-fetching tasks already processed when the next
`modified_since` filter is applied.

There is no per-task cursor map and no per-task eviction for Asana:
the single low-water-mark covers all tasks in the feed. Log
`asana-cursor-evicted` only when a task GID fails three consecutive
times (auth/permission/deletion) — in that case, the task is gone from
the feed and the cursor naturally moves past it.

**Source-identity persistence (Step 11 sub-step 5):**

Write `user_gid` and `workspace_gid` into `sync.md` frontmatter if
captured for the first time this run (null → non-null). Once set,
never overwrite. These fields MUST be included in the single atomic
`sync.md` write alongside the cursor advance and lock release.
