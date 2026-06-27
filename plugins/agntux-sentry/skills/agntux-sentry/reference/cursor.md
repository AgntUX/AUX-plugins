# Cursor semantics — agntux-sentry
# Wholesale replacement of canonical reference/cursor.md for this plugin.

This file is the authoritative runtime cursor reference for `agntux-sentry`. It
supersedes any cursor notes in the canonical `reference/sync.md` or in
`_overrides/frontmatter.yaml` where those conflict with what is written here.

The strategy is a **per-project `lastSeen` high-water-mark map**: a JSON object
keyed by Sentry project slug, whose values are ISO 8601 UTC timestamps
representing the newest issue `lastSeen` observed across issues successfully
processed in the last run for that project. Each project cursor advances and
recovers independently.

---

## 1. Cursor field selection: `lastSeen`, not a run-start clock

### 1a. Why `lastSeen` is the correct incremental key

Sentry's `search_issues` supports a `lastSeen:>{timestamp}` filter in the query
string and `sort: "date"` returns issues ordered by most-recent event first.
`lastSeen` on a Sentry issue is set to the timestamp of the most recent **error
event** occurrence for that issue. It is advanced by Sentry's grouping engine
every time a new event matches the issue fingerprint.

This is the correct incremental key for an error-tracking plugin. New error
events are the primary signal; they advance `lastSeen` and cause the issue to
re-surface in the next `search_issues?sort=date&lastSeen:>{cursor}` call. This
is the "parent bumps" pattern from the source-semantics advisor: no tracked-
parent registry is required (see section 4).

### 1b. What `lastSeen` does NOT cover — explicit documentation

`lastSeen` does NOT advance on:

- New comments added to an issue.
- Assignee changes, tag changes, or other metadata edits.
- Status transitions (resolve, ignore, unresolve) unless a new event arrives
  after the transition.

**This is intentional and acceptable for an error-tracking plugin.** The primary
value signal is error activity — new occurrences escalating user impact. Pure
metadata changes (comments, assignee) are secondary. They are surfaced
indirectly: if an issue has new events this run, the deep-fetch step (5e) picks
up any comments and metadata that exist at fetch time. Pure-comment-only issues
that have no new events since the cursor will be missed until the next event
arrives. This tradeoff is documented and accepted.

If a future version of the plugin needs to surface comment-only activity, the
correct extension is a `seen_comment_ids` FIFO (analogous to the Notion
pattern), not a change to the cursor field. Do not change the cursor field to a
run-start clock to "catch" metadata changes — that would defeat the per-project
incremental filter entirely by re-fetching all unresolved issues on every run.

### 1c. `lastSeen` vs start-of-run (advance rule deviation from canonical)

Jira, Google Drive, and HubSpot use **start-of-run** as the cursor advance
value. The rationale for those sources: Jira JQL is minute-precision (sub-minute
items cluster at the boundary); Drive scans multiple independent folder queries
sharing one sentinel; HubSpot has a ~20-second search-index lag requiring a
safety margin applied at read time rather than at write time.

Sentry's `lastSeen` is returned at sub-second ISO 8601 precision (`2026-06-25T
18:00:00.000Z`) and the filter is an exclusive lower-bound (`lastSeen:>`). Using
start-of-run as the advance value would mean re-fetching every issue whose
`lastSeen` falls between the run-start clock and the newest item seen — a
potentially large window on busy projects. Using `max(lastSeen)` across
successfully processed issues (newest-item-ts) is more precise.

**Safety margin:** to absorb boundary effects (two issues with the same
millisecond `lastSeen`; Sentry's indexing lag), the filter applied on each
incremental run subtracts **1 second** from the stored cursor value:

```
filter_ts = stored_cursor − 1s
query: "is:unresolved lastSeen:>{filter_ts}"
```

This is analogous to Notion's 60-second margin but smaller because Sentry's
event pipeline lag is typically under 1 second for the issues endpoint. The 1-
second overlap means a small number of already-processed issues may re-surface;
the deduplication gate at Step 9 (matching on `source_id` in `_sources.json`)
absorbs them without creating duplicates or duplicate action items.

---

## 2. Cursor type and storage shape

**Type:** JSON object serialised as a single-line string on the `cursor` key in
`data/learnings/agntux-sentry/sync.md` frontmatter.

- Keys: Sentry project slugs (e.g. `"web"`, `"api-worker"`).
- Values: ISO 8601 UTC millisecond timestamp strings.
- Absent key: bootstrap mode for that project.
- `null` value: treated as absent (bootstrap).
- Top-level `cursor: null`: all projects in bootstrap mode.

Serialise with `JSON.stringify(obj)` (no pretty-printing, no newlines).

### Bootstrap state (sync.md — initial, no successful run yet)

```yaml
---
plugin: agntux-sentry
version: 0.1.0
cursor: null
org_slug: null
org_id: null
projects: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

