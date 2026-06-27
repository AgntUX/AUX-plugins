# Step 5 — Fetch from Notion

Wholesale replacement of `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
All Notion-specific fetch detail lives here. Nothing here changes the step
numbering, the transactional cursor rule, or the 10-actions-per-run cap.

Do NOT hard-code workspace IDs, page IDs, database IDs, or teamspace names.
Every value below is resolved at runtime from connector responses or from
`data/learnings/agntux-notion/sync.md`. Per-user signal weighting and scoping
preferences live in `data/instructions/agntux-notion.md` and `user.md`.

---

## 5a. Resolve self identity

Before any search, call `notion-get-users` once per run to resolve the current
user's Notion identity:

```
notion-get-users(user_id: "self")
```

Extract:
- `id` → the authenticated user's Notion user UUID. Store as `self_user_id` in
  working memory for this run.
- `name` and `email` → cross-reference with `user.md` to confirm identity; log
  a mismatch as `kind: usermd-malformed` if the email does not align.

**Persist the user id.** Write `self_user_id` to
`data/learnings/agntux-notion/sync.md` frontmatter on first successful
resolution. Subsequent runs read from the sync file and skip the
`notion-get-users` call when already non-null and `last_success` is less than
7 days old.

If `notion-get-users` fails or returns no user id, log `kind: auth` to the
sync-state error log, release the lock, and exit. All subsequent calls rely on
`self_user_id` for mention and assignment filtering.

---

## 5b. Determine the query window

Read `cursor` from `data/learnings/agntux-notion/sync.md` frontmatter:

- **Bootstrap mode** (`cursor` absent or null): compute
  `filter_ts = today − bootstrap_window_days` (default 30 days; read from
  `user.md` frontmatter `bootstrap_window_days` if present).
- **Incremental mode** (`cursor` present): apply a 60-second safety margin —
  `filter_ts = cursor − 60s`. This absorbs any indexing lag on Notion's side
  and ensures items edited at the exact cursor boundary are not silently skipped.

Log the mode (bootstrap or incremental) and `filter_ts` (ISO 8601) to the
sync-state debug log before any search call.

---

## 5c. Search recently edited pages and docs

Call `notion-search` to discover pages and docs edited since `filter_ts`:

```
notion-search(
  query_type: "internal",
  created_date_range: { after: "{filter_ts}" }   # or last_edited equivalent if supported
)
```

Use the most recent date filter parameter the connector exposes for
`last_edited_time`. If the connector exposes both `created_date_range` and a
`last_edited_time` filter, prefer `last_edited_time` — it catches edits to
existing pages, not only newly created ones.

**Volume cap: 100 results per run** across all page types. If the connector
returns more, sort by `last_edited_time` descending and take the 100 most
recently edited. Log `notion-search-overflow` (kind: `source`) if truncated.

For each result record:

- Extract: `id`, `title`, `url`, `last_edited_time`, `created_time`,
  `last_edited_by.id`, `created_by.id`, `parent.type`, `parent.id`.
- Determine object type from the result: `page` or `database_item`.
- Store the flat record in the run's working buffer. Discard full page bodies
  at this stage — bodies are fetched selectively in step 5f.

---

## 5d. Query database items assigned to the user

Call `notion-query-database-view` (or `notion-query-data-sources` if the former
requires an explicit database id not yet known) to surface tasks and project items
assigned to the current user:

```
notion-query-database-view(
  filter: {
    assignee: "{self_user_id}",
    last_edited_time: { after: "{filter_ts}" }
  }
)
```

If `notion-query-data-sources` is needed first to enumerate databases, call it
once (result cached in working memory for the run) and iterate over the returned
database list, querying each with `notion-query-database-view`.

For each database item:
- Extract: `id`, `title`, `url`, `last_edited_time`, `created_time`,
  `properties` (due date, status, assignees, priority, any custom fields present).
- Record `parent.database_id` for entity filing under `notion-database-item`.

**Volume cap: 50 database items per run.** If more are available, prioritise
by most recently edited. Log `notion-search-overflow` (kind: `source`) if
capped.

---

## 5e. Query meeting notes (recent)

Call `notion-query-meeting-notes` to surface meeting notes created or edited
within the query window:

```
notion-query-meeting-notes(
  date_range: { after: "{filter_ts}" }
)
```

Extract `id`, `title`, `url`, `last_edited_time`. Include these records in the
working buffer alongside pages from step 5c. Meeting notes are treated as
`notion-page` subtype unless the connector exposes a dedicated subtype.

**Volume cap: 20 meeting-note records per run.**

**Empty-stub filter (meeting notes).** After deep-fetching a meeting-note page
body in step 5f, evaluate whether it contains substantive content. A page is
considered an empty stub when its entire body consists only of auto-generated
placeholder text — patterns such as "No notes captured", "No Gemini notes
found", "Add notes manually if needed", or equivalent boilerplate that carries
no user-authored sentences, action items, or decisions. The test is content
shape, not page title: if every non-empty line in the fetched body matches
a common "no content recorded" placeholder pattern and there is no paragraph
of free-form text, no list item authored by a participant, and no decision or
follow-up recorded, treat the page as an empty stub. Do NOT create a
`notion-page` entity for empty stubs, and do NOT surface them as action items.
If a page transitions from stub to substantive content on a later run it will
be picked up naturally through the incremental cursor window.

---

## 5f. Deep-fetch page bodies (selective)

After steps 5c–5e build the working buffer, construct a **shortlist of pages
that need their full body** for downstream classification:

- Pages where `last_edited_by.id` is NOT `self_user_id` and the edit is within
  the last 48 hours (someone else made a recent edit).
- Database items where the current user is an assignee.
- Pages where `title` or a property value contains the current user's name or
  email (potential mentions).
- Any page flagged as high-priority by `data/instructions/agntux-notion.md`
  (e.g. pages in a watched teamspace or database).

For each shortlisted page, call `notion-fetch`:

```
notion-fetch(id: "{page_id}")
```

or

```
notion-fetch(url: "{page_url}")
```

Extract the page body, properties, and any inline mentions of `self_user_id`.
Cap the shortlist at **30 pages per run**. Pages not deep-fetched are still
recorded as entities in Step 7 with an empty `## Content` placeholder; they are
evaluated for full body content on subsequent runs when they fall within the
incremental window.

