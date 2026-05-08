# agntux-slack sync — runbook reference

Companion to `../SKILL.md`. The SKILL describes WHAT to do at run time;
this file collects the failure-mode taxonomy, worked examples, and
reference tables the agent only needs when something goes wrong.

## Permitted `errors:` `kind:` taxonomy

`sync.md → errors` is bounded to the last 10 entries (newest-first) and carries **only** structured failure-mode entries that change the next run's behaviour. `errors:` is **not** a journal of run-summary prose. Every entry MUST declare a `kind:` from this list.

**Generic kinds:**

- **Fetch failure** — `auth`, `network`, `parse`, `source`, `internal`.
- **Lock acquisition** — `lock-acquire-race`, `lock-acquire-failed`.
- **Schema drift** (Step 0) — `contract-version-drift`, `contract-not-registered`, `contract-minor-out-of-date`.
- **Pre-flight** — `bootstrap_window_days-out-of-range`, `usermd-malformed`.
- **Contract violation at write time** — `subtype-out-of-contract`.
- **Write-lane enforcement** — `out-of-lane-write-attempted: <path>` (skill attempted to write outside the permitted lanes — see "Out of scope" in `./sync.md`. The agntux-core hook `validate-write-lane.mjs` is the defence-in-depth backstop).
- **Cross-source dedup outcomes** (Step 9) — `slack-merged-into-{existing_id}`, `slack-reconcile-failed`.
- **Cursor / fetch outcomes** — `slack-cursor-evicted: <key>` (third consecutive deleted / permission-revoked failure on the same key), `slack-tool-result-truncated`.
- **Deferred-bootstrap outcomes** (Step 8.6) — `slack-deferred-orphan: <id>`.

**Slack-specific extensions** (declared in `_overrides/frontmatter.yaml → permitted-error-kinds:`): `slack-thread-evicted`, `slack-thread-orphaned`, `slack-channel-truncated`, `slack-bootstrap-interrupted`, `slack-large-backlog`.

There is no `kind: debug` and no `kind: info`. The final chat summary (Step 11) is the run output for the user. Anything that doesn't change the next run's behaviour does not belong in `errors:`.

## Failure modes

Each is logged to `sync.md → errors` with one of `network | auth | parse | source | internal`:

- Search consent denied → `kind: auth`, exit cleanly (covered in Step 5b).
- Channel rate limit (HTTP 429) → `kind: network`, skip channel, continue.
- Channel deleted/permission revoked → `kind: source`, increment a registry-internal failure counter; on the third consecutive failure, remove from the cursor map (cleared on success).
- Reply fetch fails on a known thread → `kind: source` with `thread_id`, leave the thread cursor unchanged (re-tried next run), continue.
- Stale cursor / Slack message retention purged the cursor's referent → fall back to `last_success` per `cursor-strategies.md` Slack gap-recovery; bootstrap fresh if `last_success` is also null.

**Cap at 200 items per channel per run.** If the source returns more than 200, process the oldest 200 first (sort by ts ASC), advance cursor, exit. The next run picks up.

**On fetch failure across the whole sweep:** log to `data/learnings/agntux-slack/sync.md → errors` with one of `network | auth | parse | source | internal`, update `last_run`, release lock, exit. (The errors list is bounded to 10 entries — slice before writing; do not narrate a count or trim step.)

**Gap recovery:**
- Bootstrap with empty cursor: filter for messages with `ts > (now − bootstrap_window_days days)`.
- Many channels touched at once (large backlog): sort by cursor staleness ASC, process channels with the oldest cursors first, advance per-channel cursor, exit. mtime ASC equivalent: process oldest ts first within each channel.
- Cursor-strategies.md Slack section is the canonical reference.
