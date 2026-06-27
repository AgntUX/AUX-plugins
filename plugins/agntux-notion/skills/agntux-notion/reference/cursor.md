# Cursor semantics — agntux-notion
# Wholesale replacement of canonical reference/cursor.md for this plugin.

This file is the authoritative runtime cursor reference for `agntux-notion`. It
supersedes any cursor notes in the canonical `reference/sync.md` or in
`_overrides/frontmatter.yaml` where those conflict with what is written here.

The strategy is a **single global `last_edited_time` low-water-mark**: one ISO
8601 UTC timestamp stored under the `cursor` key in
`data/learnings/agntux-notion/sync.md` frontmatter. This low-water-mark is
applied as the `last_edited_time` lower-bound filter on every incremental
`notion-search` call, covering pages, database items, and meeting notes in a
single pass.

This file also governs the **`seen_comment_ids` FIFO**, which is the comment-
dedup registry required because Notion page `last_edited_time` does NOT advance
when a comment is added (see section 3).

---

## 1. Why a single low-water-mark is the right cursor shape for Notion

The choice of cursor shape is dictated by what the API can filter on and by
whether comments surface via their parent's edit timestamp.

### 1a. Global timestamp filter covers all object types

Notion exposes `last_edited_time` as a first-class sortable, filterable property
on every page and database item. The `notion-search` tool accepts a single
`last_edited_time` lower-bound that returns all object types simultaneously —
there is no per-database or per-teamspace cursor needed. A per-database cursor
map (analogous to Slack's per-channel map) would add complexity without benefit:
no scenario exists where one database's cursor should differ from another's,
because the ingest window is always defined by the single query-window timestamp
applied uniformly.

**Contrast with Slack:** Slack has no workspace-wide history cursor; each channel
is an independent sequence. Notion's `notion-search` is a workspace-wide
endpoint, making a single scalar cursor the natural and correct shape.

**Contrast with Jira (per-project map):** Jira requires a per-project cursor
because the JQL `project = X AND updated >= ...` clause must be scoped per
project for correctness and pagination. Notion has no equivalent per-container
JQL clause — the global `last_edited_time` filter is sufficient across the
entire connected workspace.

### 1b. Comments do NOT advance the parent page's `last_edited_time`

When a comment is added to a Notion page, the page's `last_edited_time` is NOT
updated. The page will NOT re-surface in an incremental `notion-search` filtered
by `last_edited_time`. This is the canonical "parent does not bump" scenario
described in the source-semantics advisor system prompt.

This means a tracked-parent registry is required for comments. However, unlike
Slack's `{channel_id}#{thread_ts}` cursor keys (where cursor values track the
newest reply timestamp per thread), Notion's `notion-get-comments` call fetches
ALL comments on a page in one response with no time-filtering capability at the
API level. There is no incrementalcomment cursor to store per page; the
connector always returns all comments on a page when called.

The correct mechanism, established in `_overrides/reference/fetch.md`, is a
**bounded FIFO of already-processed comment ids** stored in
`sync.md → seen_comment_ids`. On each run, before processing a comment, check
whether its `comment_id` is in the FIFO. If present, skip. If absent, process
and add to the FIFO. This provides idempotent comment dedup without a per-page
cursor entry in the main cursor field.

The single scalar `cursor` value is therefore correct and complete for the page/
database-item dimension. The comment dimension is covered by `seen_comment_ids`
(section 3).

---

## 2. Cursor type and storage shape

**Type:** ISO 8601 UTC timestamp string — the newest `last_edited_time` seen
across all pages and database items successfully processed in the last run.

**Storage:** A plain string on the `cursor` line in
`data/learnings/agntux-notion/sync.md` frontmatter.

### Bootstrap state (sync.md — initial, no successful run yet)