---

## 5g. Fetch comment threads (selective)

For each page in the deep-fetch shortlist (step 5f) and any page known from the
previous run to have open comment threads, call `notion-get-comments`:

```
notion-get-comments(page_id: "{page_id}")
```

**Comment → response-needed gating.** A comment thread is raised as a
`response-needed` action item only when BOTH of the following conditions hold:

- **(a) Relevance to the current user:** the thread @-mentions `self_user_id`
  directly (an inline mention in any comment in the thread), OR the parent page
  was created by `self_user_id` (`created_by.id == self_user_id`). Either
  condition satisfies (a). A comment on a page the user merely edited or viewed
  does NOT satisfy (a).
- **(b) Recency:** the most recent comment in the thread (`last_edited_time` or
  the timestamp of the latest reply) falls within the last **14 days** from the
  current run date. This default recency window can be overridden by setting
  `comment_recency_days` in `data/instructions/agntux-notion.md`. Comments older
  than the window are not surfaced as response-needed regardless of condition (a).

When both (a) and (b) hold and the comment has not been seen before (not in
`seen_comment_ids`), surface the thread as `response-needed` and include
`page_id` and `discussion_id` in the action-item frontmatter (see Step 10).

When condition (a) holds but (b) does not (the thread is old), record the
comment as lower-signal context on the parent page entity under `## Comments`
— do NOT raise a response-needed action item.