`cursor: null` means bootstrap mode for all projects. `org_slug` and `org_id`
are populated during Step 5a (first run). `projects` is populated during Step 5b.

### Steady-state sync.md (after a successful run)

```yaml
---
plugin: agntux-sentry
version: 0.1.0
cursor: {"web":"2026-06-25T18:00:00.000Z","api-worker":"2026-06-25T17:45:00.000Z","mobile-ios":"2026-06-25T16:30:00.000Z"}
org_slug: "acme"
org_id: "1234567"
projects: [{"slug":"web","name":"Web Frontend"},{"slug":"api-worker","name":"API Worker"},{"slug":"mobile-ios","name":"Mobile iOS"}]
last_run: "2026-06-25T18:05:22Z"
last_success: "2026-06-25T18:05:22Z"
items_processed: 34
lock: null
errors: (none)
---
```

The `cursor` value is always stored as a single-line JSON object. The `projects`
value is stored as a JSON array (single line). Both are written atomically at
Step 11.

### Additional top-level frontmatter keys

| Key | Type | Description |
|---|---|---|
| `cursor` | JSON object (one line) or null | Per-project `lastSeen` high-water-mark map. Null at bootstrap. |
| `org_slug` | string or null | Sentry organisation slug. Written once on first successful `find_organizations` call; reused across runs (skip `find_organizations` when present and `last_success` within 7 days). |
| `org_id` | string or null | Sentry organisation numeric id. Written alongside `org_slug`; used for deep-link construction. |
| `projects` | JSON array or null | List of `{slug, name}` objects from `find_projects`. Written once per 24-hour window; reused otherwise. |
| `lock` | ISO 8601 string or null | Soft lock timestamp. Null when idle. Stale after 1 hour (canonical reclaim rule). |
| `last_run` | ISO 8601 string or null | Timestamp of most recent run attempt (success or failure). |
| `last_success` | ISO 8601 string or null | Timestamp of last run where every action write succeeded and the cursor advanced. |
| `items_processed` | integer | Count of issues processed (not noise-dropped) in the last successful run. |
| `errors` | list | Last 10 error/debug entries, FIFO-bounded, newest first. Permitted `kind` values in `_overrides/frontmatter.yaml`. |

---

## 3. Advance rule (transactional, per project)

The cursor advances **only at Step 11, and only when every action write in the
current run has succeeded.**

### Computing the new cursor value per project

For each project processed this run:

1. Collect all issues whose entity writes and action writes (if applicable)
   succeeded.
2. Compute `max(lastSeen)` across those issues.
3. The new `cursor[project_slug]` is that value, stored verbatim as returned by
   the Sentry API (ISO 8601 UTC millisecond string).

**Non-regression rule:** if `max(lastSeen)` for a project this run is less than
or equal to the existing stored value for that project, leave the existing value
unchanged. Never regress a project cursor.

**Zero-result projects:** if `search_issues` returns no issues above `filter_ts`
for a project, leave that project's cursor unchanged. Do not advance to `now`.

**Pagination-overflow exception (per project):** when the 50-issue cap is hit
mid-pagination for a project (logged as `sentry-pagination-overflow`), advance
that project's cursor to `max(lastSeen)` across the collected batch even though
the window was not exhausted. This is not a write failure. The next scheduled run
picks up the remaining issues because the cursor advanced only partway through
the `lastSeen` window.

All per-project updates are written in a **single atomic write** at Step 11,
together with `last_success`, `items_processed`, and lock release. Do not write
intermediate cursor values during the run.

### Failure handling (all-or-nothing transactional rule)