```yaml
---
plugin: agntux-notion
version: 0.1.0
cursor: null
self_user_id: null
seen_comment_ids: []
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

`cursor: null` means bootstrap mode — fetch the full `bootstrap_window_days`
window. `seen_comment_ids: []` means no comments have been processed yet.

### Steady-state sync.md (after a successful run)

```yaml
---
plugin: agntux-notion
version: 0.1.0
cursor: "2026-06-26T14:00:00.000Z"
self_user_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
seen_comment_ids: ["comment-uuid-1","comment-uuid-2","comment-uuid-3"]
last_run: "2026-06-26T18:05:00Z"
last_success: "2026-06-26T18:05:00Z"
items_processed: 23
lock: null
errors: (none)
---
```

The `cursor` value is always ISO 8601 UTC at millisecond precision (as returned
by the Notion API). Store it verbatim — do not normalise, truncate, or re-format.

The `seen_comment_ids` list is stored as an inline YAML sequence on a single
line or as a compact block. If the YAML parser in the runtime produces a
multi-line block, that is acceptable — the key constraint is that the total
number of entries must be bounded (section 3). Do not store timestamps next to
comment ids; the id alone is the dedup key.

### Additional top-level frontmatter keys

| Key | Type | Description |
|---|---|---|
| `cursor` | ISO 8601 UTC string or null | Global low-water-mark: newest `last_edited_time` seen across all successfully processed pages and database items. Null = bootstrap. |
| `self_user_id` | Notion UUID string or null | The authenticated user's Notion user id, resolved once via `notion-get-users(user_id: "self")` and persisted. Reused on subsequent runs without re-fetching (unless `last_success` is more than 7 days old). |
| `seen_comment_ids` | list of UUID strings | Bounded FIFO of comment ids already processed. Max 500 entries; oldest entries evicted first when the cap is reached. See section 3. |
| `lock` | ISO 8601 string or null | Soft lock timestamp. Null when idle. Stale after 1 hour (canonical reclaim rule). |
| `last_run` | ISO 8601 string or null | Timestamp of most recent run attempt (success or failure). |
| `last_success` | ISO 8601 string or null | Timestamp of last run where every action write succeeded and cursor advanced. |
| `items_processed` | integer | Count of pages and database items processed (not noise-dropped) in the last successful run. Excludes comment-only updates. |
| `errors` | list | Last 10 error/debug entries, FIFO-bounded, newest first. Permitted `kind` values in `_overrides/frontmatter.yaml`. |

---

## 3. Comment-dedup registry (`seen_comment_ids`)

Because Notion does not bump a page's `last_edited_time` on comment addition,
pages that are only receiving new comments will not re-surface through the
`cursor`-filtered `notion-search`. Step 5g in `_overrides/reference/fetch.md`
handles this by re-polling comments for a bounded set of pages on every run.
The `seen_comment_ids` FIFO prevents those pages' already-processed comments
from being re-raised as new signals.

### How to apply the registry at Step 5g

For each page in the Step 5g comment-polling set, call `notion-get-comments`.
For each returned comment:

1. Look up the comment's `id` in `seen_comment_ids`.
2. **If present:** the comment was processed in a prior run. Skip it entirely —
   do not re-classify, do not raise an action item, do not re-write any entity
   section for it.
3. **If absent:** this is a new comment. Process it normally (classify, raise
   action item if applicable, update entity `## Comments` section). Add the
   comment `id` to the pending-additions list (section 3b).

### How to advance the registry (Step 11)

The `seen_comment_ids` list is updated **as part of the same atomic write that
advances the `cursor` and releases the lock** at Step 11.

1. Collect all new comment ids processed this run (the pending-additions list).
2. Append them to the existing `seen_comment_ids` list.
3. If the combined length exceeds 500, evict entries from the front (oldest
   first) until the list is exactly 500 entries.
4. Write the trimmed list back to `sync.md → seen_comment_ids`.

**If any action write failed this run** (see transactional rule in section 4):
do not advance `cursor`, do not append to `seen_comment_ids`. The failed
comments will be re-encountered on the next run and re-processed; this is
correct and intentional. Idempotent entity writes (section 5) ensure re-
processing a comment does not duplicate entity content.

### Registry capacity and eviction

500 entries at roughly 36 bytes per UUID = ~18 KB maximum. This is well within
frontmatter size bounds. At a cadence of every 4 hours and a per-run cap of 30
comment-polled pages, eviction pressure is low for typical workspaces. High-
activity workspaces (many pages with dense comment threads) may evict older
entries — an evicted comment id can only cause a re-raise of a comment that was
already processed. The meaningful-change check and entity-merge path in Step 7
will absorb re-processed comments as updates rather than new entities, and the
action-item dedup at Step 9 will prevent duplicate action items from being
written.

