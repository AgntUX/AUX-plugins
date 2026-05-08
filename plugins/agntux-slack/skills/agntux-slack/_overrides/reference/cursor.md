# Slack cursor advance reference

Companion to `../SKILL.md` Step 11. The transactional rule, diff
expression, and `validate-cursor.mjs` interaction live in the SKILL
body. This file documents Slack's three-layer cursor structure.

## Cursor advance layers

| Layer | Key shape in `cursor` map | What advances | When advanced |
|---|---|---|---|
| Channel cursor | `<channel_id>` (no `#`) | Newest parent-message ts processed in that channel | After per-channel pass completes |
| Thread cursor | `<channel_id>#<thread_ts>` (contains `#`) | Newest reply ts processed in that thread | After per-thread pass completes |
| Discovery low-water-mark | n/a — separate field | Newest message ts seen by any search query | `sync.md → discovery_ts` at end of run; used as `after:` filter next run |

## Eviction

- **Thread-shaped entries** with no activity for 30 days are evicted from
  the cursor map. The next reply is caught by discovery if it tags the
  user, or by re-discovery via `slack_read_channel` if the parent itself
  is touched.
- **Channel-shaped entries are never evicted**, even when stale.
- **The discovery low-water-mark (`discovery_ts`) is never evicted** — it
  monotonically advances or stays put.

For every key you evict, append a `slack-thread-evicted` entry to
`sync.md → errors` naming the dropped key. The agntux-core
`validate-cursor.mjs` PreToolUse hook rejects writes that silently drop
a prior cursor key without an `evicted`-marked error line. Same hook
rejects regressions where `discovery_ts` moves backward, or where a
previously-non-null cursor key regresses to `null`.

## Cursor map shape

The `cursor` field in `data/learnings/agntux-slack/sync.md` is a
single-line JSON object carrying both key shapes — a unified map. Parse
with `JSON.parse(cursor)`, serialise with `JSON.stringify(map)`.

```
cursor: {"C031V2MJ2KA":"1714300000.000100","C031V2MJ2KA#1714300000.000100":"1714386500.000300","D03JOHN":"1714390000.000400"}
```

There is no separate `threads:` field; thread-shaped keys live in the
same map distinguished by the `#` separator.
