# Cursor semantics — agntux-jira
# Wholesale replacement of canonical reference/cursor.md for this plugin.

This file is the authoritative runtime cursor reference for `agntux-jira`. It
supersedes any cursor notes in `reference/sync.md` or `_overrides/frontmatter.yaml`
where those conflict with what is written here.

The canonical taxonomy this cursor belongs to is the **per-channel timestamp map**
strategy documented in `canonical/prompts/ingest/cursor-strategies.md` under the
Jira entry. Jira projects are the sharding unit analogous to Slack channels; the
cursor is a per-project `updated >=` JQL timestamp, not a page token or opaque
integer. This file is the operational detail consulted at runtime; the canonical
doc is the taxonomy source of truth.

---

## 1. Cursor type and storage shape

**Type:** Per-project `updated >=` JQL timestamp map, wrapped in a structured
JSON object that also carries workspace metadata and per-project auxiliary
counters.

**Storage:** A single JSON object on one line under the `cursor` key in
`data/learnings/agntux-jira/sync.md` frontmatter:

```
cursor: {"cloudIds":["1c5b1484-c964-4d92-bb3e-9237be54ca08"],"projects":{"OFM":{"last_updated":"2026-06-08 14:30","last_comment_seen_at":"2026-06-08T14:30:00Z","last_seen_issue_count":42},"PLAT":{"last_updated":"2026-06-07 09:15","last_comment_seen_at":"2026-06-07T09:15:00Z","last_seen_issue_count":17}},"schema_version":1}
```

### Top-level fields

| Field | Type | Description |
|---|---|---|
| `cloudIds` | string array | Atlassian Cloud instance ID(s) in scope. Populated once via `getAccessibleAtlassianResources` and reused on every subsequent run. Never re-derived per item. |
| `projects` | object | Per-project cursor entries. Keys are project keys exactly as returned by `getVisibleJiraProjects` (e.g. `OFM`, `PLAT`, `ENG`). Never normalise case. |
| `schema_version` | integer | Schema version for this cursor object. Currently `1`. The validate-cursor hook uses this to gate migration logic if the shape changes in a future plugin version. |

### Per-project entry shape

```json
{
  "last_updated": "YYYY-MM-DD HH:mm",
  "last_comment_seen_at": "YYYY-MM-DDTHH:mm:ssZ",
  "last_seen_issue_count": 0
}
```

| Field | Type | Description |
|---|---|---|
| `last_updated` | string — minute-precision `YYYY-MM-DD HH:mm` | The newest `issue.fields.updated` (truncated to minute) seen in this project during the last successful run. This value is used directly in the JQL `updated >= "{last_updated}"` clause after subtracting the 60-second safety margin (see section 4). **Minute precision is intentional** — Jira's JQL `updated >=` filter only honours `"YYYY-MM-DD HH:mm"` granularity; ISO-8601 fractional seconds are silently truncated by the API and cause non-deterministic window alignment. |
| `last_comment_seen_at` | string — ISO 8601 UTC | The newest `comment.created` timestamp processed from any issue in this project during the last successful run. Used in Step 5e to filter out comments already processed in prior runs (incremental comment filtering). Stored at full ISO precision because it is compared against `comment.created`, not passed to JQL. |
| `last_seen_issue_count` | integer | Count of issues returned by the last fetch pass for this project. Used to detect unexpected drops in activity (possible connectivity or scope-change event) and to log `volume_cap_hit` context. Not used for gating; informational only. |

**Absent project key** means the project has never been successfully ingested —
triggers cold-start mode for that project (section 3).

A `null` entry value is never written by the plugin; treat it as equivalent to
absent on read (cold-start guard).

---

## 2. Advance rule (transactional)

The cursor advances **only at Step 11, and only when every action write in the
current run has succeeded.** This is the transactional advance rule from
`canonical/prompts/ingest/cursor-strategies.md`.

Specifically, for each project processed this run:

1. Compute `max(issue.fields.updated)` over all issues fetched in Step 5d for
   that project.
2. Truncate to minute precision → `last_updated` value.
3. Compute `max(comment.created)` over all comments processed in Step 5e for
   that project → `last_comment_seen_at` value.
4. Record the issue count fetched → `last_seen_issue_count`.
5. Write the updated per-project entry **as part of the same atomic write** that
   sets `last_success` and clears the lock (`lock: null`).

