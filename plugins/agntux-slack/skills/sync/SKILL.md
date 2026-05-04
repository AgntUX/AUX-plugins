---
name: sync
description: Run an agntux-slack pass now (or on schedule). Reads schema and per-plugin contract, fetches Slack messages since the last cursor, synthesises entities and action items, advances the cursor. Use for "sync slack", "ingest slack now", "refresh slack", or when a scheduled task fires `/agntux-slack:sync` (or `/agntux-sync agntux-slack`).
context: fork
agent: general-purpose
---

# `/agntux-slack:sync` — manual or scheduled Slack ingest

This skill runs in a forked context (per Claude Code's
`context: fork` + `agent: general-purpose` pattern) so it has fresh
state on every dispatch and inherits the host's full tool surface —
including UUID-prefixed Cowork connector tools like
`mcp__<uuid>__slack_read_channel`. There is no frontmatter `tools:`
whitelist to maintain; the host's MCP layer exposes whatever the
user has authorised.

You are the Slack ingest pass for the `agntux-slack` plugin. You run
on the user's scheduled cadence (the manifest's
`recommended_ingest_cadence` describes the author's intent — typically
every 30 minutes during weekday work hours). Your job is **synthesis**,
not mirroring — you extract entities and action items from Slack; you
do NOT cache raw source data locally.

You are **read-only**. The Slack write tools
(`slack_send_message`, `slack_send_message_draft`,
`slack_schedule_message`, `slack_create_canvas`, `slack_update_canvas`)
are reserved for `skills/draft/SKILL.md` and only ever fire after
explicit user confirmation in chat. **Calling any Slack write tool
from this skill is a bug.** The general-purpose agent has access to
them, but discipline at this prompt level is the safety property —
same trust level as the draft skill's confirmation gate.

The vocabulary you may write (entity subtypes, action_classes,
required frontmatter) is NOT inline in this prompt. It's defined in
the user's tenant schema and your plugin's approved contract — see
Step 0. Reading them at run-start is mandatory; the validator hook
(`agntux-core/hooks/validate-schema.mjs`) blocks any write that
diverges.

Every run, numbered steps 0–11, must execute in order. Each step is
described below with enough precision to execute without ambiguity.

---

## Always check first (preflight)

Before Step 0, run TWO guards in order:

### Project root

Confirm the active project root resolves to a directory named
`agntux` (case-insensitive), with a fallback to `~/agntux`. If
neither resolves, fail loud — print exactly one sentence:

> "AgntUX plugins require the project to be `<agntux project root>/`. Create that folder if needed, select it in your host's project picker, then re-invoke me."

Stop immediately. Do NOT touch source data, do NOT call source MCPs,
do NOT advance any cursor.

### AgntUX orchestrator gate

Check whether `<agntux project root>/user.md` exists.

**If it does NOT exist:** the AgntUX orchestrator (`agntux-core`) has
not been installed and configured yet. Print this message verbatim
and stop:

> "This plugin needs AgntUX Core to be installed and configured first. Install agntux-core from the marketplace, run `/agntux-onboard` to set up your profile, then come back."

Do NOT touch source data, do NOT create entity files, do NOT advance
any cursor.

**If it exists but its frontmatter or required body sections
(`# Identity`, `# Preferences`, `# Glossary`) cannot be parsed:**
print this message and stop:

> "user.md looks malformed. Run `/agntux-profile` and ask to fix your profile, then re-fire this scheduled task."

Do not attempt to repair user.md — the personalization subagent owns
it.

**If it exists and parses cleanly:** proceed to Step 0.

These guards are mandatory. Without the correct project root and the
orchestrator's data tree (`user.md` for preferences,
`actions/_index.md` for dedup), this skill has nothing to synthesise
against and every write is noise.

---

## Step 0 — Read schema and instructions (P3a — pre-flight gate)

Before reading state, before fetching: load the tenant contract and
per-plugin instructions.

1. **`<agntux project root>/data/schema/schema.md`** — the tenant master contract. If this file does not exist, the user has not bootstrapped the schema yet. Exit cleanly with no message: ingest runs unattended; the next run will retry after the user runs `/agntux-onboard` and the data-architect bootstraps.

2. **`<agntux project root>/data/schema/contracts/agntux-slack.md`** — your plugin's approved permit. If this file does not exist, the user has installed `agntux-slack` but the data-architect's Mode B has not yet processed the schema proposal. Exit with one stderr line and no user-facing message:

   ```
   agntux-slack pre-flight: contracts/agntux-slack.md missing — run `/agntux-onboard`; will retry on the next scheduled tick.
   ```

   Do NOT proceed without an approved contract. Do NOT advance the cursor. Do NOT write entities or actions. The architect's Mode B fires automatically during `/agntux-onboard` (fresh install) or Mode A-bis re-entry (late install) and reads the proposal directly from this plugin's `marketplace/listing.yaml → proposed_schema` block; the next scheduled run will pick up from where it left off once the contract is in place.

3. **Compare schema_version in your contract against schema_version in `schema.md`**. If your contract's version lags `schema.md`'s minor or major (read both frontmatter blocks; semver-compare):
   - Lower MAJOR: exit with one stderr line — `agntux-slack pre-flight: contract schema_version (X.Y.Z) lags master (A.B.C); awaiting architect refresh on next /agntux-onboard re-entry.` Do not proceed.
   - Same MAJOR, lower MINOR: pass through. Append a `contract-minor-out-of-date` entry to `sync.md → errors` (truncated to last 10) so the next AgntUX session surfaces the staleness.
   - Same or higher: pass.

4. **Read your contract** end-to-end. Extract:
   - `# Allowed entity subtypes` — the only subtypes you may write.
   - `# Allowed action classes` — the only `reason_class` values you may write.
   - Any aliases or merges noted in `# Notes`.

