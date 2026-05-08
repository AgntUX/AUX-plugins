# Gmail cursor advance reference

Companion to `../SKILL.md` Step 11. The transactional rule, diff
expression, and `validate-cursor.mjs` interaction live in the SKILL
body. This file documents Gmail's two-layer cursor structure.

## Cursor advance layers

| Layer | Key shape in `cursor` map | What advances | When advanced |
|---|---|---|---|
| Inbox discovery low-water-mark | `inbox` (literal string) | Newest message internalDate seen by Step 5b discovery stages | After Step 5b completes AND every action write succeeded |
| Thread cursor | `<thread_id>` | Newest message internalDate processed in that thread | After per-thread pass completes AND every action write succeeded |

Plus a sibling field `discovery_ts` on `sync.md` that mirrors the
`inbox` low-water-mark for fast-read access by Step 5b's `after:`
filter.

## Eviction

- **Thread-shaped entries** with no activity for ≥30 days are evicted
  from the cursor map. The next message is caught by discovery if it
  still matches the inbox-addressed query, or via the `inbox`
  low-water-mark advancing past the gap.
- **The `inbox` low-water-mark is never evicted** — it monotonically
  advances or stays put.

For every key you evict, append a `gmail-thread-evicted` entry to
`sync.md → errors` naming the dropped key. The agntux-core
`validate-cursor.mjs` PreToolUse hook rejects writes that silently drop
a prior cursor key without an `evicted`-marked error line. The same
hook rejects regressions where `discovery_ts` moves backward, or where
a previously-non-null cursor key regresses to `null`.

## Cursor map shape

The `cursor` field in `data/learnings/agntux-gmail/sync.md` is a
single-line JSON object carrying both key shapes — a unified map.
Parse with `JSON.parse(cursor)`, serialise with `JSON.stringify(map)`.

```
cursor: {"inbox":"1714300000","1934f56abcdef012":"1714386500","1934f78ace01345":"1714390000"}
```

There is no separate `threads:` field; thread-shaped keys live in the
same map distinguished from the literal `inbox` string by their
opaque-id shape.

## Worked diff (incremental run)

Prior cursor: `{"inbox":"1714300000","1934f56abcdef012":"1714386500"}`

This run discovers two new threads and advances one existing thread:

- Added: `"1934f78ace01345"` → `null` (bootstrap on next pass).
- Added: `"1934f99bd012ace"` → `null`.
- Advanced: `"1934f56abcdef012"`: `1714386500` → `1714400000`.
- Advanced: `"inbox"`: `1714300000` → `1714400000`.

New cursor:
`{"inbox":"1714400000","1934f56abcdef012":"1714400000","1934f78ace01345":null,"1934f99bd012ace":null}`

The hook accepts this write because: every advanced value is
monotonically increasing; the `null` values for the new keys are valid
bootstrap markers; and no key was silently dropped.

## Persisting `user_email`

When Step 5a/5b captures `user_email` for the first time, persist it
**independent of the transactional rule** — it's observation-derived,
not work-derived. Once non-null, the value is account-stable and never
overwritten.
