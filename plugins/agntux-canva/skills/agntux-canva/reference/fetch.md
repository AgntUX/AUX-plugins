# Canva fetch — Step 5 orchestration

Wholesale override for `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
Canva uses a three-phase shape: enumerate designs (paged), pull per-design
detail and comments (threaded), and filter to changed designs using the
per-design cursor map.

All tool names below are prefixed with
`mcp__679539c6-bf39-4a83-8da6-34d02f9561ce__` — use the host-resolved
names exactly as they appear at runtime.

---

## Step 5 — Fetch from Canva

### Step 5a — Enumerate designs

Call `search-designs` with `sort: modified_descending` to retrieve all
designs the user owns or collaborates on. Paginate using the continuation
token returned in each response: pass it as the continuation argument on
the next call. Stop paginating when:

- no continuation token is returned, OR
- the earliest `updated_at` in the current page predates the oldest
  entry in the cursor map by more than `bootstrap_window_days` (on an
  incremental run this means all remaining designs are unchanged — stop
  early rather than fetching every page).

**Do not fabricate a continuation token.** If the response carries no
token, the enumeration is complete.

**Per-run design cap.** Process at most 50 designs per run. If the
filtered set (Step 5b filter) exceeds 50, sort ascending by `updated_at`
(oldest first) and process the first 50. The next run picks up the
remainder because those designs will still have `updated_at` newer than
their cursor entry.

**Designs in scope (incremental run, cursor non-null):**

A design is in-scope when either condition holds:
- `cursor[design_id]` does not exist (new design never seen before), OR
- `design.updated_at > cursor[design_id]` (design was modified since last run).

**Designs in scope (bootstrap run, cursor null):**

A design is in-scope when `design.updated_at` falls within
`(now − bootstrap_window_days days, now]`. Default `bootstrap_window_days`
for Canva is 14 (declared in `frontmatter.yaml`). Apply the 50-design cap
and ascending-sort-on-cap rule.

Both owned designs and designs the user collaborates on appear in
`search-designs` results — both must be included. Do not filter by owner.

```
search-designs({ sort: "modified_descending" })
# → { designs: [...], continuation: "<token>" }

search-designs({ sort: "modified_descending", continuation: "<token>" })
# → next page; repeat until no token or early-stop condition met
```

### Step 5b — Pull per-design detail

For each in-scope design from Step 5a, call `get-design` to retrieve:
`title`, `owner`, `urls` (view URL, edit URL), `thumbnail`, `updated_at`,
and `page_count`.

The design's `urls.view_url` is the `url` field on `suggested_actions` ("Open in Canva" deep link). It is NOT used as the `source_ref` for action-item dedup — see Step 5d and cursor.md § "source_ref granularity on action items".

```
get-design({ design_id: "<design_id>" })
# → { design: { id, title, owner, urls, thumbnail, updated_at, page_count } }
```

If `get-design` returns a 403 or 404 for a design that appeared in
`search-designs`, log `canva-design-not-accessible` (kind: `source`) with
the design_id, skip that design, and continue. Do NOT advance its cursor
entry.

### Step 5c — Fetch comments and replies

For each in-scope design, call `list-comments` to retrieve all top-level
comments and @mentions.

```
list-comments({ design_id: "<design_id>" })
# → { comments: [...], continuation: "<token>" }

