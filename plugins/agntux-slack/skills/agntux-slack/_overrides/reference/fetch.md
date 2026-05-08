# Slack fetch — Step 5 orchestration

Companion to `../SKILL.md` Step 5. The Slack source has no
`list_channels` MCP tool, so coverage is hybrid: a discovery sweep
seeds the per-channel cursor map, then per-channel polling does the
bulk of the work, then a per-thread pass catches new replies on
parents older than the channel cursor. All passes run on every run.

### Step 5a — Resolve current user

If `sync.md → user_id` is non-null (persisted on a prior run), reuse it and skip the call — `user_id` is workspace-stable for the lifetime of the cursor file. Otherwise call `slack_read_user_profile()` once with no arguments and persist the resolved `user_id` (e.g. `U01ABC`) in Step 11. Also cache `email` and `real_name` in working memory for this run's entity resolution. If the call fails (rare, only on a cold-start), log kind `auth` to `sync.md → errors` and exit cleanly — without `user_id`, discovery queries cannot be constructed.

### Step 5b — Discovery sweep

**Skip-discovery fast path.** If `last_success` is non-null AND less than 5 minutes ago, skip Step 5b entirely and proceed to Step 5c with the existing cursor map and `discovery_ts`. Discovery in steady-state with a 5-minute cadence returns redundant work — per-channel polling on already-tracked channels picks up the same messages. The fast-path kicks in only when `cursor` is non-empty (post-bootstrap) and `last_success` is fresh.

Three search queries seed/touch the cursor map. Paginate each until exhausted or a per-run cap of 5 pages × 20 results = 100 hits. `slack_search_public_and_private` caps at 20 per call; paginate via `cursor`.

1. **User-authored** — `slack_search_public_and_private(query: "from:<@USERID> after:<discovery_ts or last_run>", channel_types: "public_channel,private_channel,im,mpim")`.
2. **User-mentioned** — same shape with `<@USERID>` as the query (catches @mentions in channels the user has not posted in).
3. **DM activity** — same shape with bare `after:` filter and `channel_types: "im,mpim"`.

For each result:
- If a bare `<channel_id>` key is missing from the cursor map, add it with value `null`.
- If the result is a thread reply (`thread_ts != ts`) AND `<channel_id>#<thread_ts>` is missing, add it with value `null` (Step 5c-pre / 5d drains the null on the per-thread pass; the `#`-separator distinguishes shape, no separate threads field).
- Discovery only **upserts missing keys** — it must NOT overwrite an existing channel- or thread-shaped cursor value. Steps 5c / 5d own advancement.
- **`discovery_ts` is the max across ALL THREE queries.** After all three queries have paginated to exhaustion, compute `discovery_ts = max(...all_results.map(r => Number(r.ts)))` over the union of every hit from `from:`, `<@user_id>`, and `to:me` queries. **Not** the max of any single query. If only one query returned hits this run, that query's max is the union max — no advance from prior runs is allowed unless one of the three queries observed a newer ts.
- **Capture `workspace_subdomain` if not already set.** When still `null` from Step 2 AND the result envelope includes a `Permalink:` field, apply regex `^https?://([^.]+)\.slack\.com/` and store group 1 verbatim into `sync.md → workspace_subdomain` (persisted in Step 11). Once set, never re-derive — workspace-stable. If discovery returns no permalinks at all (rare; first-run empty workspace), Step 10 omits the `Open in Slack` row this run.

**First-run consent failure.** `slack_search_public_and_private` requires user consent. On consent-denied error from any of the three queries, log kind `auth` with `"slack search consent denied — grant the connector's search permission and re-run /agntux-slack"` and exit cleanly. Do NOT proceed without discovery — coverage would be incomplete.

**Shared channels (Slack Connect).** Permalinks return whichever workspace authored the message. A hostname differing from `workspace_subdomain` (e.g. `avalara.slack.com` while the file says `oatfi`) is a normal shared-channel signal — NOT evidence of a thread reply or anomaly. Use the envelope's `thread_ts` / `parent_ts` for thread structure, never the permalink path. Step 10's `Open in Slack` URL always uses `workspace_subdomain` so the user lands in their own workspace. Don't burn chain-of-thought debating the hostname mismatch — it is expected.

### Slack since-parameter behaviour (`oldest:` is inclusive)