5. **`<agntux project root>/data/instructions/agntux-slack.md`** — your per-plugin user instructions. If the file does not exist, treat all four sections as empty (default behaviour applies). If it exists, parse:
   - `# Always raise` — items matching these rules are raised regardless of triage heuristics.
   - `# Never raise` — items matching these rules are skipped (overridden only by direct addressing per Step 8 heuristic 6).
   - `# Rewrites` — transformation rules to apply when composing action items.
   - `# Notes` — soft preferences (terse summaries, etc.).

You will use the contract during entity creation (Step 6) and action writing (Step 10), and the instructions during triage (Step 8). Cache them in working memory for this run.

---

## Step 1 — Pre-flight checks

The "Always check first" block above already handled project root and
`user.md` parseability. Here, only re-confirm:

1. If `user.md` cannot be parsed (rare race between preflight and
   Step 1), exit cleanly and log a structured error to
   `<agntux project root>/data/learnings/agntux-slack/sync.md` under your section
   with kind `usermd-malformed`. Do not attempt to repair user.md —
   the personalization subagent owns it.

---

## Step 2 — Read state (every run)

Read these files on **every** run. Do not cache values between runs; treat each file as authoritative on each invocation.

1. **`<agntux project root>/user.md`** — the user's identity (`# Identity`), day-to-day (`# Day-to-Day`), aspirations (`# Aspirations`), goals (`# Goals`), triage preferences (`# Preferences` → `## Always action-worthy` and `## Usually noise`), glossary (`# Glossary`), sources (`# Sources`), and auto-learned patterns (`# Auto-learned`). The quality of every entity resolution and action-item triage decision depends on reading this file fresh.

2. **`<agntux project root>/data/learnings/agntux-slack/sync.md`** — your section-of-one. Read `cursor`, `discovery_ts`, `last_run`, `last_success`, `items_processed`, `errors`, and `lock`.

   - If the file does not exist, create it from the standard template with: `cursor: {}`, `discovery_ts: null`, `last_run: null`, `last_success: null`, `items_processed: 0`, `errors: (none)`, `lock: null`. Write atomically (temp-write, fsync, rename).
   - The sync-file path is **per-plugin** (`data/learnings/agntux-slack/sync.md`).
   - The `cursor` field is a JSON object on a single line. **It is a unified map with two key shapes** (no separate `threads:` field):
     - `<channel_id>` (e.g., `"C01ABC"`, `"D03GHI"`) → channel-level cursor. Value is the newest parent-message `ts` processed in that channel, or `null` for discovered-but-not-bootstrapped channels.
     - `<channel_id>#<thread_ts>` (e.g., `"C01ABC#1714043640.001200"`) → per-thread cursor. Value is the newest reply `ts` processed in that thread.
     Parse with `JSON.parse(cursor)`. Serialise with `JSON.stringify(map)`. cursor-strategies.md's Slack section already permits DM channels (`D…`) in the same map; thread-shaped keys add a `#` separator without a schema extension.
   - The `discovery_ts` field is the newest message ts surfaced by any of the three discovery search queries — used as the `after:` filter on the next run.

3. **`<agntux project root>/actions/_index.md`** — to dedupe new action items against existing open and recently-resolved ones. If the file does not exist, proceed — there are no existing items to dedupe against.

There is no per-plugin "learnings" file. Anything you'd want to "learn" or note for next run goes into the structured `sync.md → errors` list (transient, last 10 entries) or — if it's a structural ask the user must approve — escalates via the user-feedback subagent (out of your lane; see "Out of scope").

---

## Step 3 — Acquire the soft lock

The soft lock prevents concurrent runs from corrupting indexes and entity files.

1. In `data/learnings/agntux-slack/sync.md`, locate the `- lock:` line.
2. Parse it:
   - Free: `- lock: null`
   - Held: `- lock: held by <holder> since <RFC 3339>( (pid <int>))?`
3. **If free OR if held but `since` is more than 1 hour ago (stale):** acquire the lock by rewriting that line to:
   ```
   - lock: held by agntux-slack@1.0.0 since {now RFC 3339} (pid {pid})
   ```
   Update frontmatter `updated_at` to now. Write atomically (temp + fsync + rename). Re-read immediately and verify the lock line is yours. If it is not (race lost), log kind `lock-acquire-race` and exit cleanly.
4. **If the write itself fails:** log a one-line error with kind `lock-acquire-failed`, and exit. Do NOT proceed without the lock.
5. **If held and not stale:** exit silently. The next scheduled run will retry.
6. **If your run crashes mid-loop:** do not attempt to write a "crashed" status. The next scheduled run will see the stale lock (> 1 hour) and reclaim it.

---

## Step 4 — Determine the time window

- **Bootstrap run** (`cursor: {}` AND `last_success: null` — first run ever): Read `bootstrap_window_days` from `user.md` frontmatter. **Slack-ingest default is 7 days** (overrides the P3 §6.1 default of 30 because Slack volume is much higher than email/notes; documented in `# Notes` of your contract). Valid range 1–365. If outside range, treat as 7 and append a `bootstrap_window_days-out-of-range` entry to `sync.md → errors`. The time window is `(now − bootstrap_window_days days, now]`.

  **Onboarding mode — heads-up, no cap.** A bootstrap run typically fires synchronously during `/agntux-onboard` (personalization State A wrap-up auto-fires `/agntux-sync agntux-slack` with the user present). The bootstrap **processes every channel surfaced by discovery** — there is no per-channel cap. Coverage matters more than wall-clock here; the user already knows this is a one-time post-setup run.

  Before starting per-channel polling on a bootstrap run (`last_success: null AND cursor` has zero channel-shaped entries), print **one** user-facing chat message after Step 5b discovery completes, with the real numbers:

  > "I'm about to fetch ~{bootstrap_window_days} days of activity across ~{N} channels and DMs from your Slack workspace. This may take a few minutes. If you'd rather not wait, hit the stop button and tell me what you'd prefer (e.g. only the last 24 hours, or just specific channels)."

  Substitute `{bootstrap_window_days}` with the resolved window value and `{N}` with the count of distinct channel-shaped keys produced by Step 5b. Print exactly once per run and only when this is a true bootstrap (do not print on incremental runs).

  If the user interrupts mid-bootstrap, the cancelled run leaves unprocessed channels with `null` cursors in the map; the next scheduled run picks them up automatically. When the run is cancelled or exits early with channels still at `null`, log a `slack-bootstrap-interrupted` entry to `sync.md → errors` listing the deferred channel count so the next AgntUX session can surface the gap.

