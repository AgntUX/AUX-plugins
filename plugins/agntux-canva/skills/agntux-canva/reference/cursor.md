# Cursor advance reference — agntux-canva (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/cursor.md`.

Canva uses the **per-design JSON map** strategy: one cursor entry per
design, keyed by `design_id`, storing the design's `updated_at` ISO-8601
timestamp at the time of last successful processing.

---

## Strategy name

**Per-item JSON map (design-level modified timestamp)**

This strategy applies whenever:

- Items (designs) each have an `updated_at` field but no server-side
  `since` filter on the enumeration call.
- Items are independent of one another — a new comment on design A does
  not change design B's cursor entry.
- The item set may grow over time; new items must be detected without
  lowering a global cursor.

Canva satisfies all three conditions. The per-design map lets the run
skip designs that have not changed and focus fetch work on designs with
new comments or edits.

---

## Cursor shape

```yaml
# data/learnings/agntux-canva/sync.md — example after a successful run
cursor: '{"DEF456xyz":"2026-06-25T14:32:00Z","ABC123abc":"2026-06-24T09:15:00Z"}'
```

The cursor is a **JSON string** (not a nested YAML object — kept as a
scalar string so `validate-cursor.mjs` can diff entries without YAML
multi-line quoting ambiguity). Each key is a Canva `design_id`; each
value is an ISO-8601 UTC timestamp (second-precision, `Z` suffix).

Bootstrap state:

```yaml
cursor: null
last_run: null
last_success: null
```

`absent_designs` tracking block (also in sync.md frontmatter):

```yaml
absent_designs: '{}'
```

This companion map counts consecutive runs where a design_id was absent
from `search-designs` results. It is reset to 0 when the design
reappears and the key is removed when the entry is evicted after 3 misses.

---

## Advance rule

### Incremental run (cursor non-null)

1. Parse `cursor` as JSON. If parsing fails (malformed string), treat as
   bootstrap (null) and log `parse` error with kind `canva-cursor-evicted`
   to indicate the map was reset.
2. For each design returned by `search-designs`, evaluate:
   - `cursor[design_id]` is absent → in-scope (new design).
   - `design.updated_at > cursor[design_id]` → in-scope (changed design).
   - `design.updated_at <= cursor[design_id]` → skip (unchanged).
3. Since `search-designs` returns `sort: modified_descending`, the first
   page contains the most-recently-modified designs. Stop paginating when
   the page's earliest `updated_at` predates the oldest cursor entry by
   more than `bootstrap_window_days` — all remaining pages are unchanged.
4. After all action writes for the run succeed (Step 11 transactional
   rule), advance each processed design's cursor entry to its current
   `updated_at`. Leave skipped-due-to-inaccessibility entries unchanged.
5. Write the updated cursor JSON string back to `sync.md → cursor`.

**Why per-design and not a global low-water-mark:** A global watermark
would require re-fetching all designs modified after the watermark, which
would re-process shared designs that received comments from other users.
The per-design map scopes work precisely to designs the agent actually
processed, avoiding both over-fetching and under-fetching.

**Why advance only on success:** the transactional rule (Step 11) gates
cursor advancement on every action write succeeding. A partial-failure run
that advances cursor entries would permanently skip the failed designs on
the next run. If any action write failed, leave ALL cursor entries at
their pre-run values; the next run retries from the same set of
in-scope designs.

### Bootstrap run (cursor null OR absent_designs null)

Filter for designs where `design.updated_at` falls within
`(now − bootstrap_window_days days, now]`. Default `bootstrap_window_days`
for Canva is 14 (declared in `frontmatter.yaml`). Apply the 50-design-per-run
cap and ascending-sort-on-cap rule from `fetch.md`.

After all action writes succeed, write the cursor map with one entry per
processed design set to its `updated_at`. Initialise `absent_designs` to
`'{}'`.

### Cursor diff expression (Step 11)

The diff log line uses one entry per changed key:

```
cursor advance — updated: cursor["DEF456xyz"] 2026-06-24T10:00:00Z → 2026-06-25T14:32:00Z
cursor advance — added: cursor["NEW789abc"] (absent → 2026-06-26T08:00:00Z)
cursor advance — evicted: cursor["OLD111zzz"] (last value: 2026-06-01T00:00:00Z)
```

The `validate-cursor.mjs` hook accepts the JSON-map form and will reject
any write that regresses an existing entry's timestamp value.

---

## Eviction

A cursor entry is evicted when the corresponding design has been absent
from `search-designs` enumeration results for 3 or more consecutive runs,
**provided** the design's stored `updated_at` is recent enough that it
should have appeared within the paginated window (see the early-stop
exception below).

Eviction procedure:
1. After each run, for every cursor key that was NOT seen in this run's
   `search-designs` results AND whose stored `cursor[design_id]` value is
   more recent than `(now − bootstrap_window_days days)`:
   increment `absent_designs[design_id]` by 1.
   **Do NOT increment** the miss counter for entries whose stored
   `updated_at` is older than `(now − bootstrap_window_days)`. Those
   designs fall beyond the early-stop pagination horizon and are expected
   to be absent from results — their absence is not a miss.
2. When `absent_designs[design_id] >= 3`:
   a. Log `canva-cursor-evicted` (kind: `source`) to `sync.md → errors`
      with the design_id and its last-known `updated_at` cursor value.
   b. Delete the key from the cursor map.
   c. Delete the key from `absent_designs`.
3. Reset `absent_designs[design_id]` to 0 (or remove the key) when the
   design reappears in `search-designs` results.