When condition (a) does not hold (the user is not mentioned and did not author
the page), skip the thread entirely unless the page is in a watched scope from
`data/instructions/agntux-notion.md`, in which case record it as context only.

**Deduplication.** Comments do not have their own `last_edited_time` cursor.
Track seen comment ids in `data/learnings/agntux-notion/sync.md` frontmatter
under `seen_comment_ids` (bounded FIFO list, max 500 entries). Skip any comment
id already in the list; add newly processed comment ids before releasing the lock.

Cap: **call `notion-get-comments` for at most 30 pages per run.**

---

## 5h. Resolve contributor identities (selective)

For any `last_edited_by.id` or comment `author.id` that does not already resolve
to a known `person` entity in the knowledge store, call `notion-get-users`:

```
notion-get-users(user_id: "{notion_user_id}")
```

Cache resolved (id → name + email) pairs in working memory for the run. Do not
call `notion-get-users` more than once per user id per run.

---

## Thread and parent-child semantics

Notion **pages** are the top-level thread unit (`notion-page`). Their
**comment threads** are children — ordered under the page. Database items
(`notion-database-item`) are independent entities, not children of pages.

When a comment is the primary signal, the parent page is still the entity
written to `entities/notion-page/` in Step 7; the comment is stored as a
`## Comments` section within that entity file. Do not create a separate entity
for each comment — use `notion-comment` subtype only when the comment itself
(independent of its page context) is the unit being surfaced as an action item
(e.g. a thread where the user is @-mentioned and must reply).

Meeting notes are filed as `notion-page` subtype. Database items (tasks,
projects, custom trackers) are filed as `notion-database-item`.

---

## Source ID format

Construct `source_id` for each object as:

```
notion:{notion_uuid}
```

where `{notion_uuid}` is Notion's 32-character hex UUID in dashed format
(e.g. `1a2b3c4d-5e6f-7890-abcd-ef1234567890`), as returned by the connector in
the `id` field. Use the page id for pages and database items, and the comment id
for comment-subtype action items.

Examples:
- Page: `notion:1a2b3c4d-5e6f-7890-abcd-ef1234567890`
- Database item: `notion:9f8e7d6c-5b4a-3210-fedc-ba9876543210`
- Comment thread: `notion:comment:a1b2c3d4-e5f6-7890-1234-567890abcdef`

The dashed UUID is stable across renames and parent moves. Do not construct
source ids from titles or URLs — those change when a page is renamed or moved.

---

## Step 10 — Action-item frontmatter keys (Notion-specific)

In addition to the canonical action-item frontmatter fields (source_id, subtype,
suggested_actions, etc.), write the following source-specific keys so the
view-tool handlers can target the correct Notion API calls without re-fetching
context from source.

### Comment-reply action items

Every action item whose primary signal is a comment thread awaiting a reply MUST
include both of the following frontmatter keys:

```yaml
page_id: "{notion_page_uuid_dashed}"        # the Notion page UUID containing the comment thread
discussion_id: "{notion_discussion_uuid_dashed}"  # the comment-thread / discussion UUID
```

`page_id` is the dashed-form UUID of the parent page (the same id used in
`source_id` construction for `notion-page` entities).
`discussion_id` is the dashed-form UUID of the comment thread returned by
`notion-get-comments` in step 5g (the `id` field on the comment/discussion
object).

The view tool passes `page_id` and `discussion_id` directly to
`notion-create-comment` when the user invokes the reply composer. Without both
keys the handler cannot target the correct thread.

### Update-page action items

Every action item whose primary signal is a database item or page requiring a
property update MUST include:

```yaml
page_id: "{notion_page_uuid_dashed}"        # the Notion page or database-item UUID
```

The view tool passes `page_id` directly to `notion-update-page`. Without this
key the handler cannot identify which page to update.