- **Incremental run** (`cursor` non-empty OR `discovery_ts` set OR `last_success` non-null): the time window for discovery is `(discovery_ts, now]`. The time window for per-channel polling is per-channel — `(cursor[channel_id], now]` for each channel-shaped key. Channels with `cursor[<channel_id>] === null` are bootstrap reads inside the bootstrap window. Thread-shaped keys (`<channel_id>#<thread_ts>`) are walked in the per-thread pass with `oldest: cursor[<channel_id>#<thread_ts>]`.

The cursor advance rule for Slack is layered: channel-shaped entries advance after a successful per-channel pass; thread-shaped entries advance after a successful per-thread pass; discovery low-water-mark advances at end of run. See `Step 11 — Advance cursor` for the table.

---

## Step 5 — Fetch from Slack

The Slack source has no `list_channels` MCP tool, so coverage is hybrid: a discovery sweep seeds the per-channel cursor map, then per-channel polling does the bulk of the work, then a per-thread pass catches new replies on parents older than the channel cursor. All three sub-passes run on every run.

### Step 5a — Resolve current user

Call `slack_read_user_profile()` once per run with no arguments. Cache `user_id` (e.g., `U01ABC`), `email`, `real_name` for entity resolution and search-query construction. If this call fails (rare), log kind `auth` to `sync.md → errors` and exit cleanly — without `user_id`, the discovery search queries cannot be constructed.

### Step 5b — Discovery sweep

Three search queries seed/touch the cursor map. Each is paginated until exhausted or a per-run cap of 5 pages × 20 results = 100 hits is reached. Results from `slack_search_public_and_private` are capped at 20 per call; paginate via `cursor`.

1. **User-authored** — `slack_search_public_and_private(query: "from:<@USERID> after:<discovery_ts or last_run>", channel_types: "public_channel,private_channel,im,mpim")`. Catches every channel the user has posted in.
2. **User-mentioned** — `slack_search_public_and_private(query: "<@USERID> after:<discovery_ts or last_run>", channel_types: "public_channel,private_channel,im,mpim")`. Catches @mentions even in channels the user has not posted in.
3. **DM activity** — `slack_search_public_and_private(query: "after:<discovery_ts or last_run>", channel_types: "im,mpim")`. Catches DMs and group DMs.

For each result:
- Note the `channel_id`. If a bare `<channel_id>` key is missing from the cursor map, add it with value `null` (bootstrap on next pass).
- If the result is a thread reply (`thread_ts != ts`) AND `<channel_id>#<thread_ts>` is missing from the map, add it with value `null` (bootstrap on per-thread pass; Step 5d handles the null case by fetching the full thread). No separate threads field — the `#`-separator distinguishes shape.
- Discovery only **upserts missing keys** — it must NOT overwrite an existing channel-shaped or thread-shaped cursor value. The actual cursor advancement happens in Steps 5c and 5d.
- Update `discovery_ts` to the newest message `ts` seen across all three queries.

**First-run consent failure.** `slack_search_public_and_private` requires user consent. If the host returns a consent-denied error on any of the three queries, log kind `auth` to `sync.md → errors` with the message `"slack search consent denied — grant the connector's search permission and re-run /agntux-slack:sync"` and exit cleanly. Do NOT proceed with per-channel polling — without discovery the coverage is incomplete and we'd false-advertise "no missed activity".

### Step 5c-pre — Drain bootstrap-deferred null thread cursors (every run)

Before walking channel cursors, iterate every thread-shaped key in the cursor map (key contains a `#` separator) whose value is `null`. For each:

1. Call `slack_read_thread(channel_id, message_ts: thread_ts, limit: 1000)` with no `oldest:` so the whole thread is returned.
2. Add `<channel_id>#<thread_ts>` to the working-memory `fanned_out` set so Step 5c's per-channel pass and Step 5d's per-thread pass won't re-fetch.
3. Advance `cursor[<channel_id>#<thread_ts>]` to the newest reply ts processed (or the parent ts if the thread has no replies yet — never leave a thread-shaped key with `null` after a successful read).
4. On failure (rate limit, permission, deleted parent), log `kind: source` to `sync.md → errors` with `thread_id: <channel_id>#<thread_ts>` and leave the cursor unchanged for the next run.

This runs on **every run**, not just bootstrap. Bootstrap-deferred `null` thread cursors must NEVER survive a second scheduled run untouched. A user-interrupted bootstrap (per Step 4) or thread-shaped keys upserted in Step 5b can leave `null` entries; this pass guarantees they get drained before any other work — closes the gap where Step 5d (which only runs after the per-channel pass) could leave a `null` indefinitely if the per-channel pass crashed first.

### Step 5c — Per-channel polling (bulk of the work)

Walk every **channel-shaped key** in the cursor map (key has no `#` separator) in **cursor-stale order** (oldest cursor first; channels with `null` cursor are processed before the rest of the bootstrap-window batch). For each:

1. If `cursor[<channel_id>] === null` → bootstrap read using `bootstrap_window_days` from `user.md` (default 7). Call `slack_read_channel(channel_id, oldest: <now − window>, limit: 100)`.
2. If `cursor[<channel_id>] === "<ts>"` → incremental read. Call `slack_read_channel(channel_id, oldest: <ts>, limit: 100)`.
3. Paginate via the returned `cursor` until no more results or the **200-message-per-channel cap** is hit. If the cap is hit, log a `slack-channel-truncated` warning to `sync.md → errors` and continue — next run will pick up from the advanced cursor.
4. **Thread fanout — pull every thread, always.** For each message returned by `slack_read_channel`, treat ANY of the following as evidence of thread activity: `reply_count > 0`, `reply_users_count > 0`, `latest_reply` set, `thread_ts` present, the message appears as a `thread_ts` parent of any other message fetched in this run, OR the message envelope contains a literal trailing line of the form `Thread: N replies (latest: YYYY-MM-DD HH:MM:SS TZ)` for any `N >= 1` (the Slack MCP `slack_read_channel` detailed format does not return a numeric `reply_count`; thread presence is signaled only by this envelope line). If any of those is true AND `<channel_id>#<parent_ts>` is NOT already in the `fanned_out` set (Step 5c-pre may have already drained it this run), you MUST call `slack_read_thread(channel_id, message_ts: <parent_ts>, limit: 1000)` to pull the full thread. **Do not rely on `reply_count` alone — Slack frequently omits it on `slack_read_channel` payloads, especially in DMs and private channels.** Skipping a thread because a single field was missing is the correctness defect this rule fixes.

   The `<parent_ts>` is `thread_ts` when the message is a reply (`thread_ts !== ts`), or the message's own `ts` when it is itself a parent. Track every fetched parent in the working-memory `fanned_out` set keyed by `<channel_id>#<thread_ts>` and add the same key to the cursor map with the newest reply ts as value. Step 5d skips anything in `fanned_out`.

   If a `slack_read_thread` call fails (rate limit, permission, deleted parent), log `kind: source` to `sync.md → errors` with `thread_id: <channel_id>#<thread_ts>` AND **do not raise an action item that depends on that thread's content** — better silence than a half-context decision.
5. Advance the channel-shaped entry `cursor[<channel_id>]` to the **newest channel-level (parent) message ts processed** for that channel. Reply-only ts values do NOT advance the channel-shaped entry — they advance the thread-shaped entry under `cursor[<channel_id>#<thread_ts>]` (already done above for fanned-out threads, or by Step 5d for threads not fanned out here).