If any action write in Step 10 failed (validator rejection, filesystem error,
lock contention, retry budget exhausted):

1. Record each failure in `sync.md → errors` (FIFO cap: last 10 entries,
   newest first).
2. Re-attempt each failed write once within the same run.
3. If any write is still failing after retry: **do not advance the cursor for
   any project**. Leave `sync.md → cursor` entirely at its pre-run value.
4. The next scheduled run re-processes all projects from the same pre-run
   thresholds.

The pagination-overflow exception does not override the failure gate. If any
write failed, the entire cursor map stays at its pre-run value.

### Cursor diff log line (Step 11)

```
cursor advance — added: web×12, mobile-ios×8 | advanced: api-worker×5 | evicted: (none)
```

- `added`: project slugs whose key was absent (first time seen) and are now
  written for the first time.
- `advanced`: project slugs whose `lastSeen` value moved forward.
- `evicted`: project slugs reset due to a malformed cursor entry (section 6).

Omit any clause whose count is zero.

---

## 4. Tracked-parent registry — NOT needed for Sentry

The source-semantics advisor's key question: when a new event fires on an
existing Sentry issue, does the issue's `lastSeen` bump?

**Yes.** Sentry's `lastSeen` is explicitly the timestamp of the most recent
error event for the issue. Every new event occurrence advances `lastSeen`. This
is the "parent bumps" scenario: the issue re-surfaces automatically in the next
incremental `search_issues?lastSeen:>{cursor}` call.

No tracked-parent registry is required. The `{container_id}#{parent_id}` key
pattern from the source-semantics advisor's Slack/Notion variant is not used
here.

**Individual events (children) are not separately entityified.** Each Sentry
issue is the atomic entity unit. Individual events are children surfaced only
via the `get_sentry_resource` deep-fetch in Step 5e, and their content is stored
in the entity's `## Context` section — not as separate entity files. This is
documented in `_overrides/reference/fetch.md` (Thread and parent-child semantics
section) and is confirmed correct.

### `_sources.json` lookup-before-write for issue dedup

A Sentry issue re-surfaces on every run where it has new events. The
`_sources.json` lookup-before-write protocol (Step 6) is the primary guard
against duplicate entity files:

- `source_id` key: `sentry:{shortId}` (e.g. `sentry:web-1Z43`).
- `subtype`: `sentry_issue` (or the closest registered subtype in the contract).
- On lookup hit: merge into the existing entity file. Update `## Recent
  Activity`, `## Properties`, and `## Context` sections. Do NOT create a new
  file.
- On lookup miss: create a new entity file. The PostToolUse hook upserts
  `_sources.json` after the Write.

The `shortId` (e.g. `web-1Z43`) is stable across all event accumulation and
status changes for the lifetime of the issue. Do NOT construct `source_id` from
the numeric `id` field alone — `shortId` is the durable human-readable handle.

If an issue is merged into another issue (`sentry-merged-into` error kind), the
original `shortId` becomes an alias on the surviving issue's entity. Add it as
an alias in the `_sources.json` entry for the surviving issue.

---

## 5. Volume caps and onboarding mode

### Steady-state caps (confirmed from fetch.md)

| Resource | Cap per run |
|---|---|
| Issues per project | 50 |
| Deep-fetches (`get_sentry_resource`) | 20 total across all projects |
| Event-volume calls (`search_events`) | 5 total across all projects |

These caps are confirmed appropriate for a 30-minute cadence. At 50 issues per
project and independent per-project cursors, a project with more than 50 new
issues in 30 minutes is a genuine incident; the `sentry-pagination-overflow` log
surfaces this signal. The deep-fetch and event-volume caps are shared across all
projects; prioritise the shortlisting criteria in Step 5e (fatal/error within
48h, user_count threshold, assigned-to, 2x count spike) to allocate the 20
deep-fetch budget across projects.

**Sort direction for issue fetching:** `sort: "date"` returns newest `lastSeen`
first. In the steady state this is what we want (most recently active issues
first, most likely to be actionable). At pagination overflow, the cursor
advances to the newest-seen `lastSeen` in the collected batch; the next run
starts just below that and continues downward through the `lastSeen` timeline.
This means issues with older `lastSeen` within the same window are deferred, but
they will surface on subsequent runs as long as they remain `is:unresolved` and
within the incremental window.

