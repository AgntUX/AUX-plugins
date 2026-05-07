# agntux-slack sync — runbook reference

Companion to `SKILL.md`. The SKILL describes WHAT to do at run time;
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

**On fetch failure across the whole sweep:** log to `data/learnings/agntux-slack/sync.md → errors` with one of `network | auth | parse | source | internal`, update `last_run`, release lock, exit. (The errors list is auto-trimmed to 10 by an agntux-core PostToolUse hook — append freely; do not narrate a count or trim step.)

**Gap recovery:**
- Bootstrap with empty cursor: filter for messages with `ts > (now − bootstrap_window_days days)`.
- Many channels touched at once (large backlog): sort by cursor staleness ASC, process channels with the oldest cursors first, advance per-channel cursor, exit. mtime ASC equivalent: process oldest ts first within each channel.
- Cursor-strategies.md Slack section is the canonical reference.

## slack_open_url construction

The same template covers every action shape this skill emits — the channel-id prefix does not change the URL family:

| `source_ref` shape | Example channel id prefix | Notes |
|---|---|---|
| Thread-rooted action `<channel_id>#<thread_ts>` | `C` (public), `G` (private), `D` (DM), `C…`/`G…` (mpim group DM) | URL lands the user on the thread parent in Slack. |
| Top-level channel message `<channel_id>#<ts>` | same | URL lands on the message. |
| DM-rooted action `<D…>#<ts>` (1:1 DM) | `D` only | Same template; DM channel ids slot into the same `archives/{id}/p…` form. |

We do **not** branch on the channel-id prefix — Slack's `https://{ws}.slack.com/archives/{any_channel_id}/p{ts_no_dot}` URL family accepts every channel-id shape Slack issues (public `C`, legacy private `G`, DM `D`, and the `C`/`G`/`D` shapes used for group DMs). The reply-level `?thread_ts=…&cid=…` query form documented in `~/Downloads/slack-deeplink-guide.md` is intentionally out of scope here — landing on the thread parent is the desired UX for "Open in Slack".

Worked example: `workspace_subdomain: "oatfi"`, `source_ref: "C031V2MJ2KA#1777391863.734439"` → `slack_open_url := "https://oatfi.slack.com/archives/C031V2MJ2KA/p1777391863734439"`.

## Cursor advance layers

| Layer | Key shape in `cursor` map | What advances | When advanced |
|---|---|---|---|
| Channel cursor | `<channel_id>` (no `#`) | Newest parent-message ts processed in that channel | After per-channel pass completes |
| Thread cursor | `<channel_id>#<thread_ts>` (contains `#`) | Newest reply ts processed in that thread | After per-thread pass completes |
| Discovery low-water-mark | n/a — separate field | Newest message ts seen by any search query | `sync.md → discovery_ts` at end of run; used as `after:` filter next run |