Do NOT pre-fill any proposed property values in the action-item frontmatter —
the view tool reads current page properties at click time to avoid stale
pre-fills.

---

## Suggested actions

Notion page and database-item URLs are returned directly by the connector in the
`url` field. Use those directly for "Open in Notion" deep links.

### Pages with a comment awaiting reply

```yaml
suggested_actions:
  - label: "Reply to comment"
    host_prompt: "Use the agntux-notion plugin to open the comment reply composer for action {id}"
  - label: "Open in Notion"
    url: "{page_url}"
```

### Database items (tasks / projects)

```yaml
suggested_actions:
  - label: "Update page"
    host_prompt: "Use the agntux-notion plugin to update page properties for action {id}"
  - label: "Open in Notion"
    url: "{page_url}"
```

### Pages with new content (knowledge update)

```yaml
suggested_actions:
  - label: "Open in Notion"
    url: "{page_url}"
```

### Decisions or tasks surfaced from doc / comment content (no existing tracking item)

When ingest detects a decision or task mentioned in a page or comment that has
no corresponding database item or tracking page yet, surface a "Create page"
action so the user can capture it without leaving the flow:

```yaml
suggested_actions:
  - label: "Create page"
    host_prompt: "Use the agntux-notion plugin to create a tracking page for action {id}"
  - label: "Open in Notion"
    url: "{page_url}"
```

The host dispatches the `host_prompt` to `agntux_notion_create_view`, passing
only the `action_id`. The view tool reads the action item from disk at click
time to compose the new page — do NOT pass page title, body, or any payload
fields inline in the `host_prompt`.

---

## Step 5 — On fetch failure

On any failure from any Notion tool call:

- Log to `data/learnings/agntux-notion/sync.md → errors` with the appropriate
  kind from the permitted-error-kinds list. Slice the errors list to the last 10
  entries (newest-first) before writing.
- **Auth failure (401 / token expired):** release the lock and exit. Do NOT
  proceed — all subsequent calls will fail identically. Log `kind: auth`.
- **Rate limit (429 / `notion-rate-limited`):** log `kind: source` +
  `notion-rate-limited`, stop fetching, release lock, exit. Cursor does not
  advance (transactional rule). Notion's rate limit is 3 requests/second per
  integration; if a 429 occurs mid-run, wait is not attempted — exit cleanly
  and retry on the next scheduled run.
- **Network failure:** log `kind: network`, release lock, exit.
- **Page not found (404) on `notion-fetch`:** log `kind: notion-page-not-found`
  with the page id; skip that page; continue processing remaining pages.
- **`notion-get-comments` failure for a specific page:** log
  `kind: notion-comment-fetch-failed` with the page id; skip comments for that
  page; continue.
- **Search returns zero results (unexpected for an active workspace):** log
  `kind: notion-search-empty` with the query window used; proceed to steps 5d–5e
  in case database queries surface items.
- **Cursor malformed in sync state:** log `kind: notion-cursor-evicted`; reset
  `cursor` to null (triggers bootstrap on this run); continue.

---

## Failure modes summary

| Symptom | kind | Action |
|---|---|---|
| Auth error (401, expired OAuth token) from any tool | `auth` | release lock, exit, retry next run |
| Network-level failure | `network` | release lock, exit, retry next run |
| Rate limit (429) from any tool | `source` + `notion-rate-limited` | stop fetching, release lock, exit |
| `notion-get-users` returns no user id | `auth` | release lock, exit |
| `notion-fetch` returns 404 for a page id | `notion-page-not-found` | skip page, continue |
| `notion-get-comments` fails for a page | `notion-comment-fetch-failed` | skip page comments, continue |
| `notion-search` returns zero results | `notion-search-empty` | log, continue to database queries |
| Cursor entry in sync state is malformed | `notion-cursor-evicted` | reset cursor to null (bootstrap), log, continue |
| Search result has malformed JSON / missing fields | `parse` | log, skip item, continue |
