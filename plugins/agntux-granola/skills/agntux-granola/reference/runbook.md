# Granola sync — runbook reference

Companion to `../SKILL.md`. The SKILL describes WHAT to do at run time;
this file collects the failure-mode taxonomy, worked examples, and
reference tables the agent only needs when something goes wrong.

This file is **O** — per-plugin override (wholesale replace via
`_overrides/resources/runbook.md`). The canonical baseline below is a
generic taxonomy that sources without exotic failure modes can use
unchanged.

## Permitted `errors:` `kind:` taxonomy

`sync.md → errors` is bounded to the last 10 entries (newest-first)
and carries **only** structured failure-mode entries that change the
next run's behaviour. `errors:` is **not** a journal of run-summary
prose. Every entry MUST declare a `kind:` from this list.

**Generic kinds (every plugin):**

- **Fetch failure** — `auth`, `network`, `parse`, `source`, `internal`.
- **Lock acquisition** — `lock-acquire-race`, `lock-acquire-failed`.
- **Schema drift** (Step 0 outcomes) — `contract-version-drift`
  (master MAJOR > contract MAJOR; exit-clean and await architect),
  `contract-not-registered` (contract markdown exists but the lock
  hasn't picked it up), `contract-minor-out-of-date` (contract MINOR
  lags master; pass through but flag).
- **Pre-flight** — `bootstrap_window_days-out-of-range` (Step 4),
  `usermd-malformed` (Step 1).
- **Contract violation at write time** — `subtype-out-of-contract`
  (Step 6: candidate entity subtype isn't in the plugin's contract).
- **Write-lane enforcement** — `out-of-lane-write-attempted: <path>`
  (skill attempted to write outside the permitted lanes — see "Out
  of scope" in `./sync.md`. The agntux-core hook
  `validate-write-lane.mjs` is the defence-in-depth backstop).
- **Cross-source dedup outcomes** (Step 9) —
  `granola-merged-into-{existing_id}`,
  `granola-reconcile-failed`.
- **Cursor / fetch outcomes** —
  `granola-cursor-evicted: <key>` (third consecutive deleted /
  permission-revoked failure on the same key — see "Failure modes"
  below), `granola-tool-result-truncated` (oversized response
  redirected to a temp file).
- **Deferred-bootstrap outcomes** (Step 8.6) —
  `granola-deferred-orphan: <id>` (the originating
  meeting's cursor was evicted between the deferred run
  and this drain pass).

**Source-specific extensions** are declared in the plugin's
`_overrides/frontmatter.yaml` under `permitted-error-kinds:` and
listed in this file's per-plugin override. Examples:
`slack-thread-evicted`, `slack-thread-orphaned`,
`slack-channel-truncated`, `slack-bootstrap-interrupted`,
`slack-large-backlog`, `gmail-denylist-section-missing`.

There is no `kind: debug` and no `kind: info`. The final chat
summary (Step 11) is the run output for the user. Anything that
doesn't change the next run's behaviour does not belong in
`errors:`.

## Failure modes

Each is logged to `sync.md → errors` with one of the kinds above:

- **Search consent denied** → `kind: auth`, exit cleanly.
- **Rate limit (HTTP 429)** → `kind: network`, skip the affected item,
  continue.
- **Item deleted / permission revoked** → `kind: source`. On the third
  consecutive failure for the same key, remove from the cursor map and
  log a `granola-cursor-evicted: <key>` entry.
- **Stale cursor / source retention purged the cursor's referent** →
  fall back to `last_success` per `cursor-strategies.md`'s per-source
  gap-recovery recipe; bootstrap fresh if `last_success` is also null.
- **Tool-result truncation** (the host's MCP layer redirects oversized
  responses to a temp file and returns a "use offset/limit" marker) →
  log `granola-tool-result-truncated` with `kind: source` and
  the tool name, skip the affected fetch for this run, and do NOT read
  the temp file. Step 11's transactional rule keeps the cursor
  untouched so the next run retries.

## Cap at 200 items per run

If the source returns more than 200, process the oldest 200 first
(sort by ts ASC), advance cursor, exit. The next run picks up.

## On fetch failure across the whole sweep

Log to `data/learnings/agntux-granola/sync.md → errors` with one of
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
