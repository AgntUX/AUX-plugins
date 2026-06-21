# Cursor advance reference — agntux-google-drive (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/cursor.md`.

Google Drive uses a **hybrid time-watermark + per-fileId last-seen map**
strategy. The cursor is a JSON object stored on the `sync.md → cursor`
line. It has exactly two keys: `watermark` (a single ISO-8601 UTC
timestamp fed to `search_files` as the `modifiedTime >` filter) and
`files` (a JSON object keyed by Drive `id`, each value the ISO-8601
UTC `modifiedTime` last successfully processed for that file).

---

## Strategy name

**Hybrid time-watermark + per-fileId last-seen map**

This compound is required because Drive has two independent dedup
requirements no single-cursor shape satisfies:

1. **Server-side filtering** — Drive's `search_files` accepts a
   `modifiedTime > '{timestamp}'` query expression. A single scalar
   watermark enables incremental pulls without fetching the full corpus.

2. **Client-side change verification** — the server-side filter is not
   perfectly precise. The Drive API may return files whose `modifiedTime`
   equals the watermark due to RFC 3339 sub-second precision differences,
   index propagation delays, or page-boundary overlap. Without a per-file
   record the plugin would re-raise an action for the same file version on
   consecutive runs. The `files` map closes this gap: a file is only
   processed when its new `modifiedTime` strictly exceeds the stored value.

No existing canonical strategy covers both requirements simultaneously.
The hybrid shape is the minimal extension.

### Does this source need a tracked-parent registry?

For Google Drive: a file's `modifiedTime` advances on body edits, but
**comments do not bump `modifiedTime`** — a new comment on an unedited
file is not re-surfaced by `search_files(modifiedTime > watermark)`.

This creates a comment-mention gap, but a registry is not warranted
because:

1. `read_file_content(includeComments=true)` inlines all comments when
   a body edit triggers a re-fetch.
2. `actions/_index.md` dedup prevents re-raising a mention action for
   the same fileId until the first action is closed.
3. A registry would require polling every previously-seen file for new
   comments on every run — O(total files ingested) calls, untenable for
   large Drives.

**Conclusion: no tracked-parent registry.** The `files` map key space
contains only bare `<fileId>` entries. There are no `<fileId>#<commentId>`
entries. This must be preserved across plugin versions.

The accepted limitation: a new comment on an already-ingested, unedited
file is not detected until the file is modified again. A webhook-capable
connector is required for real-time comment notifications.

---

## Cursor shape

```yaml
# data/learnings/agntux-google-drive/sync.md — bootstrap state
cursor: null
last_success: null
```

```yaml
# After the first successful run
cursor: '{"watermark":"2026-06-19T10:00:00Z","files":{"1abc...":"2026-06-19T09:50:00Z","2def...":"2026-06-18T14:00:00Z"}}'
```

The cursor is a **JSON object serialised as a single-line string** on
the `sync.md → cursor` frontmatter key.

### Top-level keys

| Key | Type | Meaning |
|---|---|---|
| `watermark` | ISO-8601 UTC string | Newest `modifiedTime` across all files successfully processed this run. Fed as the `modifiedTime > '{watermark}'` expression to `search_files` on the next incremental run. |
| `files` | JSON object | Per-fileId map. Each key is a Drive `id` (opaque string exactly as returned by the API). Each value is the ISO-8601 UTC `modifiedTime` last successfully processed for that file. |

### `files` map key

The key is the **Drive `id` field exactly as returned by `search_files`,
`list_recent_files`, or `get_file_metadata`**. Drive file ids are opaque
strings (e.g., `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms`). Do not
normalise, truncate, or alias them. The id is stable for the lifetime of
the file and does not change when the file is renamed or moved.

### `files` map value

Each value is an ISO-8601 UTC string at second precision:
`"YYYY-MM-DDTHH:MM:SSZ"`. It is the `modifiedTime` of the file at the
time it was last successfully processed (action written or item
intentionally suppressed) — NOT the run timestamp. Using the file's own
`modifiedTime` ensures exact change detection: a file is reprocessed only
when its new `modifiedTime` strictly exceeds the stored value. If the
stored value were the run timestamp, files processed near a run boundary
could be re-surfaced on every subsequent incremental run.

### Bootstrap state

`cursor: null` and `last_success: null` together signal "first run ever".
Parse the cursor at Step 2; if either the JSON parse fails or `cursor` is
null, treat both `watermark` and `files` as absent and enter bootstrap
mode. See "Bootstrap run" below.

---

## Step 2 — Parse and validate cursor

At Step 2 (before any tool calls):

1. Read `cursor` from `data/learnings/agntux-google-drive/sync.md`
   frontmatter.
2. If `cursor` is null: enter bootstrap mode. `watermark = null`;
   `files = {}`.