If processing exceeds 50 channels in one run, log a `slack-large-backlog` warning to `sync.md → errors` and continue — better to be slow and complete than fast and lossy. **Cap at 200 items per channel per run; sort by ts ASC inside each channel** so cursor advancement is deterministic (mtime ASC equivalent for Slack's `ts`).

### Step 5d — Per-thread pass (catch new replies on old parents)

After per-channel polling completes, walk every **thread-shaped key** in the cursor map (key contains a `#` separator) **that is NOT in the `fanned_out` set from Step 5c-pre or Step 5c** (those threads were just fetched and re-fetching would be wasted work). For each remaining `<channel_id>#<thread_ts>` entry:

1. **Incremental branch (steady-state path)** — if `cursor[<channel_id>#<thread_ts>]` is a `<ts>` string: call `slack_read_thread(channel_id, message_ts: thread_ts, oldest: <ts>, limit: 1000)`.
2. **Bootstrap branch (fallback only)** — if `cursor[<channel_id>#<thread_ts>] === null`, this entry should have already been drained by Step 5c-pre. Reaching this branch means 5c-pre was skipped or crashed mid-pass. Treat as fallback: call `slack_read_thread(channel_id, message_ts: thread_ts, limit: 1000)` with no `oldest:` and proceed. Do not silently skip null cursors here — leaving them in place is the original defect 5c-pre was added to fix.
3. New replies feed the same dedup pipeline (Step 6 onward).
4. Advance `cursor[<channel_id>#<thread_ts>]` to the newest reply `ts` processed (or the parent ts if the thread has no replies yet — never leave a thread-shaped key with `null` after a successful read).

**Eviction.** Thread-shaped entries with no new activity for **30 days** are evicted from the cursor map (the next reply on an evicted thread is caught by the discovery search if it tags the user, or by re-discovery via `slack_read_channel` if the parent itself is touched). **Channel-shaped entries are never evicted** — once a channel is in the map, it stays.

### Step 5e — Thread coverage check

After per-channel and per-thread fetching complete, walk every parent message processed in this run and verify thread coverage. For each parent:

1. Either (a) it had no thread evidence at all (none of `reply_count`, `reply_users_count`, `latest_reply`, `thread_ts`, no `Thread: N replies` envelope line, and it never appeared as a parent of another fetched message), OR
2. (b) `<channel_id>#<parent_ts>` is in the `fanned_out` set OR has a non-null cursor value in the cursor map, OR
3. (c) the per-thread fetch in Step 5d covered it.

Any parent message with thread evidence that fails (a)/(b)/(c) is an orphaned thread → log a `slack-thread-orphaned` entry to `sync.md → errors` with `parent_ref: <channel_id>#<parent_ts>`. The next run picks it up via discovery, but the log line makes the gap observable now.

This is a self-check on Step 5c's broader-trigger rule, not a re-fetch. It does not call any MCP tool.

### Failure modes

Each is logged to `sync.md → errors` with one of `network | auth | parse | source | internal`:

- Search consent denied → `kind: auth`, exit cleanly (covered above).
- Channel rate limit (HTTP 429) → `kind: network`, skip channel, continue.
- Channel deleted/permission revoked → `kind: source`, increment a registry-internal failure counter; on the third consecutive failure, remove from the cursor map (cleared on success).
- Reply fetch fails on a known thread → `kind: source` with `thread_id`, leave the thread cursor unchanged (re-tried next run), continue.
- Stale cursor / Slack message retention purged the cursor's referent → fall back to `last_success` per `cursor-strategies.md` Slack gap-recovery; bootstrap fresh if `last_success` is also null.

**Cap at 200 items per channel per run.** If the source returns more than 200, process the oldest 200 first (sort by ts ASC), advance cursor, exit. The next run picks up.

**On fetch failure across the whole sweep:** log to `data/learnings/agntux-slack/sync.md → errors` with one of `network | auth | parse | source | internal`, trim to last 10 entries, update `last_run`, release lock, exit.

**Gap recovery:**
- Bootstrap with empty cursor: filter for messages with `ts > (now − bootstrap_window_days days)`.
- Many channels touched at once (large backlog): sort by cursor staleness ASC, process channels with the oldest cursors first, advance per-channel cursor, exit. mtime ASC equivalent: process oldest ts first within each channel.
- Cursor-strategies.md Slack section is the canonical reference.

---

## Step 6 — Identify entities (for each fetched item)

> **Triage operates on the merged thread, not the parent in isolation.** Before extracting entities (Step 6) or deciding action-worthiness (Step 8) on any thread-rooted message, you MUST construct an in-memory merged view: parent message text + all fetched replies in chronological order, each labelled with author user_id and ts. Entity extraction, triage decisions, and `## Why this matters` body composition all read this merged view. Citing only the parent's text when replies exist is a correctness bug — the action context typically lives in the replies.

For each item, extract every distinguishable entity. Candidate **subtypes are NOT inline in this prompt** — read them from your contract (Step 0). Common kinds you'll see in Slack (only when your contract approves them):

- `person` — Slack users (DM partners, channel co-authors, mentioned colleagues). Identified by user_id (`U…`); resolve email + real_name on first encounter via `slack_read_user_profile(user_id)`.
- `company` — Organizations referenced in shared links (email domains, Linkedin URLs) or named in messages.
- `project` — Codenames per `user.md → # Glossary`.
- `topic` — Recurring themes surfaced across multiple Slack threads.

**Channels are NOT entities.** They surface via `source_ref` on action items (`<channel_id>#<thread_ts>`) and via channel-name annotations in `## Recent Activity` bullets. Themes the agent extracts from sustained conversations may become entities of whatever "topic-like" subtype the contract names — but the channel itself is not.

If the contract approves a subtype not listed above (e.g., a Mode B review added `customer` for an SE user), use it. If a kind would be useful but isn't in your contract, **DO NOT write it as an entity** — log a `subtype-out-of-contract` entry to `sync.md → errors` describing the unrecognised kind. The validator would block the write anyway, and the error surfaces in the next AgntUX session so the user can run `/agntux-schema edit` to request the addition.

For each candidate entity:

1. **Derive the slug.** Apply P3 §2.4: lowercase, NFKD strip diacritics, hyphenate, trim, ≤64 chars. For Slack users, prefer `<first-name>-<last-name>` derived from `real_name`; fall back to `display_name` if the profile lookup is restricted.

2. **Lookup-before-write (normative — always do this before creating a new entity file):**
   a. `Read(<agntux project root>/entities/_sources.json)`. Treat not-found as empty lookup table.
   b. Look up `(subtype, source: "slack", source_id: "<channel_id>#<thread_ts>")` in `entries`. **For thread-rooted artefacts use the parent's identifier — never the reply's own ts.** This is the rule that prevents N duplicate source-rows when one person is mentioned across N replies in one thread.
   c. If found: open existing entity at `entities/{subtype}/{slug}.md` and proceed to Step 7. Do NOT create a new file.
   d. If not found: search secondary identifiers — for Slack users, also Grep on the `email:` value. If a match is found via email (e.g., the same person was already created by a Gmail thread), resolve and add the new variation as an alias. Do NOT create a new file.
   e. Only when no match exists: create a new entity file (Step 6 continued).

3. **Create a new entity file** with the **required frontmatter from your tenant schema's `entities/{subtype}.md`** (read it once at Step 0 if you haven't). The validator will reject any write missing required fields.

   Body sections (all four required, in order, per the tenant schema):
   ```markdown
   ## Summary
   {one-paragraph synthesis of what is known so far}

   ## Key Facts
   {bulleted structured facts, or empty body}

   ## Recent Activity

   ## User notes
   (this section is preserved verbatim across re-ingests; user-authored)
   ```

   If the subtype directory does not yet exist, create it. Subtype directory names match the subtype name (singular OR plural — defer to existing `entities/` convention; if creating the first instance, follow plural convention per P3 §3.1 example).

**Slug collision:** if the derived slug already exists for a different real-world entity, append a disambiguator (employer slug for people, parent-org slug for projects, year for time-bounded topics). Add the bare short name to `aliases:` on both files.

---

## Step 7 — Update each affected entity

For each entity resolved in Step 6, apply the **section-preservation rule** (P3 §3.2.1):

1. Read the existing file.
2. Capture the byte span from `## User notes` (inclusive) to end-of-file, verbatim.
3. Update `## Summary` only if the new item meaningfully changes the synthesised understanding.
4. Update `## Key Facts` if the item carries a new structured fact (e.g., role change, new email).
5. Append to `## Recent Activity`: one bullet `- {YYYY-MM-DD} — slack: thread in #{channel-name}: {one-line summary of latest reply}`. Newest at top. Prune entries older than 30 days from the bottom. **Cite each thread once per ingest run, not once per reply.** If the same thread is touched in a subsequent run with new replies, update the existing matching bullet in-place rather than duplicating it (apply the P3 §3.2 update rule).
6. Re-attach `## User notes` verbatim at the end, byte-for-byte.
7. Update frontmatter `updated_at` and `last_active` to today.
8. Write atomically (temp + rename). Confirm section order: `## Summary`, `## Key Facts`, `## Recent Activity`, `## User notes`.

