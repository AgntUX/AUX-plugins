# {{source-display-name}} sync — runbook reference

Companion to `../SKILL.md`. The SKILL describes WHAT to do at run time;
this file collects the failure-mode taxonomy, worked examples, and
reference tables the agent only needs when something goes wrong.

This file is **O** — per-plugin override (wholesale replace via
`_overrides/resources/runbook.md`). The canonical baseline below is a
generic taxonomy that sources without exotic failure modes can use
unchanged.

## Failure modes

Each is logged to `sync.md → errors` with one of `network | auth |
parse | source | internal`:

- **Search consent denied** → `kind: auth`, exit cleanly.
- **Rate limit (HTTP 429)** → `kind: network`, skip the affected item,
  continue.
- **Item deleted / permission revoked** → `kind: source`. On the third
  consecutive failure for the same key, remove from the cursor map and
  log a `{{source-slug}}-cursor-evicted` entry naming the key.
- **Stale cursor / source retention purged the cursor's referent** →
  fall back to `last_success` per `cursor-strategies.md`'s per-source
  gap-recovery recipe; bootstrap fresh if `last_success` is also null.
- **Tool-result truncation** (the host's MCP layer redirects oversized
  responses to a temp file and returns a "use offset/limit" marker) →
  log `{{source-slug}}-tool-result-truncated` with `kind: source` and
  the tool name, skip the affected fetch for this run, and do NOT read
  the temp file. Step 11's transactional rule keeps the cursor
  untouched so the next run retries.

## Cap at 200 items per run

If the source returns more than 200, process the oldest 200 first
(sort by ts ASC), advance cursor, exit. The next run picks up.

## On fetch failure across the whole sweep

Log to `data/learnings/{{plugin-slug}}/sync.md → errors` with one of
the kinds above (slice to the bounded-list cap before writing), update
`last_run`, release the lock, exit. Step 11's transactional rule
keeps `cursor` and any low-water-marks at their pre-run values so the
next run retries the same window.

## Gap recovery

- **Bootstrap with empty cursor:** filter for items where the source
  timestamp falls within `(now − bootstrap_window_days days, now]`.
- **Many items touched at once (large backlog):** sort by cursor
  staleness ASC, process items with the oldest cursors first, advance
  per-item cursor, exit. The next run picks up.
- **Source-specific symptoms:** see `cursor-strategies.md` (Gmail
  historyId expiry, Slack stale-ts, Jira backlog, etc.).

## Worked examples

Per-plugin overrides include source-specific worked examples (a real
cursor diff, a sample failure log entry, the deep-link URL families,
etc.) when the canonical baseline doesn't make the recipe obvious.