**Why the early-stop exception is required.** Step 5a stops paginating
when the current page's earliest `updated_at` predates the oldest cursor
entry by more than `bootstrap_window_days`. This means cursor entries for
old, unchanged designs are intentionally never seen during enumeration —
not because the designs are gone, but because the early-stop correctly
skips pages full of unchanged designs. Without the exception, every run
that triggers early-stop would increment the miss counter for those old
entries, evicting them after 3 hours (on an hourly cadence). After
eviction the entries re-appear as "new" on the next full-window discovery
sweep, causing a perpetual evict-and-rediscover cycle for designs that
simply haven't been touched recently.

Do NOT close open action items referencing an evicted design
automatically — a temporary sharing-permission removal or API lag may
cause transient absence. The user remains in control.

---

## No tracked-parent registry (comment threading handled in fetch.md)

Canva comments have a parent-child relationship (top-level comment →
replies), but the cursor tracks designs, not individual comments. When a
design's `updated_at` bumps because of a new reply on an existing comment,
the design-level cursor entry detects the change and the full thread is
re-fetched. There is no separate tracked-parent registry for comment IDs
— the design `updated_at` serves as the freshness signal for all content
within the design.

### source_ref granularity on action items

Even though freshness is tracked at the design level, **action-item dedup
must operate at the comment-thread level.** The `source_ref` on every
action item raised from a comment (Step 8) must be the comment's own
identifier — `<design_id>/<comment_id>` — not the design's `view_url`
alone.

Reason: if two separate top-level comments on the same design are both
unresolved, they are two distinct actionable threads. Using the design URL
as `source_ref` would cause the dedup check against `actions/_index.md`
to treat the second comment as already covered by the first. The design
`view_url` belongs on the `url` field of `suggested_actions` (deep link
for "Open in Canva"), but the `source_ref` field used for dedup must be
`"canva:<design_id>/<comment_id>"` — unique per comment thread.

Concretely (Step 8 action write):

```yaml
source_ref: "canva:<design_id>/<comment_id>"
suggested_actions:
  - label: "Open in Canva"
    url: "<design.urls.view_url>"
```

This ensures that on subsequent runs where the design's `updated_at`
bumps again (another reply lands), the dedup check correctly finds the
existing open action for that comment thread and does not raise a
duplicate, while a genuinely new top-level comment on the same design
gets its own action entry.

---

## Edge cases

### Clock skew and out-of-order updated_at

Canva's API returns `updated_at` as a server-side timestamp. Clock skew
between Canva's servers and the agent's clock is not a concern because
all comparisons are `design.updated_at (server) > cursor[id] (previously
stored server value)` — both values originate from the same server clock.

### Design deleted or sharing permission revoked

A design that disappears from `search-designs` may have been deleted, or
the user's sharing access may have been revoked. The 3-run eviction
window provides a grace period for transient access issues. After
eviction, the cursor entry is removed and the design will be treated as
new if it reappears.

### Design re-shared with unchanged updated_at

If a design is re-shared with the user but its `updated_at` has not
changed (owner touched it before sharing, not after), the cursor entry
from the previous eviction — if it was evicted — is absent, so the design
is treated as new and re-ingested. If the cursor entry still exists (not
yet evicted), the design will be skipped as unchanged. This is acceptable:
the knowledge store already has the entity from the prior ingest.

### Cursor map grows very large

For a user with thousands of Canva designs, the cursor map JSON string
may become large. Because `sync.md` is a small YAML frontmatter file, a
cursor string exceeding ~50 KB is unusual but possible for power users.
If the map exceeds 1000 entries, log `parse` (kind: `internal`) with a
note that the cursor map is large, but do NOT truncate or reset it — all
entries represent valid state. The per-run 50-design cap limits write
throughput regardless of map size.

---

## sync.md template (bootstrap state)

```yaml
---
plugin: agntux-canva
version: 0.1.0
cursor: null
absent_designs: '{}'
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

After the first successful incremental run:

```yaml
---
plugin: agntux-canva
version: 0.1.0
cursor: '{"DEF456xyz":"2026-06-25T14:32:00Z","ABC123abc":"2026-06-24T09:15:00Z"}'
absent_designs: '{}'
last_run: "2026-06-26T15:52:00Z"
last_success: "2026-06-26T15:52:00Z"
items_processed: 12
lock: null
errors: (none)
---
```

---

## Self-validation against fetch.md

| fetch.md claim | cursor.md alignment |
|---|---|
| Cursor is a per-design JSON map keyed by design_id | Confirmed — cursor shape section above |
| In-scope when absent from map OR updated_at > map entry | Confirmed — advance rule incremental section |
| Bootstrap: updated_at within bootstrap_window_days (default 14) | Confirmed — bootstrap run section |
| Advance only on full success (transactional rule) | Confirmed — advance rule §4 above |
| 50-design per-run cap with ascending sort on overflow | Confirmed — bootstrap run section references fetch.md cap |
| Stop paginating when page predates oldest cursor entry by > bootstrap_window_days | Confirmed — incremental advance rule §3 |
| canva-cursor-evicted after 3 consecutive misses | Confirmed — eviction section; miss counter gated on recent-enough updated_at to exclude early-stop horizon |
| canva-design-not-accessible: do not advance cursor entry | Confirmed — advance rule §4 |
| canva-rate-limited: exit immediately, no cursor advance | Confirmed — fetch.md failure table; transactional rule covers this |
| absent_designs companion map tracks miss counts | Confirmed — cursor shape and eviction sections; only incremented for designs within bootstrap_window_days horizon |
| Action-item source_ref is comment-thread-scoped, not design-scoped | Confirmed — "No tracked-parent registry" section, source_ref granularity subsection |