**Do not increase the cap above 500** without also updating the registered cap
note in `canonical/prompts/ingest/cursor-strategies.md`. Do not store additional
metadata (timestamps, page ids) alongside comment ids in this list — the id
alone is the minimal dedup key and any metadata would balloon the frontmatter
size unnecessarily.

---

## 4. Advance rule (transactional)

The `cursor` and `seen_comment_ids` both advance **only at Step 11, and only
when every action write in the current run has succeeded.** This is the
transactional advance rule from `canonical/prompts/ingest/cursor-strategies.md`.

### Computing the new cursor value

At Step 11, before writing:

1. Collect all pages and database items whose action writes (or entity-only
   updates) succeeded this run.
2. Compute `max(last_edited_time)` over those items.
3. The new cursor is that maximum value, stored verbatim as returned by the
   Notion API (ISO 8601 UTC millisecond string).

**Non-regression rule:** if `max(last_edited_time)` this run is less than or
equal to the existing stored cursor value, leave the cursor unchanged. Cursor
values never regress.

**Zero items processed:** if `notion-search` returns no results above
`filter_ts` and no database items were returned by Steps 5d–5e, do not advance
the cursor. Leave it at its pre-run value.

### Advance to newest-item-ts, not start-of-run

Notion's `last_edited_time` is returned at sub-second ISO 8601 precision. The
cursor is used directly as a filter lower bound: `last_edited_time >= cursor −
60s`. Using `max(last_edited_time)` of items processed — not the start-of-run
wall clock — ensures the cursor precisely tracks what was seen, rather than
introducing an artificial gap between run start and the first item processed.

**Why not start-of-run (unlike Jira and Google Drive)?** Jira and Google Drive
use start-of-run because their filter fields are minute-precision (Jira JQL) or
because the same timestamp is used across multiple independent folder queries
(Google Drive), making a shared start-of-run sentinel safer. Notion's `notion-
search` accepts a single ISO 8601 filter applied uniformly to all object types
in one call. Advancing to newest-item-ts is more precise here, and the mandatory
60-second safety margin on every incremental run fully absorbs any Notion
indexing lag or sub-second boundary effects.

### Write timing

All cursor updates — `cursor`, `seen_comment_ids`, `last_success`, `last_run`,
`items_processed`, and lock release — are applied in a **single atomic write**
at Step 11. Do not write any cursor-adjacent field earlier in the run.

### Failure handling

If any action write in Step 10 failed (validator rejection, filesystem error,
lock contention, retry budget exhausted):

1. Record each failure in `sync.md → errors` (FIFO cap: last 10 entries).
2. Re-attempt each failed write once within the same run.
3. If any write is still failing after retry, **do not advance `cursor`** and
   **do not append to `seen_comment_ids`**. Leave both at their pre-run values.
4. The next run re-processes the same window from the same cursor.

Log the cursor diff at run end in the standard format:

```
cursor advance — advanced: cursor 2026-06-25T14:00:00.000Z→2026-06-26T14:00:00.000Z, seen_comment_ids +3 (total 47)
```

If the cursor did not advance (zero items or write failure), log:

```
cursor advance — skipped: no items processed above filter_ts
```

or

```
cursor advance — skipped (write failure): N action writes failed after retry
```

---

## 5. Lookup-before-write protocol for idempotent entity writes

Every entity write (Step 7) must follow the `_sources.json` lookup-before-write
protocol from the source-semantics advisor. This is especially important for
Notion because the 60-second safety margin and the `seen_comment_ids` re-poll
both cause the same page to be encountered on consecutive runs, and because
onboarding-mode bootstrap may process a large initial window.

### Step-by-step protocol (Step 6 before every entity write)

1. **Read** `<agntux_root>/entities/_sources.json`. If the file does not exist,
   treat as empty (no entries).
2. **Look up** `(subtype: "{notion_subtype}", source: "notion", source_id: "notion:{uuid}")` in
   `entries`.
   - `notion_subtype` is `notion-page`, `notion-database-item`, or
     `notion-comment` depending on what is being written.
   - `source_id` is constructed from the Notion object's dashed UUID exactly as
     documented in `_overrides/reference/fetch.md` (e.g.
     `notion:1a2b3c4d-5e6f-7890-abcd-ef1234567890`).
3. **If found:** open the existing entity file at `entities/{subtype}/{slug}.md`.
   **Merge** into it (update `## Recent Activity`, `## Properties`, `## Comments`
   sections as appropriate). Do NOT create a new file.