Slack's `oldest:` parameter on `slack_read_channel` and `slack_read_thread` is **inclusive** at the boundary: the cursor-boundary message itself reappears in results as Result 1. Treat the boundary record as already-processed during dedup at Step 6 — do not re-debate inclusivity at runtime, and do not "advance the cursor by 1 ts" to compensate (Slack ts values are not integers; `+1` is meaningless).

### Cursor-advance discipline (Slack C1 — never advance to an unseen ts)

**Never advance any cursor value to a ts the model did not see in a real `Message_ts:` field of a fetched message in this run.** Cursor advancement is bounded by the run's fetch buffer; permalink-extracted ts values, search-query result envelope ts, or any other indirect ts MUST NOT be written into the cursor map. If a thread had no real reply ts surfaced this run, leave its cursor at the prior value or at the parent ts as documented per step. Permalink hostnames may diverge from `workspace_subdomain` for shared channels (Slack Connect) — the path's ts is still not a cursor candidate.

All `slack_read_thread` calls below MUST pass `response_format: "detailed"` (or whatever returns per-message ts in `Message_ts:` form) — the default `concise` format strips reply ts values from rendered output and forces the model to guess.

### Step 5c-pre — Drain bootstrap-deferred null thread cursors (every run)

Before walking channel cursors, iterate every thread-shaped key (key contains a `#` separator) whose value is `null`. For each:

1. Call `slack_read_thread(channel_id, message_ts: thread_ts, response_format: "detailed", limit: 1000)` with no `oldest:` (whole thread).
2. Add `<channel_id>#<thread_ts>` to the working-memory `fanned_out` set so 5c and 5d won't re-fetch.
3. Advance `cursor[<channel_id>#<thread_ts>]` to the newest reply `Message_ts:` processed (or the parent `Message_ts:` if no replies yet). Per the cursor-advance discipline above: if the response yielded no parseable `Message_ts:` for any reply, leave the value at the parent's `Message_ts:` (still observed in this run) — do NOT use a permalink-extracted ts.
4. On failure, log `kind: source` with `thread_id: <channel_id>#<thread_ts>` and leave the cursor unchanged for next run.

This runs on **every run**, not just bootstrap. Bootstrap-deferred `null` thread cursors must NEVER survive a second scheduled run untouched. Closes the gap where Step 5d (which only runs after the per-channel pass) could leave a `null` indefinitely if the per-channel pass crashed first.

### Step 5c — Per-channel polling (bulk of the work)

**Walk-set short-circuit (O2).** When `last_success` is non-null AND less than 1 day ago, restrict the walk-set to: (a) channels whose `<channel_id>` appeared in this run's discovery hits, plus (b) channels with cursor older than `last_success - 1 day`. Channels with no John-authored or @-mention activity that are also recently-polled fall out of this run's per-channel pass — discovery would have surfaced them if they had new triage-relevant content. Skipped channels are NOT logged. On the first run after a cold-start (`last_success: null`) walk every channel-shaped key.

Walk the resulting set in **cursor-stale order**: explicitly sort the entries ascending by cursor value before iterating (`Object.entries(cursor).filter(channel-shaped).sort((a,b) => Number(a[1] ?? 0) - Number(b[1] ?? 0))`). Map insertion order is irrelevant. The most-stale channel must run first. For each:

1. `cursor[<channel_id>] === null` → bootstrap read using `bootstrap_window_days` (default 7). `slack_read_channel(channel_id, oldest: <now − window>, limit: 100)`.
2. `cursor[<channel_id>] === "<ts>"` → incremental read. `slack_read_channel(channel_id, oldest: <ts>, limit: 100)`. Slack's `oldest:` is inclusive (see "Slack since-parameter behaviour" above) — expect the cursor-boundary message in results.
3. Paginate via the returned `cursor` until exhausted or the **200-message-per-channel cap** is hit. On cap, log `slack-channel-truncated` and continue — next run picks up from the advanced cursor.
4. **Thread fanout — pull every thread, always.** For each message returned by `slack_read_channel`, treat ANY of these as evidence of thread activity: `reply_count > 0`, `reply_users_count > 0`, `latest_reply` set, `thread_ts` present, the message appears as a `thread_ts` parent of any other message fetched in this run, OR the message envelope contains a literal trailing line of the form `Thread: N replies (latest: YYYY-MM-DD HH:MM:SS TZ)` for any `N >= 1` (the Slack MCP `slack_read_channel` detailed format does not return a numeric `reply_count`; thread presence is signaled only by this envelope line). **Do not rely on `reply_count` alone — Slack frequently omits it on `slack_read_channel` payloads, especially in DMs and private channels.** If any signal is true AND `<channel_id>#<parent_ts>` is NOT already in `fanned_out` (5c-pre may have already drained it), you MUST call `slack_read_thread(channel_id, message_ts: <parent_ts>, response_format: "detailed", limit: 1000)` to pull the full thread.

   `<parent_ts>` is `thread_ts` when the message is a reply (`thread_ts !== ts`), or the message's own `ts` when it is itself a parent. Track every fetched parent in `fanned_out` keyed by `<channel_id>#<thread_ts>` and add the same key to the cursor map with the newest reply `Message_ts:` from the detailed response as value (per cursor-advance discipline — never a permalink ts). Step 5d skips anything in `fanned_out`.

   If `slack_read_thread` fails, log `kind: source` with `thread_id: <channel_id>#<thread_ts>` AND **do not raise an action item that depends on that thread's content** — better silence than a half-context decision.
5. Advance `cursor[<channel_id>]` to the **newest channel-level (parent) `Message_ts:` processed**. Reply-only ts values do NOT advance the channel-shaped entry — they advance the thread-shaped entry (already done in 4 for fanned-out threads, or by Step 5d).

If processing exceeds 50 channels, log `slack-large-backlog` and continue — better slow-and-complete than fast-and-lossy. Cap at 200 items per channel per run; sort by ts ASC inside each channel for deterministic cursor advancement.

### Step 5d — Per-thread pass (catch new replies on old parents)

After per-channel polling, walk every **thread-shaped key** that is NOT in the `fanned_out` set (5c-pre or 5c just fetched it; re-fetching would be wasted work). For each remaining `<channel_id>#<thread_ts>`:

1. **Incremental branch (steady-state)** — if `cursor[<channel_id>#<thread_ts>]` is a `<ts>` string: `slack_read_thread(channel_id, message_ts: thread_ts, oldest: <ts>, response_format: "detailed", limit: 1000)`.
2. **Bootstrap branch (fallback only)** — if `cursor[<channel_id>#<thread_ts>] === null`, this entry should have already been drained by Step 5c-pre; reaching this branch means 5c-pre was skipped or crashed. Treat as fallback: `slack_read_thread(channel_id, message_ts: thread_ts, response_format: "detailed", limit: 1000)` with no `oldest:`. **Do not silently skip null cursors here** — leaving them in place is the original defect 5c-pre was added to fix.
3. New replies feed the same dedup pipeline (Step 6 onward). Slack's `oldest:` is inclusive — the cursor-boundary message reappears as Result 1; treat it as already-processed.
4. Advance `cursor[<channel_id>#<thread_ts>]` to the newest reply `Message_ts:` processed in this run's fetch buffer (per cursor-advance discipline — never a permalink ts; never a value not surfaced as a real `Message_ts:` field). If the response yielded only the parent's `Message_ts:` (no new replies), leave the value at the prior cursor — do not regress.

**Eviction.** Thread-shaped entries with no activity for 30 days are evicted from the cursor map (the next reply is caught by discovery if it tags the user, or by re-discovery via `slack_read_channel` if the parent itself is touched). Channel-shaped entries are never evicted.

### Step 5e — Thread coverage check

Walk every parent message processed in this run. Each must satisfy one of:

1. (a) No thread evidence (none of `reply_count`, `reply_users_count`, `latest_reply`, `thread_ts`, no `Thread: N replies` envelope line, and never appeared as a parent of another fetched message), OR
2. (b) `<channel_id>#<parent_ts>` is in `fanned_out` OR has a non-null cursor value, OR
3. (c) Step 5d covered it.

Any parent that fails (a)/(b)/(c) is an orphaned thread → log `slack-thread-orphaned` with `parent_ref: <channel_id>#<parent_ts>`. The next run picks it up via discovery; the log line makes the gap observable now.

This is a self-check on Step 5c's broader-trigger rule, not a re-fetch. It does not call any MCP tool.

### Failure modes

See `./runbook.md` for the failure-mode taxonomy, the 200-message-per-channel cap rationale, and gap-recovery recipes.