3. If `cursor` is a non-null string: attempt `JSON.parse`.
   - On parse failure: log `google-drive-cursor-malformed` (kind:
     `parse`) with the raw cursor string (truncated to 200 chars) and
     treat both `watermark` and `files` as absent. Fall back to bootstrap
     mode. Continue the run — do not exit.
   - On parse success but missing `watermark` key: treat `watermark` as
     null; use `list_recent_files` for discovery. Use `files` from the
     parsed object if present; otherwise `{}`.
   - On parse success but missing `files` key: use `watermark` for
     `search_files` normally. Treat `files` as `{}`.
   - On parse success with both keys present: normal incremental run.

Never exit the run solely because the cursor is malformed. Cursor
malformation falls back to bootstrap mode gracefully — a complete
re-scan within the bootstrap window is always safe for a read-only
plugin.

---

## Bootstrap run (cursor null or watermark absent)

Trigger: `cursor` is null OR `last_success` is null OR parsed `watermark`
is absent.

**Discovery:**

```
list_recent_files({
  orderBy: "recency",
  pageSize: 50,
  excludeContentSnippets: false
})
```

Page using `pageToken` until all files within the bootstrap window are
collected or the 100-file cap is reached (whichever comes first). Apply a
client-side filter: keep only files whose `modifiedTime` falls within
`(now − bootstrap_window_days days, now]`. Default `bootstrap_window_days`
is **30** (declared in `frontmatter.yaml`; user-overridable via
`user.md → bootstrap_window_days`).

**Onboarding-mode provision:** detect "first run ever" as
`last_success is null AND cursor is null`. On a first run ever, cap at
**30 files** and apply a tighter `bootstrap_window_days` of **14**
regardless of the frontmatter default. The first run executes
synchronously during Personalization State A wrap-up; the tighter scope
keeps it under 1 minute. The second (background) scheduled run uses the
full 100-file cap and 30-day window.

Do NOT apply the onboarding-mode cap when the cursor is malformed — that
is a recovery scenario, not first-time setup.

**Per-file change test on bootstrap:** `files` is empty (`{}`), so every
file returned within the window is processed. After processing, add each
file's id and `modifiedTime` to `files`.

**pageToken pagination within a bootstrap run:** the pageToken is valid
only for the current run — do NOT persist it to `sync.md`. If the run
ends before all pages are consumed (due to the file cap), the next run
starts a fresh `list_recent_files`; files already in `files` are skipped
by the per-file change test.

---

## Incremental run (watermark present and parseable)

Trigger: `cursor` is non-null, parses successfully, and `watermark` is
a valid ISO-8601 UTC string.

**Discovery:**

```
search_files({
  query: "modifiedTime > '{watermark}'",
  pageSize: 50
})
```

where `{watermark}` is the stored value verbatim. Page until all results
are returned or the 100-file cap is reached. The pageToken is valid only
for the current run — do NOT persist it to `sync.md`. On cap, stop, log
a `source` error with `message: "file discovery cap reached; remainder
deferred to next run"`, and proceed to Step 5b with files discovered
so far.

**Per-file change test (both incremental and bootstrap):**

For each file in the result set, look up `file.id` in `cursor.files`:

| Condition | Action |
|---|---|
| id absent from `files` | Process as **new file** |
| id present AND new `modifiedTime` strictly greater than stored value | Process as **changed file** |
| id present AND new `modifiedTime` equal to or less than stored value | **Skip** — server-side index artifact or page-boundary overlap |

A file that passes the server-side filter but fails the per-file
strict-greater-than test has not genuinely changed and MUST NOT generate
a new action item.

---

## Watermark advance rule

At Step 11, after all action writes have completed:

```
new_watermark = max(modifiedTime)
  across ALL files successfully processed OR intentionally suppressed this run
```

"Intentionally suppressed" means fetched, evaluated, and determined
non-action-worthy — suppressed files still advance the watermark. Files
whose `read_file_content` or action write failed do NOT contribute to
`new_watermark`.

