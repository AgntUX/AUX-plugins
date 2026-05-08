# agntux-slack sync — runbook reference

Companion to `../SKILL.md`. The SKILL describes WHAT to do at run time;
this file collects the failure-mode taxonomy, worked examples, and
reference tables the agent only needs when something goes wrong.

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