**If any action write for an issue in a given project failed** (validator
rejection, filesystem error, lock contention, retry budget exhausted), skip the
cursor advance for that project. Leave the previous entry values in place. The
next run reprocesses the same window for that project.

**Volume-cap scenario:** when the 200-issue cap is hit for a project, advance
`last_updated` to the maximum `updated_at` seen in the fetched batch regardless.
The 60-second safety margin on the next pass reprocesses the minute boundary,
catching any issues updated in that same minute.

Log the cursor diff at run end in the format:

```
cursor advance — added: OFM×1 | advanced: PLAT×1, ENG×1 | evicted: OLD×1 | skipped (write failure): INFRA×1
```

Omit any clause whose count is zero.

---

## 3. Cold-start (bootstrap) behaviour

A project enters cold-start when its key is absent (or null) in `projects`.

**Initial fetch window:**
- `updated_after = today − bootstrap_window_days`
- `bootstrap_window_days` is read from `user.md` frontmatter. Default: `30`.

**First-run onboarding cap (first run ever):**
- Detected by `last_success: null` in the sync state AND `projects` map empty
  or absent.
- Apply a tighter cap: at most **100 issues per project** and at most
  **3 projects** this run. Queue remaining projects as absent keys; the next
  scheduled background run picks them up.
- Subsequent runs bootstrapping a newly added project (key absent but
  `last_success` non-null) use the standard **200-issue** cold-start cap.

The tighter first-run cap keeps the State A personalization wrap-up
interaction snappy (target < 60 seconds wall time).

**Cold-start cursor advance:** after a successful cold-start run for a project,
set `last_updated` to `max(issue.fields.updated)` truncated to minute precision,
exactly as steady-state. The timestamp from the 30-day bootstrap window is a
valid cursor for the next incremental run.

---

## 4. Steady-state behaviour and clock-skew handling

Each incremental run for a project:

1. Read `cursor.projects[project_key].last_updated` (minute-precision string).
2. Parse it as a UTC datetime, subtract **60 seconds**, truncate the result back
   to minute precision. This produces `query_ts`.

   ```
   query_ts = floor_to_minute(parse(last_updated) - 60s)
   ```

   Form the JQL clause as:

   ```
   project = {project_key}
     AND updated >= "{query_ts formatted as 'YYYY-MM-DD HH:mm'}"
   ORDER BY updated DESC
   ```

   **Why subtract 60 seconds?** Jira's JQL `updated >=` honours minute
   granularity only. If `last_updated` is `"2026-06-08 14:30"`, an issue
   updated at `14:30:55` on that run is stored at the same minute value.
   The next run without the margin would query `updated >= "2026-06-08 14:30"`,
   which is still inclusive — but Jira's indexing lag can cause that issue to
   miss the window by a second or two. Subtracting 60 seconds and re-querying
   from `"2026-06-08 14:29"` guarantees overlap. Deduplication at Step 9
   (matching on `source_id`) absorbs any duplicates produced by the overlap.

3. Fetch up to **200 issues** per project per pass.
4. Sort is `ORDER BY updated DESC`. When the 200 cap is hit, the oldest issues
   in the window are deferred; the cursor still advances to the newest
   `updated_at` seen. The 60-second overlap on the next pass covers the boundary
   minute.

**Volume cap hit logging:** when `searchJiraIssuesUsingJql` returns exactly 200
results for a project, write `volume_cap_hit: true` for that project in the sync
state debug log. Not an error.

---

## 5. Tracked-parent registry — NOT needed for Jira

Jira issues are the parent entity with stable, globally unique keys (e.g.
`OFM-412`). Comments are fetched inline via `getJiraIssue` whenever the issue
appears in a run's result set.

**The key question from the source-semantics advisor:** when a new comment lands
on an issue, does the issue's `updated` field bump?

**Yes — Jira bumps the issue `updated` timestamp on every comment add.** Any
issue that received a new comment re-surfaces in the next incremental run's
`updated >= query_ts` query automatically. There is no need for a separate
`{project_key}#{issue_key}` tracked-parent registry.

This is the same behaviour as Linear, GitHub PRs, and most CRM records. The
per-project cursor is sufficient. Do NOT fold a tracked-parent dimension into
the cursor map — project-level keys only.

Incremental comment filtering is handled by comparing `comment.created` against
`last_comment_seen_at` (Step 5e), not by cursor key shape.

---

## 6. Project list changes