**Why max-across-run, not start-of-run or end-of-run:** the `search_files`
filter uses the watermark as a strict lower bound. Using start-of-run
could miss files modified between the previous watermark and the run's
start but returned late by the Drive API. Using end-of-run could
permanently skip files modified between the first and last page fetches
but not returned (they'd fall below the new watermark). Max-of-processed
avoids both gaps.

---

## `files` map maintenance (Step 11)

After the watermark is computed (but before writing `sync.md`):

1. **Add** new fileIds (absent from the pre-run map) with their current
   `modifiedTime`.
2. **Update** existing entries when the file's `modifiedTime` strictly
   advanced.
3. **Retain** entries for files NOT returned this run — absence means
   unmodified, not deleted.
4. **Retain without update** entries for files returned but skipped by
   the per-file change test.
5. **Evict** a fileId when `read_file_content` or `get_file_metadata`
   returns a permanent not-found or access-revoked error (HTTP 404 /
   403 with no retry path). Log `google-drive-cursor-evicted` (kind:
   `source`) with the fileId and last-known `modifiedTime`.

The `files` map has no time-based eviction window. Entries are retained
indefinitely because the per-file dedup function requires the last-seen
`modifiedTime` across all previously ingested files. The 30-day
parent-registry eviction from the source-semantics advisor does NOT apply
here — the `files` map is a change-detection index, not a parent-reply
tracker.

---

## Transactional cursor advance (Step 11 gate)

Advance the cursor map **only when every action write this run
succeeded**. If any write failed:

- Leave `cursor` at its pre-run value (both `watermark` and `files`).
- Record the failure in `sync.md → errors` (FIFO-bounded to last 10
  entries).
- The next scheduled run re-processes from the pre-failure watermark.

The gate applies to the entire cursor object — no per-file partial
advance. If file A succeeded and file B failed, both are retried next run.

**Exception — content-unavailable skip:** a file skipped because
`read_file_content` returned empty or access-denied
(`google-drive-content-unavailable`) is a soft skip, not a write failure.
Its `files` entry is NOT updated (retried next run), but other files'
successful writes are not blocked. The cursor still advances if all
non-skipped files wrote successfully.

**Exception — metadata-missing:** a file that wrote an entity and action
item but had `get_file_metadata` fail (`google-drive-metadata-missing`)
is treated as successfully processed. The cursor advances normally.

---

## Cursor diff log line (Step 11)

```
cursor advance — watermark: {old} → {new}, added: {N} file(s), advanced: {M} file(s), evicted: {K} file(s)
```

Use `0` for any count with no changes. On a zero-change run:

```
cursor advance — (no change; search_files returned 0 files above watermark)
```

The `validate-cursor.mjs` hook checks that the cursor is parseable JSON
and that `watermark` does not regress (new value must be `>=` old; equal
is permitted on zero-change runs). Per-file `files` map values may not
individually regress either.

---

## Graceful handling of missing or malformed cursor

| Condition | Detected at | Action |
|---|---|---|
| `cursor: null` | Step 2 | Bootstrap mode; no error logged |
| `cursor` present but not valid JSON | Step 2 | Log `google-drive-cursor-malformed` (kind: `parse`); fall back to bootstrap mode; continue run |
| `cursor` valid JSON but `watermark` key absent | Step 2 | Log `google-drive-cursor-malformed` (kind: `parse`); use `list_recent_files`; use `files` from parsed object if present |
| `cursor` valid JSON but `files` key absent | Step 2 | Use `watermark` normally; treat `files` as `{}`; log no error |
| `cursor.watermark` not a valid ISO-8601 string | Step 2 | Log `google-drive-cursor-malformed` (kind: `parse`); fall back to bootstrap mode |
| `cursor.files` not a valid JSON object | Step 2 | Log `google-drive-cursor-malformed` (kind: `parse`); treat `files` as `{}` |

Never abort solely because the cursor is malformed. Write the corrected
cursor at Step 11 only if the run completes successfully.

---

## Workspace identifier capture

Google Drive's deep link is the `webViewLink` field returned on each
file object by `search_files`, `list_recent_files`, and
`get_file_metadata` — a fully-formed URL (e.g.,
`https://docs.google.com/document/d/<fileId>/edit`). No separate
workspace subdomain capture step is required.

Persist `webViewLink` on the entity body as `viewUrl` during Step 5b.
Do NOT use `webViewLink` as a cursor key — fileId is the canonical stable
identifier. There is no per-tenant workspace scope token to persist in
`sync.md` frontmatter.

---

## `_sources.json` lookup-before-write protocol

The lookup-before-write protocol from Step 6 fully applies.

- **Document/file entities** — `(subtype: {derived-subtype}, source:
  google-drive, source_id: "{fileId}")`. Use the derived subtype from
  the mimeType mapping table in `fetch.md` (document, spreadsheet,
  presentation, pdf, folder, other).
- **Person entities** from `lastModifyingUser` or file owner — look up
  by `(subtype: person, source: google-drive, source_id:
  "{emailAddress}")`. Email is the canonical cross-source alias; if the
  person exists from another source (e.g., Gmail, Slack), merge into the
  existing entity.
- Do NOT write to `_sources.json` directly — the PostToolUse hook owns
  it.

---

## No auto-learned denylist

Files surfaced by `search_files(modifiedTime > watermark)` are strictly
limited to files the authenticated user has access to and that have been
genuinely modified. The noise floor is low enough that explicit
`# Never raise` curation in `data/instructions/agntux-google-drive.md`
is sufficient. The auto-learned denylist pattern is not applied.

---

## sync.md template

Bootstrap state:

```yaml
---
plugin: agntux-google-drive
version: 0.1.0
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

After the first successful run (onboarding mode, 14-day window, 12 files
processed):

```yaml
---
plugin: agntux-google-drive
version: 0.1.0
cursor: '{"watermark":"2026-06-19T10:00:00Z","files":{"1BxiMVs0XRA5nFM":"2026-06-19T09:50:00Z","1K2gHhJtFqrs7nA":"2026-06-18T14:00:00Z","0APmkLXb5uuXQUk9PVA":"2026-06-17T11:30:00Z"}}'
last_run: "2026-06-19T10:03:42Z"
last_success: "2026-06-19T10:03:42Z"
items_processed: 12
lock: null
errors: (none)
---
```