4. **If not found:** search secondary identifiers — Grep on the entity's Notion
   title slug, then on natural-language name variations. On match, resolve and add
   the new `(source: "notion", source_id: ...)` as an alias. The PostToolUse
   hook upserts `_sources.json` after the entity Write.
5. **Only when no match exists:** create a new entity file with the canonical
   required frontmatter. The PostToolUse hook writes the new entry to
   `_sources.json` after the Write.

### People entities and email cross-source resolution

When a `last_edited_by.id` or comment `author.id` resolves to a new `person`
entity (not yet in `_sources.json`), call
`notion-get-users(user_id: "{notion_user_id}")` once to obtain the user's
`email`. Add the email as a canonical cross-source alias on the `person` entity.

This ensures that the next time the same person surfaces from Gmail, Slack, or
any other source, the `_sources.json` lookup on their email resolves to the same
`person` entity rather than creating a duplicate.

Do not call `notion-get-users` more than once per user id per run (cache
resolved `(id → name + email)` pairs in working memory for the run duration).

### Comment entities and parent-keyed `source_id`

For `notion-comment` subtype entities (used only when the comment itself is the
primary action signal, per the parent-child semantics documented in
`_overrides/reference/fetch.md`), the `source_id` is
`notion:comment:{comment_uuid}`.

**The `source_ref` on any action item raised from a comment always points to the
parent page's URL** — never to the comment id. "Open in Notion" must resolve the
parent page, not a mid-thread comment. Use the parent page's `url` field (as
returned by the connector) as the `suggested_action → url` value.

---

## 6. Bootstrap and onboarding-mode behaviour

### Standard bootstrap (cursor absent or null, `last_success` non-null)

This occurs when the user installs the plugin onto an existing workspace after
a prior failed run, or manually resets the cursor. Fetch window:
`last_edited_time >= (now − bootstrap_window_days days)`. Volume cap: the
standard caps from `_overrides/reference/fetch.md` (100 pages from search, 50
database items, 20 meeting notes).

### First-run onboarding (`last_success: null` AND `cursor: null`)

The Personalization State A wrap-up fires `/agntux-sync agntux-notion`
synchronously with the user present. Target: under 60 seconds wall time.

On the first run ever:

- Run Steps 5a–5b normally (resolve `self_user_id`; compute `filter_ts` from
  bootstrap window).
- Apply tighter caps for this run only:
  - `notion-search` results: **30 pages** (instead of 100).
  - `notion-query-database-view` results: **20 items** (instead of 50).
  - `notion-query-meeting-notes` results: **10 records** (instead of 20).
  - Deep-fetch shortlist (Step 5f): **10 pages** (instead of 30).
  - Comment polling (Step 5g): **10 pages** (instead of 30).
- Log `onboarding-mode: true` in the sync-state debug log before any search
  call.

These caps are intended to keep the first-run interaction snappy. The next
scheduled background run (4 hours later) processes the full window without the
onboarding caps, using the cursor established by the first run as its
lower bound.

Do not apply onboarding caps on a subsequent run where the cursor is null due
to a manual reset (detected by `last_success non-null AND cursor null`). Only
trigger on the combined `last_success: null AND cursor: null` condition.

---

## 7. Gap recovery (cursor malformed or irrecoverably stale)

### Cursor value is present but not a valid ISO 8601 string

**Detection:** At Step 2 (read state), if `cursor` is present but cannot be
parsed as a valid ISO 8601 datetime, the cursor is malformed.

**Recovery procedure:**

1. Log `notion-cursor-evicted` (kind: `source`) with the raw malformed value and
   reason `"cursor value is not a valid ISO 8601 datetime"`.
2. Reset `cursor` to null — treat this run as bootstrap.
3. Do NOT reset `seen_comment_ids`. The comment-dedup registry survives a cursor
   reset; previously-processed comment ids remain deduplicated.