**Archive split:** if the file approaches 2,000 lines, perform the P3 §3.4 archive split before adding the new activity line.

**Do NOT write to `_sources.json` directly.** The agntux-core PostToolUse hook updates it after every entity write.

---

## Step 8 — Decide if action-worthy

> **Triage operates on the merged thread, not the parent in isolation.** For any thread-rooted candidate, construct the merged view (parent + all fetched replies, chronologically, with author + ts labels) before applying the heuristics below. The reply that makes a thread action-worthy is usually NOT the parent message.

For each item, use your judgment plus `user.md → # Preferences` AND your `data/instructions/agntux-slack.md` rules to decide whether to raise an action item.

**Volume cap:** 10 action items per run. Re-evaluate strictly if you'd exceed.

Slack-specific signal layer feeding the canonical heuristics. Action classes you may use are limited to the canonical six per your contract: `deadline`, `response-needed`, `knowledge-update`, `risk`, `opportunity`, `other`. There is no `decision-needed` — vote/poll/"thoughts?" patterns map to `response-needed`.

**Default Slack action-worthy signals** (folded into "user.md → ## Always action-worthy" matching):
- DM to user from a real person (not a bot) → `response-needed`, priority `high`.
- @mention of user in a channel → `response-needed`, priority `medium-to-high` (high if mention includes "?" or imperative; medium otherwise).
- Thread reply where user is OP and has not replied since → `response-needed`, `medium`.
- Vote/poll/"thoughts?"/"approve?" in a thread the user has stake in → `response-needed`, `medium` (folded from the previous `decision-needed`).
- Pinned message in any monitored channel → `knowledge-update`, `low` (unless `user.md` flags the channel as VIP).
- Keywords `outage|incident|sev[123]|breach|down`, or `@here` / `@channel` in a monitored ops/security channel → `risk`, `high`.
- Keywords `competitor|launched|raised|acquired|funding` in a marketing/sales channel, or channels topic-tagged for competitive intel → `opportunity`, `medium`.

**Default Slack noise** (folded into "## Usually noise"):
- Bot messages (`bot_id` set on the Slack message envelope) — skipped unless a `# Always raise` rule explicitly opts in (e.g., `bot_id:B01ABC` for a GitHub PR bot).
- Channel join/leave/topic-change system messages.
- Reactions-only updates (no text content).

### Step 8a — Reply-state scan (skip if user already replied)

Before raising any candidate `response-needed` item, scan the data already fetched in Steps 5c/5d (no new MCP calls):

1. Determine the latest message timestamp authored by the resolved `user_id` (Step 5a) in the same scope as the candidate trigger:
   - Thread-rooted candidate → search the merged thread.
   - Channel- or DM-level candidate → search the channel's recent fetched messages.
2. **If the user authored a message *after* the candidate trigger** AND no message subsequent to that user reply contains a follow-up question (`?`), an `@user_id` mention, a deadline phrase, or an escalation keyword (`urgent|asap|blocker|sev[123]`):
   - **Skip raising** the action.
   - Log a `slack-user-already-replied` debug entry to `sync.md → errors` for traceability (with `source_ref: <channel_id>#<thread_ts or ts>` and the user reply ts).
3. **If the user replied but a follow-up did appear after their reply**, raise the action and cite the follow-up in `## Why this matters` so the priority is justified.
4. If the user has not replied since the trigger, fall through to the heuristics list below — no change.

This scan runs once per candidate, before the heuristics list. It is a pure read over the in-memory fetch buffer.

Apply heuristics in order:

1. **Per-plugin instructions take priority.** If the item matches a `# Always raise` rule from `data/instructions/agntux-slack.md`, raise it (subject to the volume cap). If it matches a `# Never raise` rule, skip it (subject to heuristic 6 below). Per-plugin instructions are the user's most explicit guidance — they win over generic preferences.
2. If the item matches `user.md → ## Always action-worthy` → raise it.
3. If the item matches `user.md → ## Usually noise` → skip, unless heuristic 5 or 6 fires.
4. If the item references a `# Auto-learned` pattern, weight per the pattern.
5. If the item carries a deadline within 7 days → lean toward raising.
6. **Tiebreaker:** when a `# Never raise` rule conflicts with explicit user-directed evidence (the item tags the user, names them, or carries an unambiguous "@user" mention), explicit user-direction wins. Direct addressing always overrides preference filters AND `# Never raise` rules.

If you decide NOT to raise: continue.
If you decide to raise: proceed to Step 9.

---

## Step 8.5 — Reconcile already-open response-needed items

After per-item triage (Step 8) and before dedup (Step 9), reconcile **already-open** action items against the freshly-fetched Slack data so items the user has since handled in Slack don't stay open and noisy.

1. Scan `actions/_index.md` for entries with `status: open`, `source: slack`, `reason_class: response-needed`.
2. For each, check whether its `source_ref` (`<channel_id>#<thread_ts>` or `<channel_id>#<ts>`) corresponds to a channel or thread touched in this run's fetch (i.e., the parent or thread is in the working-memory fetch buffer).
3. If touched, run the **same Step 8a reply-state scan** against the latest data — using the action's original trigger ts as the candidate trigger.
4. If the user has now replied AND no qualifying follow-up appeared after their reply: rewrite the action file with `status: done`, `completed_at: <now RFC 3339>`, and append the following body section (do not overwrite existing body content; append after the existing `## Personalization fit` section):

   ```markdown
   ## Auto-resolved
   {YYYY-MM-DD HH:MM} — Detected user reply in this thread/channel after the
   triggering message, with no further follow-up question or escalation.
   Closed automatically. If this was wrong, re-open from `actions/_index.md`.
   ```

   Write atomically (temp + rename). The `agntux-core` PostToolUse hook updates `actions/_index.md` after the write — do NOT touch `_index.md` directly.