### Onboarding mode (first-ever run)

**Trigger:** `last_success: null AND cursor: null` simultaneously.

The Personalization State A wrap-up fires `/agntux-sync agntux-sentry`
synchronously with the user present. Target: under 60 seconds wall time. For an
org with many projects and a 30-day bootstrap window, the full steady-state caps
(50 issues × N projects) could produce hundreds of issues in this first
synchronous run.

**First-run onboarding caps:**

- Process at most **3 projects** on the first run. Choose the 3 projects with
  the highest combined issue `count` (or the first 3 in the `find_projects`
  response if `count` data is unavailable at project enumeration time).
- Cap remaining projects: write their slugs into the cursor map with `null`
  values. A `null` value is bootstrap mode for a project; the next scheduled
  background run picks them up under standard caps.
- Issues per project this run: **10** (instead of 50).
- Deep-fetches: **5 total** (instead of 20).
- Event-volume calls: **0** (skip entirely on first run).

Log `onboarding-mode: true` in the sync-state debug log before any
`search_issues` call.

After the onboarding run, the cursor map may look like:

```json
{
  "web": "2026-06-25T18:00:00.000Z",
  "api-worker": "2026-06-25T17:45:00.000Z",
  "mobile-ios": "2026-06-25T16:30:00.000Z",
  "mobile-android": null,
  "payments": null,
  "admin": null
}
```

The next background run (30 minutes later) processes the three already-
initialised projects under standard incremental caps, and bootstraps the three
`null`-valued projects under standard bootstrap caps (50 issues each, 30-day
window).

**Do not apply onboarding caps** when `last_success` is non-null and `cursor` is
null (manual cursor reset). The onboarding trigger is `last_success: null AND
cursor: null` together; a manual reset does not fire the tight caps.

---

## 6. Gap recovery and cursor eviction

### Stale cursor (old but parseable)

Sentry's issue history has no documented expiry window analogous to Gmail's
30-day `historyId` purge. An old cursor causes a large catch-up batch; this is
not an error. Process up to the per-project cap (50 issues), advance via the
pagination-overflow exception, and defer the remainder to the next run. No
`sentry-cursor-evicted` event is written for an old-but-valid cursor.

### Malformed per-project entry

`cursor[project_slug]` is present but not a valid ISO 8601 timestamp string:

1. Log `sentry-cursor-evicted` (kind: `source`) with the project slug and the
   raw malformed value, and reason `"cursor entry for {slug} is not a valid ISO
   8601 datetime"`.
2. Reset that project's entry to null (bootstrap mode for that project only).
3. Leave all other project entries unchanged.
4. Continue the run. The `_sources.json` lookup-before-write protocol prevents
   duplicate entity creation on re-processing the bootstrap window.

### Malformed top-level JSON

`JSON.parse(cursor)` throws (the cursor line is present but not null and not
valid JSON):

1. Log `sentry-cursor-evicted` (kind: `source`) with reason `"cursor top-level
   JSON malformed"` and the raw value.
2. Reset `cursor` to null; treat all projects as bootstrap.
3. Continue the run under standard bootstrap caps (not onboarding caps — this
   is not the first-ever run).

Do NOT reset the entire cursor map when only one project's entry is malformed.

### Project slug removed from org

If a project slug present in the cursor map is no longer returned by
`find_projects`:

1. The project may have been deleted or renamed.
2. Do not attempt to fetch issues for that slug.
3. At Step 11, **evict** the missing slug from the cursor map (remove its key).
4. Log a cursor diff `evicted: {slug}×0 (project not found in find_projects)`.

---

## 7. Worked examples

### Example A — Normal incremental run

**Prior sync.md cursor state:**

```yaml
cursor: {"web":"2026-06-25T12:00:00.000Z","api-worker":"2026-06-25T11:45:00.000Z"}
last_success: "2026-06-25T12:05:00Z"
```

**This run (30 minutes later at 12:35 UTC):**

- `web`: `filter_ts = 2026-06-25T12:00:00.000Z − 1s = 2026-06-25T11:59:59.000Z`
  `search_issues` returns 7 issues. Newest `lastSeen`: `"2026-06-25T12:30:00.000Z"`.