list-comments({ design_id: "<design_id>", continuation: "<token>" })
# → next page; repeat until no token
```

For each comment that itself has replies (indicated by a non-zero
`reply_count` or equivalent field), call `list-replies` to retrieve the
full thread.

```
list-replies({ design_id: "<design_id>", comment_id: "<comment_id>" })
# → { replies: [...], continuation: "<token>" }
```

Paginate `list-replies` until no continuation token is returned.

**Per-design comment cap.** If a single design returns more than 200
combined comments + replies across all threads, log
`canva-comment-thread-truncated` (kind: `source`) with the design_id and
the count seen, stop fetching further pages for that design, and continue
with what was received. The design entity is still written; only the
comment fetch is truncated.

**Thread structure.** Each top-level comment is the parent entity
(`subtype: comment`). Its replies are children of the same comment
entity. For entity and action purposes, the unit of action-worthiness is
the top-level comment thread, not individual replies.

**@mention detection.** A comment or reply that mentions the user (by
name, email alias, or Canva @-handle matching `user.md → identity`) is a
`mentioned` signal — treat it as needs-a-reply alongside unresolved
comments.

**Enrichment tools (optional, non-spine).** `get-design-content`
(richtexts) and `get-export-formats` are available for enrichment during
entity write (Step 7) if additional context is needed, but MUST NOT be
called for every design on every run — they are expensive. Call them only
when a new design entity is being created for the first time (no existing
entity on disk) and then only if the `get-design` detail response lacks
sufficient context for a meaningful entity description.

### Step 5d — Map designs and comments to entities and actions

These rules apply to any Canva user — never hard-code specific design
names, folder structures, workspace layout, or volume assumptions.

**Design entity (`subtype: design`).** Each design maps to one entity.
The `source_id` for lookup-before-write (Step 6) is the design's `id`
field. The entity carries: `title`, `owner_name`, `view_url`, `updated_at`,
`page_count`, and `thumbnail_url`.

**Comment entity (`subtype: comment`).** Each top-level comment maps to
one entity, linked to its parent design entity via `related_to`. The
`source_id` is `<design_id>/<comment_id>`. Replies are stored as a
`replies` list within the comment entity body rather than separate entities.

**Action-worthiness signals.** Raise an action item (Step 8) when:
- A top-level comment is unresolved (no `resolved_at` field, or
  `status: open`) AND is not already covered by an open action on disk.
- Any comment or reply in the thread @mentions the user by name, email
  alias, or Canva handle.

**Action-item `source_ref`.** The `source_ref` on every action item is
`"canva:<design_id>/<comment_id>"` — scoped to the comment thread, not
the design. Dedup against `actions/_index.md` must match on this
comment-thread identifier. The design `urls.view_url` belongs on the
`url` field of `suggested_actions` only. See cursor.md § "source_ref
granularity on action items" for the full rationale.

Comments that are resolved (`resolved_at` is set or `status: resolved`)
do NOT raise a new action. If an existing open action's underlying
comment was resolved since last run, suppress the action (Step 8.5
reconcile).

**Designs with no unresolved comments** still produce a design entity
(Step 7) but do NOT produce an action item. The design is in the
knowledge store as context for future queries.

### Step 5 summary — on fetch failure

On any failure from `search-designs`, `get-design`, `list-comments`, or
`list-replies`:

- Log to `data/learnings/agntux-canva/sync.md → errors` with kind
  `network | auth | parse | source | internal` (or the canva-specific
  extension from the permitted-error-kinds list).
- Slice the errors list to the last 10 entries (newest-first) before
  writing.
- On `auth` or `network` failure: update `last_run`, release the lock,
  exit. Do not advance any cursor entry.
- On `canva-rate-limited` (HTTP 429): log the kind, update `last_run`,
  release the lock, exit immediately. Do not retry within the same run.
- On per-design `canva-design-not-accessible`: skip that design only;
  continue the run for remaining designs.
- Step 11's transactional rule keeps all cursor entries at their pre-run
  values if any action write in the run fails.

---

## Cursor shape for Canva

The cursor is a per-design JSON map stored on the `sync.md → cursor`
line:

```yaml
# data/learnings/agntux-canva/sync.md — example after a successful run
cursor: '{"DEF456xyz":"2026-06-25T14:32:00Z","ABC123abc":"2026-06-24T09:15:00Z"}'
```

Each key is a Canva `design_id`; each value is the design's `updated_at`
ISO-8601 timestamp at the time of last successful processing.

**Advance rule.** After all action writes for the run have succeeded
(Step 11 transactional rule), update each processed design's cursor entry
to its current `updated_at`. Do NOT advance entries for designs that were
skipped due to `canva-design-not-accessible`.

**Eviction.** A cursor entry is a candidate for eviction when the
corresponding design has been absent from `search-designs` results for 3
or more consecutive runs. Log `canva-cursor-evicted` (kind: `source`)
with the design_id and last-known title, then drop the key from the map.
Use the `sync.md → absent_designs` tracking block (a JSON map of
`design_id → consecutive_miss_count`) to count misses; reset to 0 when a
design reappears.

**Bootstrap state:**

```yaml
cursor: null
last_run: null
last_success: null
```

---

## Failure mode reference

| Symptom | kind | Action |
|---|---|---|
| `search-designs` auth error | `auth` | exit, retry next run |
| `search-designs` network error | `network` | exit, retry next run |
| HTTP 429 on any tool call | `canva-rate-limited` (kind: `source`) | log, exit immediately |
| `get-design` returns 403/404 | `canva-design-not-accessible` (kind: `source`) | skip design, continue |
| `list-comments` parse error | `parse` | log, skip design's comments, continue |
| Comment thread exceeds 200 items | `canva-comment-thread-truncated` (kind: `source`) | log, use partial data, continue |
| Any unexpected internal error | `internal` | log, exit |