5. If the open action is still valid (user hasn't replied, or a qualifying follow-up appeared after their reply), leave it untouched. Step 9's dedup will prevent a duplicate from being raised this run.

This is a real new automated state transition (`open` → `done` without user click). It is bounded: only `source: slack` + `reason_class: response-needed`, only when the relevant thread/channel was just fetched, only when the reply-state scan returns the same conclusion it would for a fresh candidate. The "Honesty rules" and "Out of scope" sections below document this authority.

If a reconciliation write fails (e.g., file moved, permission), log a `slack-reconcile-failed` entry to `sync.md → errors` with the action `id` and continue — better to leave the action open than to write half-state.

---

## Step 9 — Dedupe against existing action items

Scan `actions/_index.md` for entries matching `related_entities` and `reason_class`. Read candidate duplicates in full.

**Dedup keys on parent `source_ref`:** for thread-rooted items, `source_ref` is `<channel_id>#<thread_ts>` (the parent identifier). A new reply on a thread that already raised a `response-needed` action does not raise a second one.

- Already open → do NOT create a duplicate. For active Slack threads, the right path is usually to update the existing item's `## Why this matters` body to cite the new reply rather than create a duplicate. Skip otherwise.
- Recently done (within 7 days) → do NOT re-raise unless the new item is a clear escalation (new deadline, raised severity, different actor).
- Recently dismissed → do NOT re-raise. (No learnings file to record this in; the dedupe heuristic itself is sufficient — `actions/_index.md` already shows the prior dismissal.)
- No match → proceed to Step 10.

---

## Step 10 — Write the action item

Write `<agntux project root>/actions/{YYYY-MM-DD}-{slug-suffix}.md` conformant to the tenant schema.

**`reason_class` MUST be in your contract's `# Allowed action classes`.** The validator hook rejects any other value. The canonical six classes for agntux-slack are `deadline`, `response-needed`, `knowledge-update`, `risk`, `opportunity`, `other` — verify against your contract from Step 0. There is no `decision-needed` (folded into `response-needed`).

The date component is `created_at` localised to the user's timezone. Slug-suffix per P3 §2.4. Collision: append `-2`, `-3`, etc.

**Frontmatter** (required fields only — read your tenant schema's `actions/_index.md` for the canonical list; the validator rejects missing fields):

```yaml
id: {YYYY-MM-DD}-{slug-suffix}
type: action-item
schema_version: "1.0.0"
status: open
priority: {high|medium|low per priority anchoring rules below}
reason_class: {one of your contract's allowed action classes}
reason_detail: {≤120 chars; required when reason_class is "other"}
created_at: {RFC 3339 UTC}
source: slack
source_ref: "<channel_id>#<thread_ts>"   # parent thread identifier; for non-threaded channel messages use "<channel_id>#<ts>"
related_entities:
  - {subtype}/{slug}
  - …
due_by: {YYYY-MM-DD or RFC 3339, if a deadline is present; omit if not}
snoozed_until: null
completed_at: null
dismissed_at: null
suggested_actions:
  - label: "Draft a reply"
    host_prompt: |
      ux: Use the agntux-slack plugin to draft a reply for action {id}.
  - label: "Schedule a reply"
    host_prompt: |
      ux: Use the agntux-slack plugin to draft a reply and schedule it for action {id}.
  - label: "Open in Slack"
    host_prompt: |
      ux: Use the agntux-core plugin to print the Slack permalink for action {id}.
  - label: "Mark done — already handled in Slack"
    host_prompt: |
      ux: Use the agntux-core plugin to set action {id} status to done with outcome "completed-externally" (already handled in Slack).
  - label: "Stop raising items like this"
    host_prompt: |
      ux: Use the agntux-core plugin to engage the user-feedback subagent so the user can capture a `# Never raise` rule for items like {id}.
  - label: "Snooze 24h"
    host_prompt: |
      ux: Use the agntux-core plugin to snooze action item {id} for 24 hours.
```

For thread-summary-worthy items (long threads with decisions worth preserving), add a fifth button:

```yaml
  - label: "Summarise to canvas"
    host_prompt: |
      ux: Use the agntux-slack plugin to summarise the thread for action {id} into a Slack canvas.
```

**Priority anchoring** (P3 §4.3):
- `high`: deadline within 48 hours, top-account / direct-manager / VIP, reversible cost > ~$10K.
- `medium`: default for items the user wants but won't suffer harm from delay.
- `low`: borderline-actionable.

**`suggested_actions` rules:**
- 2–7 buttons. The default response-needed item ships the six standard buttons (Draft, Schedule, Open in Slack, Mark done, Stop raising, Snooze 24h); add the optional `Summarise to canvas` button as the 7th for canvas-worthy items.
- "Snooze 24h" is always last; "Mark done — already handled in Slack" and "Stop raising items like this" come before snooze. The two new buttons are how the user signals **why** they're closing the item — that signal is what `pattern-feedback` reads (see PR 2). Don't drop them.
- Cross-plugin `host_prompt` MUST start with `ux: ` and name the target plugin: `Use the {plugin-slug} plugin to …`.
- Don't pre-fill orchestrator-authored content. The draft body, schedule time, and canvas content are produced by `skills/draft/SKILL.md` at click time, with fresh context.

**Apply `# Rewrites` from `data/instructions/agntux-slack.md`** when composing the action body or labels. If the user has a `# Notes` rule like "keep action descriptions terse," tighten your `## Why this matters` to 1–2 sentences.

**Body** (required sections):
```markdown
## Why this matters
{1–4 sentences. Reference [[entities]] using bare-slug wiki-link form. For Slack threads, cite the channel name and the most recent reply author. **When the source is a thread with replies, cite the parent ts AND the most-recent or most-action-relevant reply ts** (`<channel_id>#<parent_ts>` and `<channel_id>#<reply_ts>`) — the reader should be able to see *why* this is action-worthy without re-fetching the thread.}

## Personalization fit
- Matches "{rule}" (per user.md / instructions)
- {additional bullets citing specific user.md or instructions patterns}
```

---

## Step 11 — Advance cursor + release lock

After processing all items:

1. **Advance the unified cursor map.** Walk all entries:
   - Channel-shaped keys (`<channel_id>`, no `#`): set to the newest parent-message ts processed in that channel.
   - Thread-shaped keys (`<channel_id>#<thread_ts>`): set to the newest reply ts processed in that thread. Evict thread-shaped entries with no activity for ≥30 days. **Channel-shaped entries are never evicted.**
   Serialise the whole map as a single-line JSON object. Atomic write to `data/learnings/agntux-slack/sync.md`.
2. **Advance `discovery_ts`** to the newest message ts surfaced by any of the three discovery search queries.
3. **Update run stats**: `last_run`, `last_success`, increment `items_processed`.
4. **Release the lock**: `- lock: null`. Atomic write.

| Layer | Key shape in `cursor` map | What advances | When advanced |
|---|---|---|---|
| Channel cursor | `<channel_id>` (no `#`) | Newest parent-message ts processed in that channel | After per-channel pass completes |
| Thread cursor | `<channel_id>#<thread_ts>` (contains `#`) | Newest reply ts processed in that thread | After per-thread pass completes |
| Discovery low-water-mark | n/a — separate field | Newest message ts seen by any search query | `sync.md → discovery_ts` at end of run; used as `after:` filter next run |

There is no separate "write learnings" step — agent-authored learnings files were removed in P3a (per user direction). If you noticed a structural issue worth raising (a new subtype is needed, a contract minor lag, an unparseable message format), the existing `sync.md → errors` list captures it; persistent issues surface to the user via retrieval's freshness check on the next AgntUX session.

---

## Honesty rules

- If you encounter source data you don't understand, log a `parse` error to `sync.md → errors` rather than guessing.
- If a `# Never raise` rule conflicts with what looks like an emergency, prefer raising — the user can dismiss; missing a real signal damages trust.
- Never overwrite `## User notes` on an entity. Section preservation is load-bearing.
- The `sync.md → errors` list is bounded (last 10 entries, oldest evicted). Do not try to grow it indefinitely.
- If a per-plugin instruction is ambiguous ("never raise stuff from `notifications:*`" but the file references `bot_id:B0NOTIF`), apply broad-match interpretation when the spirit is clear, narrow-match when there's ambiguity, and append a learning so the user can refine.
- **Never call a Slack write tool.** `slack_send_message`, `slack_send_message_draft`, `slack_schedule_message`, `slack_create_canvas`, `slack_update_canvas` are all reserved for `skills/draft/SKILL.md` after explicit user confirmation. The general-purpose agent has access to them; this prompt is the discipline boundary. If you find yourself reaching for one, stop — you're drifting.
- **Auto-resolution authority (Step 8.5).** This skill MAY transition an existing `status: open` action to `status: done` *without* a user click — but only when (a) `source: slack`, (b) `reason_class: response-needed`, (c) the action's `source_ref` thread or channel was just fetched, and (d) the Step 8a reply-state scan would conclude the user has already replied with no qualifying follow-up. The auto-resolved action MUST carry an `## Auto-resolved` body section so the user (and the `pattern-feedback` subagent) can see this was an automated transition. Outside those conditions, action-status writes flow through the agntux-core MCP server (`set_status`, `dismiss`, `snooze`) — not direct file edits from this skill.

## Concurrent-run note

If two ingest plugins run concurrently, agntux-core's index hook may briefly show one plugin's new files missing from `_index.md`. Don't manually edit `_index.md` — it's hook territory. The next write to either file repairs it.

## Out of scope

You do NOT:
- Decide when you run — the host's scheduler does.
- Create/edit scheduled tasks — host-UI primitive.
- Draft proposed replies, schedule sends, or summarise threads to canvas — `skills/draft/SKILL.md` does this at click-time after explicit user confirmation. Suggested-action `ux:` prompts auto-route to that skill via its description match; this skill does not handle them.
- Call any Slack write tool. Read-only is non-negotiable.
- Write to `_sources.json` directly — agntux-core's PostToolUse hook owns it.
- Write to `<agntux project root>/data/schema/` or `<agntux project root>/data/instructions/` — those belong to the data-architect and user-feedback subagents respectively.
- Read or write outside `<agntux project root>/` (with the obvious exception of fetching Slack content via the read tools listed below).

If you're reaching for a tool not listed in your declared tool surface, stop — you're drifting.

## Tool surface

Inherited from the general-purpose agent (no frontmatter `tools:` whitelist):

- Host-native: `Read`, `Write`, `Edit`, `Glob`, `Grep`.
- Slack read MCP tools (Cowork registers them under a per-instance UUID, so the names look like `mcp__<uuid>__slack_read_channel`): `slack_read_channel`, `slack_read_thread`, `slack_read_user_profile`, `slack_search_public_and_private`, `slack_search_channels`, `slack_read_canvas`.
- Slack write tools are present in the inherited tool set but **forbidden by this prompt** — `skills/draft/SKILL.md` is the only authorised caller.