- `api-worker`: `filter_ts = 2026-06-25T11:44:59.000Z`
  `search_issues` returns 2 issues. Newest `lastSeen`: `"2026-06-25T12:15:00.000Z"`.
- Deep-fetch: 4 issues shortlisted (3 fatal within 48h, 1 high user_count). All
  succeed.
- All action writes succeed (2 action items raised, 7 entity updates).

**New cursor at Step 11:**

```json
{"web":"2026-06-25T12:30:00.000Z","api-worker":"2026-06-25T12:15:00.000Z"}
```

**Cursor diff log line:**

```
cursor advance — advanced: web×7, api-worker×2
```

---

### Example B — First-run onboarding

**Prior cursor:** `null`. `last_success: null`. Onboarding caps apply.

**Org has 5 projects:** `web`, `api-worker`, `mobile-ios`, `mobile-android`,
`payments`.

**This run:** process 3 projects only (`web`, `api-worker`, `mobile-ios`).

- `web`: 10 issues (cap hit). Newest `lastSeen`: `"2026-06-25T18:00:00.000Z"`.
- `api-worker`: 8 issues. Newest `lastSeen`: `"2026-06-25T17:45:00.000Z"`.
- `mobile-ios`: 3 issues. Newest `lastSeen`: `"2026-06-25T16:30:00.000Z"`.
- `mobile-android`, `payments`: keys written as null (bootstrap for next run).

All writes succeed.

**New cursor at Step 11:**

```json
{"web":"2026-06-25T18:00:00.000Z","api-worker":"2026-06-25T17:45:00.000Z","mobile-ios":"2026-06-25T16:30:00.000Z","mobile-android":null,"payments":null}
```

**Cursor diff log line:**

```
cursor advance — added: web×10 (cap hit; onboarding), api-worker×8, mobile-ios×3 | queued bootstrap: mobile-android, payments
```

Next background run: `web`, `api-worker`, `mobile-ios` run incrementally under
standard caps; `mobile-android` and `payments` bootstrap under standard caps
(50 issues each, 30-day window).

---

### Example C — Write failure (transactional gate)

**Prior cursor:** `{"web":"2026-06-25T12:00:00.000Z"}`.

**This run:** 5 issues fetched for `web`. 4 entity writes succeed. 1 action item
write fails (validator rejection).

Re-attempt: still fails.

**Step 11:** cursor does NOT advance. `sync.md → cursor` stays at
`{"web":"2026-06-25T12:00:00.000Z"}`. Failure logged to `sync.md → errors`.

**Cursor diff log line:**

```
cursor advance — skipped (write failure): 1 action write failed after retry
```

Next run re-processes from `filter_ts = 2026-06-25T11:59:59.000Z`. The 5 issues
are re-fetched; the 4 that succeeded previously are merged (not duplicated) via
`_sources.json` lookup-before-write. The failing write is retried from scratch.

---

## 8. Sync state frontmatter keys (complete reference)

| Key | Type | Description |
|---|---|---|
| `cursor` | JSON object (one line) or null | Per-project `lastSeen` high-water-mark map. Keys: Sentry project slugs. Values: ISO 8601 UTC millisecond timestamps. Absent key or null value = bootstrap for that project. Top-level null = all projects in bootstrap. |
| `org_slug` | string or null | Sentry org slug from `find_organizations`. Written once; reused when `last_success` within 7 days. |
| `org_id` | string or null | Sentry org numeric id. Written with `org_slug`. Used for deep-link URL construction. |
| `projects` | JSON array or null | `[{slug, name}]` from `find_projects`. Written once per 24-hour window. |
| `lock` | ISO 8601 string or null | Soft lock timestamp. Null when idle. Stale after 1 hour (canonical reclaim rule). |
| `last_run` | ISO 8601 string or null | Timestamp of most recent run attempt (success or failure). |
| `last_success` | ISO 8601 string or null | Timestamp of last run where every action write succeeded and the cursor advanced. |
| `items_processed` | integer | Count of issues processed (not noise-dropped) in the last successful run. |
| `errors` | list | Last 10 error/debug entries, FIFO-bounded, newest first. Permitted `kind` values in `_overrides/frontmatter.yaml`. |
