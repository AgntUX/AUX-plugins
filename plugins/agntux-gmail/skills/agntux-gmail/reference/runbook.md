# Gmail sync — runbook reference

Companion to `../SKILL.md`. Failure-mode taxonomy, gap-recovery recipes,
and reference details the agent only needs when something goes wrong.

## Failure modes

Each is logged to `sync.md → errors` with one of `network | auth |
parse | source | internal`:

- **Search consent denied** → `kind: auth`, exit cleanly.
- **Rate limit (HTTP 429)** → `kind: network`, skip the affected thread,
  continue.
- **Thread deleted / permission revoked** → `kind: source`. On the
  third consecutive failure for the same key, remove from the cursor
  map and log a `gmail-thread-evicted` entry naming the key.
- **Stale cursor / thread purged from Gmail** → fall back to
  `last_success`; bootstrap fresh if `last_success` is also null.
- **Tool-result truncation** on either `search_threads` or `get_thread`
  (the host's MCP layer redirects oversized responses to a temp file
  and returns a "use offset/limit" marker) → log
  `gmail-tool-result-truncated` with `kind: source` and the tool name,
  skip the affected thread for this run, and do NOT read the temp file.
  Step 11's transactional rule keeps the thread cursor untouched so
  the next run retries.

## Cap at 200 messages per run

If processing would exceed 200 total messages, sort by `internalDate`
ASC, process the oldest 200, advance cursors for what was processed,
and exit. The next run picks up.

## On fetch failure across the whole sweep

Log to `data/learnings/agntux-gmail/sync.md → errors` (slice to the
bounded-list cap before writing), update `last_run`, release the lock,
exit. Step 11's transactional rule keeps `cursor` and `discovery_ts`
at their pre-run values so the next run retries the same window.

## Gap recovery

- **Bootstrap with empty cursor:** filter for messages where
  `internalDate > (now − bootstrap_window_days days)`.
- **Many threads touched at once (large backlog):** sort by cursor
  staleness ASC, process threads with the oldest cursors first,
  advance per-thread cursor, exit. The next run picks up.
- **Gmail historyId expiry:** Gmail does not expose a `historyId` to
  this plugin's tool surface; cursor advance is internalDate-driven, so
  the failure mode is "thread purged before fetch" — covered above
  under "Stale cursor".

## Worked example — first-run bootstrap

User runs `/agntux onboard`, which fires `/agntux-gmail` with
`cursor: {}` and `last_success: null`. Skill reads
`bootstrap_window_days = 14` from `user.md` (default for Gmail).
Step 5b discovery returns 23 thread_ids; cursor map becomes
`{ "inbox": "1714300000", "1934f56abcdef012": null, ... × 22 more }`.
Step 4's heads-up message prints with `{N: 23}`.

Step 5c walks all 23 threads in cursor-stale order (all `null`, so
arbitrary order). Each thread bootstraps via
`get_thread(threadId, messageFormat: "FULL_CONTENT")` and advances
its key to the newest internalDate processed. End-of-run cursor map
is fully bootstrapped and the next run is incremental.

## Worked example — incremental run with denylist auto-learn

User has accumulated 5 sends from `mailer-daemon@gmail.com` over the
past hour. Step 8 increments
`noise_drop_counts["mailer-daemon@gmail.com"] = 5`. Step 11 sub-step 5:
gates pass (no recent action mentions this sender, not already in
`# Sender denylist`, no `# Always raise` rule), so the skill appends:

```
- mailer-daemon@gmail.com  <!-- added: 2026-05-07, dropped: 5 -->
```

to `data/instructions/agntux-gmail.md → # Sender denylist` (newest at
top). Next run's Step 5b discovery query incorporates
`-from:mailer-daemon@gmail.com` automatically.