4. Continue the run with the full `bootstrap_window_days` window and the standard
   (non-onboarding) volume caps.

### Cursor is extremely old (> 90 days behind the current date)

Notion's `notion-search` has no documented time-range expiry (unlike Gmail's 30-
day `historyId` purge). An old cursor simply means a larger result set will be
returned. This is not an error; it is the normal catch-up path.

**Recovery procedure:** the existing volume caps (section 6) limit the work per
run. Process the oldest items first (sort by `last_edited_time ASC` when the
connector supports ordering), advance the cursor to the newest item processed,
and exit. The next scheduled run continues the backlog. Log
`notion-search-overflow` if the caps were hit.

No `notion-cursor-evicted` event is written for an old-but-valid cursor.

---

## 8. Sync state frontmatter keys (complete reference)

All cursor-adjacent keys live in `data/learnings/agntux-notion/sync.md`
frontmatter:

| Key | Type | Description |
|---|---|---|
| `cursor` | ISO 8601 UTC string or null | Global low-water-mark: newest `last_edited_time` across all successfully processed pages and database items. Null = bootstrap. |
| `self_user_id` | Notion UUID string or null | Authenticated user's Notion user id. Resolved once per 7 days via `notion-get-users(user_id: "self")`. Required for mention and assignment filtering in Steps 5c–5g. |
| `seen_comment_ids` | list of UUID strings | Bounded FIFO, max 500 entries. Comment ids processed in prior runs. Evict from front (oldest) when cap reached. Survives cursor resets. Updated atomically at Step 11. |
| `lock` | ISO 8601 string or null | Soft lock timestamp. Null when idle. Stale after 1 hour (canonical reclaim rule). |
| `last_run` | ISO 8601 string or null | Timestamp of most recent run attempt (success or failure). |
| `last_success` | ISO 8601 string or null | Timestamp of last run where every action write succeeded and cursor advanced. |
| `items_processed` | integer | Count of pages and database items processed in the last successful run. Excludes comment-only updates. |
| `errors` | list | Last 10 error/debug entries, FIFO-bounded, newest first. |

---

## 9. Worked example (incremental run)

**Prior sync.md cursor state:**

```yaml
cursor: "2026-06-26T10:00:00.000Z"
self_user_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
seen_comment_ids: ["cmt-aaa","cmt-bbb","cmt-ccc"]
last_success: "2026-06-26T10:05:00Z"
```

**This run (4 hours later at 14:05 UTC):**

- `filter_ts = 2026-06-26T10:00:00.000Z − 60s = 2026-06-26T09:59:00.000Z`
- `notion-search` returns 8 pages. Newest `last_edited_time`: `"2026-06-26T14:00:00.000Z"`.
- `notion-query-database-view` returns 3 database items. Newest: `"2026-06-26T13:45:00.000Z"`.
- Step 5g polls comments on 4 pages. Returns 5 comments total:
  - `cmt-aaa`, `cmt-bbb`: already in `seen_comment_ids` — skipped.
  - `cmt-ddd`, `cmt-eee`, `cmt-fff`: new — processed and added to pending-additions.
- All action writes succeed (3 action items raised, 8 entity updates).

**New cursor at Step 11:**

```
max(last_edited_time) across 11 items = "2026-06-26T14:00:00.000Z"
```

New `seen_comment_ids` = `["cmt-aaa","cmt-bbb","cmt-ccc","cmt-ddd","cmt-eee","cmt-fff"]` (6 entries; under cap of 500).

**Cursor diff log line:**

```
cursor advance — advanced: cursor 2026-06-26T10:00:00.000Z→2026-06-26T14:00:00.000Z, seen_comment_ids +3 (total 6)
```

**New sync.md cursor state:**

```yaml
cursor: "2026-06-26T14:00:00.000Z"
self_user_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
seen_comment_ids: ["cmt-aaa","cmt-bbb","cmt-ccc","cmt-ddd","cmt-eee","cmt-fff"]
last_run: "2026-06-26T14:05:00Z"
last_success: "2026-06-26T14:05:00Z"
items_processed: 11
lock: null
errors: (none)
```