**New project appears in `getVisibleJiraProjects`:**
The project key will have no entry in `projects`. Treat it as cold-start
(section 3). Process it in the same run if below the first-run project cap;
otherwise leave the key absent and pick it up in the next scheduled run.

**Project disappears from `getVisibleJiraProjects` for fewer than 14 days:**
Leave its entry in `projects`. Do not query it (it won't appear in the live
list). Do not evict it. If it reappears (OAuth re-scoped, project temporarily
archived), the existing cursor resumes incremental processing from the last
known position.

**Project disappears from `getVisibleJiraProjects` for 14 or more consecutive
days:**
Evict its entry from `projects`. Append a `jira-cursor-evicted` error entry to
`sync.md → errors` naming the evicted project key and the eviction date. If the
project reappears after eviction it re-enters cold-start. Count consecutive
absence days by comparing the current run date against the `last_seen_issue_count`
update date stored in the entry; if no activity log is available, use the
`last_success` date as the proxy.

**Project key changes:** Not a supported Jira Cloud operation (project keys are
immutable). No handling needed.

---

## 7. Gap recovery

A gap occurs when the cursor is stale enough that relevant issues may have been
updated, re-indexed, or the Jira instance migrated.

**Detection:** At Step 4, if `last_updated` for a project is older than **90
days** relative to today, treat the project as cold-start and re-fetch with the
bootstrap window (section 3). Log a `jira-cursor-evicted` event to the sync
state with the reason `gap > 90 days`.

**Manual reset:** The user can force a full re-ingest for a specific project by
deleting its key from `projects` in `data/learnings/agntux-jira/sync.md`. The
next run treats it as cold-start. Document this in `reference/runbook.md` as
`cursor-manual-reset`.

---

## 8. Worked diff example (incremental run)

Prior cursor (abbreviated):

```
cursor: {"cloudIds":["abc123"],"projects":{"OFM":{"last_updated":"2026-06-07 18:00","last_comment_seen_at":"2026-06-07T18:00:00Z","last_seen_issue_count":31},"PLAT":{"last_updated":"2026-06-07 09:15","last_comment_seen_at":"2026-06-07T09:15:00Z","last_seen_issue_count":17}},"schema_version":1}
```

This run processes OFM (14 issues) and PLAT (3 issues); discovers ENG as new;
no write failures:

- **Advanced:** `OFM.last_updated`: `"2026-06-07 18:00"` → `"2026-06-08 14:30"`;
  `OFM.last_seen_issue_count`: 31 → 14.
- **Advanced:** `PLAT.last_updated`: `"2026-06-07 09:15"` → `"2026-06-08 11:45"`;
  `PLAT.last_seen_issue_count`: 17 → 3.
- **Added:** `ENG` (cold-start entry, written after its successful bootstrap
  pass with the first batch of issues).

New cursor:

```
cursor: {"cloudIds":["abc123"],"projects":{"OFM":{"last_updated":"2026-06-08 14:30","last_comment_seen_at":"2026-06-08T14:30:22Z","last_seen_issue_count":14},"PLAT":{"last_updated":"2026-06-08 11:45","last_comment_seen_at":"2026-06-08T11:45:08Z","last_seen_issue_count":3},"ENG":{"last_updated":"2026-06-08 09:00","last_comment_seen_at":"2026-06-08T09:00:00Z","last_seen_issue_count":67}},"schema_version":1}
```

Cursor diff line logged:

```
cursor advance — added: ENG×1 | advanced: OFM×14, PLAT×3
```

---

## 9. Sync state frontmatter keys (complete reference)

All cursor-related keys live in `data/learnings/agntux-jira/sync.md` frontmatter:

| Key | Type | Description |
|---|---|---|
| `cursor` | JSON object (one line) | Structured cursor object: `cloudIds`, `projects` map, `schema_version`. |
| `lock` | ISO 8601 string or null | Soft lock timestamp. Null when idle. Stale after 1 hour (canonical reclaim rule). |
| `last_run` | ISO 8601 string or null | Timestamp of most recent run attempt (success or failure). |
| `last_success` | ISO 8601 string or null | Timestamp of last run where all writes succeeded and cursor advanced. |
| `errors` | list | Last 10 error/debug entries, FIFO-bounded. |

Note: `cloudIds` are stored inside the `cursor` object (not as separate
top-level frontmatter keys) because they form part of the cursor's versioned
schema. They are workspace-stable and never re-derived per item once populated.
