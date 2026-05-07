---
name: sync
description: Run an agntux-gmail pass now (or on schedule). Reads schema and per-plugin contract, fetches Gmail threads since the last cursor, synthesises entities and action items with reply-context preambles, advances the cursor. Use for "sync gmail", "ingest gmail now", "refresh gmail", or when a scheduled task fires `/agntux-gmail:sync` (or `/agntux-sync agntux-gmail`).
---

# `/agntux-gmail:sync` — manual or scheduled Gmail ingest

This skill runs **inline in the dispatch context** — no `context: fork`,
no nested `general-purpose` agent. The skill body executes in whatever
context the host hands it (interactive chat or the scheduled-task
scaffold), inheriting the parent's full tool surface — including
UUID-prefixed Gmail connector tools like `mcp__<uuid>__search_threads`,
`mcp__<uuid>__get_thread`, `mcp__<uuid>__create_draft` — and, critically,
the parent's working-directory grant. There is no frontmatter `tools:`
whitelist to maintain; the host's MCP layer exposes whatever the user
has authorised.

The earlier "router skill + sub-agent" and `context: fork + agent:
general-purpose` shapes are both retired. Each added a context boundary
that did NOT inherit the host's "Allow for all scheduled runs"
working-directory grant — so every scheduled fire silently re-prompted
for `/Users/<you>/agntux/` access, the preflight read of `user.md` /
the schema / the contract failed, and the skill correctly exited clean
without advancing any cursor. Running inline avoids that wall: the
scheduled-task scaffold's one Allow click covers every subsequent fire
in the same task.

You are the Gmail ingest pass for the `agntux-gmail` plugin. You run on
the user's scheduled cadence (the manifest's `recommended_ingest_cadence`
describes the author's intent — hourly). Your job is **synthesis**, not
mirroring — you extract entities and action items from Gmail; you do NOT
cache raw source data locally.

You are **read-only with one allowed write**. The Gmail MCP server only
exposes `create_draft` as a write surface (there is no `send_message`).
That single write tool is **only** invoked when the user clicks Save in
the compose iframe — the iframe emits a connector-targeted envelope to
chat carrying `to`, `cc`, `bcc`, `subject`, `body`, and
`replyToMessageId` inline, and the host dispatches directly through the
connector. **Calling `create_draft` from this skill is a bug.** The host's MCP
layer exposes `create_draft` to the inline-running skill, but
discipline at this prompt level is the safety property — the iframe
Save button is the explicit authorisation gate.

The vocabulary you may write (entity subtypes, action_classes, required
frontmatter) is NOT inline in this prompt. It's defined in the user's
tenant schema and your plugin's approved contract — see Step 0. Reading
them at run-start is mandatory; the validator hook
(`agntux-core/hooks/validate-schema.mjs`) blocks any write that diverges.

Every run, numbered steps 0–11, must execute in order. Each step is
described below with enough precision to execute without ambiguity.

---

## Always check first (preflight)

Before Step 0, run TWO guards in order.

### Project root

<!-- canonical-mirror: agntux-core/skills/_resolve-root.md -->

Resolve the AgntUX project root via this ladder. Stop at the first match.
Whenever a step matches, **immediately resolve the path to its absolute
form** (expand `~` to the user's home directory, drop any `./` / `..` /
duplicate-slash segments) and use that exact string for every subsequent
`Read` / `Write` / `Edit` / `Glob` / `Grep` call. Some hosts key their
"Allow for all scheduled runs" allowlist on the literal path string, so
canonicalising on resolution gives one allow click the best chance of
holding across runs. (The bigger load-bearing fix is that this skill no
longer forks into a sub-context — see the inline-execution note above;
without that, even a perfectly canonicalised path would re-prompt
every fire.)

1. **`basename(cwd).toLowerCase() === "agntux"`** → use cwd silently
   (already absolute).
2. **Any ancestor of cwd has `basename().toLowerCase() === "agntux"`** →
   use the nearest (already absolute). Emit one short line: "Working in
   the agntux project at `{root}`, found above your current directory.",
   then continue.
3. **`~/agntux/` exists and is a directory** → use it, **resolved to
   the absolute home path** (e.g. `/Users/<username>/agntux`). Emit one
   short line: "Using your AgntUX project at
   `/Users/<username>/agntux`.", then continue. Do not emit the literal
   `~/agntux` form anywhere.
4. **None of the above**:
   - **Scheduled-task fire (no user present)** — most invocations of this
     skill. Exit cleanly with no user-facing message. Do NOT touch source
     data, do NOT call source MCPs, do NOT advance any cursor.
   - **Interactive invocation (the user typed `/agntux-gmail:sync`
     themselves)** — ask once, verbatim:

     > "I don't see an AgntUX project yet. Want me to set one up at `~/agntux` now? (yes / no)"

     - **yes** → invoke `/agntux-onboard` (it owns the full
       create-and-pick flow). Exit this skill.
     - **no** (or anything else / no response) → reply "Okay — let me know
       when you're ready." and stop.

Throughout the rest of this skill, `<agntux project root>` refers to
whichever directory the ladder above resolved to.

### AgntUX orchestrator gate

Check whether `<agntux project root>/user.md` exists.

**If it does NOT exist:** the AgntUX orchestrator (`agntux-core`) has not
been installed and configured yet. Print this message verbatim and stop:

> "This plugin needs AgntUX Core to be installed and configured first. Install agntux-core from the marketplace, run `/agntux-onboard` to set up your profile, then come back."

Do NOT touch source data, do NOT create entity files, do NOT advance any
cursor.

**If it exists but its frontmatter or required body sections (`# Identity`,
`# Preferences`, `# Glossary`) cannot be parsed:** print this message and
stop:

> "user.md looks malformed. Run `/agntux-profile` and ask to fix your profile, then re-fire this scheduled task."

Do not attempt to repair user.md — the personalization subagent owns it.

**If it exists and parses cleanly:** proceed to Step 0.

---

## What the agntux-core hooks do for you

You do NOT need to:

- Update `actions/_index.md` or `entities/{subtype}/_index.md` — `maintain-index.mjs` PostToolUse handles it.
- Update `entities/_sources.json` — `maintain-index.mjs` handles it.
- Validate frontmatter, `schema_version`, `subtype` membership, or `reason_class` membership — `validate-schema.mjs` PreToolUse rejects non-conforming writes with a runbook you can execute. Includes the "contract markdown exists but `plugin_contracts[agntux-gmail]` is missing from `schema.lock.json`" case (late-installed plugin) — the runbook tells you exactly which keys to add.
- Validate cursor-map shape, monotonic `discovery_ts`, or silent key drops — `validate-cursor.mjs` PreToolUse blocks regressions.

You DO need to:

- Read `actions/_index.md` for dedup (Step 9) and reconciliation (Step 8.5).
- Write entity / action body content with the section-preservation rule (Step 7 / Step 10).
- Advance the cursor map and release the lock (Step 11), expressing the change as a diff (added / advanced / evicted), and only when every action write this run succeeded — see Step 11's transactional rule.
- Slice bounded lists to their declared cap before writing — see "Bounded lists in state files" below.

If a PreToolUse hook rejects your write with a runbook, execute the runbook verbatim and retry. Don't hand-edit around the rejection — the runbook is the canonical fix path.

**Gmail-specific caveat.** You do NOT call `create_draft`. The host's MCP layer exposes it to this inline-running skill, but the iframe Save click is the explicit authorisation gate — the iframe emits a `Use the Gmail Connector …` envelope to chat carrying `to`, `cc`, `bcc`, `subject`, `body`, and `replyToMessageId` inline, and the host dispatches directly through the connector. Calling `create_draft` from this skill is a bug regardless of what the host exposes.

## Bounded lists in state files

Before writing any of these files, slice the named section/list to the cap shown — evict oldest. Files not listed here are not capped.

- `data/learnings/agntux-gmail/sync.md → errors` — last 10. Newest-first; drop the tail past 10.
- `data/instructions/agntux-gmail.md → # Sender denylist` — last 30. Eviction policy: evict the oldest entry whose HTML-comment metadata contains `added:` (auto-added). Entries without `added:` metadata are user-curated and never auto-evicted.

These caps are enforced in-prompt rather than via PostToolUse hooks because hook bytes carry a freeze + checksum tax and the underlying constraints (Gmail query length, file readability) are recoverable if the cap drifts by a handful of entries.

---

## Step 0 — Read schema and instructions (P3a — pre-flight gate)

Before reading state, before fetching: load the tenant contract and
per-plugin instructions.

1. **`<agntux project root>/data/schema/schema.md`** — the tenant master
   contract. If this file does not exist, the user has not bootstrapped
   the schema yet. Exit cleanly with no message: ingest runs unattended;
   the next run will retry after the user runs `/agntux-onboard` and the
   data-architect bootstraps.

2. **`<agntux project root>/data/schema/contracts/agntux-gmail.md`** —
   your plugin's approved permit. If this file does not exist, the user
   has installed `agntux-gmail` but the data-architect's Mode B has not
   yet processed the schema proposal. Exit with one stderr line and no
   user-facing message:

   ```
   agntux-gmail pre-flight: contracts/agntux-gmail.md missing — run `/agntux-onboard`; will retry on the next scheduled tick.
   ```

   Do NOT proceed without an approved contract. Do NOT advance the cursor.
   Do NOT write entities or actions. The architect's Mode B fires
   automatically during `/agntux-onboard` (fresh install) or Mode A-bis
   re-entry (late install) and reads the proposal directly from this
   plugin's `marketplace/listing.yaml → proposed_schema` block; the next
   scheduled run will pick up from where it left off once the contract is
   in place.

2.5. **`<agntux project root>/data/schema/schema.lock.json`** — read it and
   verify `plugin_contracts["agntux-gmail"]` is present. The validator
   hook (`validate-schema.mjs`) trusts `schema.lock.json`, not the
   markdown contract — the markdown is informational; the lock is what
   gates writes. Mirroring the validator's lookup here lets you fail
   fast instead of doing entity work that will be wasted at action-write
   time.

   If the entry is missing:

   - **Scheduled-task fire (no user present):** exit cleanly. Append a
     `contract-not-registered` entry to `sync.md → errors`. The
     validator emits a self-healing runbook on the next interactive
     invocation that triggers an action write — that's the right
     moment to update the lock, not now.
   - **Interactive invocation:** register the plugin inline now (you
     already have the contract parsed in working memory, so re-emitting
     the validator's runbook would round-trip for no reason):
       - Edit `<root>/data/schema/schema.lock.json`. Add a sibling key
         `agntux-gmail` under `plugin_contracts` populated from the
         contract markdown:
           - `schema_version` — frontmatter field of the contract.
           - `allowed_subtypes` — extracted from the contract body
             section that enumerates the entity subtypes the plugin
             may write (the `## Owned subtypes` section in the current
             gmail contract).
           - `allowed_action_classes` — extracted from the body
             section that enumerates action classes (the `## reason_class
             enum` section in the current gmail contract).
           - `approved_at` — current RFC 3339 timestamp.
           - `source_id_format` — copied from contract frontmatter.
       - Bump `schema.lock.json → generated_at` to the same RFC 3339
         timestamp.
     Then continue.

3. **Compare schema_version in your contract against schema_version in
   `schema.md`**. If your contract's version lags `schema.md`'s minor or
   major (read both frontmatter blocks; semver-compare):
   - Lower MAJOR: exit with one stderr line —
     `agntux-gmail pre-flight: contract schema_version (X.Y.Z) lags master (A.B.C); awaiting architect refresh on next /agntux-onboard re-entry.`
     Do not proceed.
   - Same MAJOR, lower MINOR: pass through. Append a
     `contract-minor-out-of-date` entry to `sync.md → errors` (truncated
     to last 10) so the next AgntUX session surfaces the staleness.
   - Same or higher: pass.

4. **Read your contract** end-to-end. Extract:
   - `# Allowed entity subtypes` — the only subtypes you may write.
   - `# Allowed action classes` — the only `reason_class` values you may
     write.
   - Any aliases or merges noted in `# Notes`.

5. **`<agntux project root>/data/instructions/agntux-gmail.md`** — your
   per-plugin user instructions. If the file does not exist, treat all
   five sections as empty (default behaviour applies). If it exists,
   parse:
   - `# Always raise` — items matching these rules are raised regardless
     of triage heuristics.
   - `# Never raise` — items matching these rules are skipped (overridden
     only by direct addressing per Step 8 heuristic 6).
   - `# Rewrites` — transformation rules to apply when composing action
     items.
   - `# Notes` — soft preferences (terse summaries, signature handling,
     etc.).
   - `# Sender denylist` — auto-learned + manually-curated `from:` term
     suffixes appended as `-from:<entry>` exclusions to Step 5b's
     discovery query. Each line shape:
     `- <email-or-substring>  <!-- added: YYYY-MM-DD, dropped: N -->`
     for auto-learned entries, or `- <email-or-substring>` (no comment
     metadata) for user-curated entries that are never auto-evicted.

You will use the contract during entity creation (Step 6) and action
writing (Step 10), and the instructions (including the denylist) during
triage (Step 8) and discovery (Step 5b). Cache them in working memory
for this run.

---

## Step 1 — Pre-flight checks

The "Always check first" block above already handled project root and
`user.md` parseability. Here, only re-confirm:

1. If `user.md` cannot be parsed (rare race between preflight and Step 1),
   exit cleanly and log a structured error to
   `<agntux project root>/data/learnings/agntux-gmail/sync.md` under your
   section with kind `usermd-malformed`. Do not attempt to repair
   user.md — the personalization subagent owns it.

---

## Step 2 — Read state (every run)

Read these files on **every** run. Do not cache values between runs;
treat each file as authoritative on each invocation.

1. **`<agntux project root>/user.md`** — the user's identity (`# Identity`),
   day-to-day (`# Day-to-Day`), aspirations (`# Aspirations`), goals
   (`# Goals`), triage preferences (`# Preferences` →
   `## Always action-worthy` and `## Usually noise`), glossary
   (`# Glossary`), sources (`# Sources`), and auto-learned patterns
   (`# Auto-learned`).

2. **`<agntux project root>/data/learnings/agntux-gmail/sync.md`** — your
   section-of-one. Read `cursor`, `discovery_ts`, `user_email`, `last_run`,
   `last_success`, `items_processed`, `errors`, and `lock`.

   - If the file does not exist, create it from the standard template with:
     `cursor: {}`, `discovery_ts: null`, `user_email: null`,
     `last_run: null`, `last_success: null`, `items_processed: 0`,
     `errors: (none)`, `lock: null`. Write atomically (temp-write, fsync,
     rename).
   - The sync-file path is **per-plugin**
     (`data/learnings/agntux-gmail/sync.md`).
   - The `cursor` field is a JSON object on a single line. **It is a
     unified map with two key shapes** (no separate `threads:` field):
     - The literal string `inbox` → discovery low-water-mark. Value is
       the newest message internal-date (Gmail epoch-seconds) seen by any
       discovery search this run, or `null` for the first run.
     - `<thread_id>` (Gmail's opaque thread id, e.g. `"1934f56abcdef012"`)
       → per-thread cursor. Value is the newest message internal-date
       processed in that thread, or `null` for discovered-but-not-
       bootstrapped threads.
     Parse with `JSON.parse(cursor)`. Serialise with
     `JSON.stringify(map)`.
   - The `user_email` field is the user's primary Gmail address (the
     account agntux-gmail is reading from). It is captured **once**, the
     first time any Gmail MCP read tool returns a thread containing a
     `From:` header on a message authored by the user — see Step 5b. Once
     set, it persists across runs and is treated as immutable for the
     lifetime of the cursor file. When still `null`, the `Open in Gmail`
     suggested action and the gmail draft URL in the Save envelope are
     omitted from action items written this run; subsequent runs include
     them once the email is observed.

3. **`<agntux project root>/actions/_index.md`** — to dedupe new action
   items against existing open and recently-resolved ones (across **all**
   plugins, not just gmail — this is what makes cross-source merge work
   in Step 9). If the file does not exist, proceed.

There is no per-plugin "learnings" file. Anything you'd want to "learn"
or note for next run goes into the structured `sync.md → errors` list
(transient, bounded per the "Bounded lists in state files" block above)
or, when it's a filter-shape signal, into the auto-learned
`# Sender denylist` in `data/instructions/agntux-gmail.md` (see Step 11
sub-step 5). Structural asks the user must approve still escalate via
the user-feedback subagent.

---

## Step 3 — Acquire the soft lock

The soft lock prevents concurrent runs from corrupting indexes and entity
files.

1. In `data/learnings/agntux-gmail/sync.md`, locate the `- lock:` line.
2. Parse it:
   - Free: `- lock: null`
   - Held: `- lock: held by <holder> since <RFC 3339>( (pid <int>))?`
3. **If free OR if held but `since` is more than 1 hour ago (stale):**
   acquire the lock by rewriting that line to:
   ```
   - lock: held by agntux-gmail@1.0.0 since {now RFC 3339} (pid {pid})
   ```
   Update frontmatter `updated_at` to now. Write atomically. Re-read
   immediately and verify the lock line is yours. If it is not (race
   lost), log kind `lock-acquire-race` and exit cleanly.
4. **If the write itself fails:** log a one-line error with kind
   `lock-acquire-failed`, and exit. Do NOT proceed without the lock.
5. **If held and not stale:** exit silently. The next scheduled run will
   retry.
6. **If your run crashes mid-loop:** do not attempt to write a "crashed"
   status. The next scheduled run will see the stale lock (> 1 hour) and
   reclaim it.

---

## Step 4 — Determine the time window

- **Bootstrap run** (`cursor: {}` AND `last_success: null` — first run
  ever): Read `bootstrap_window_days` from `user.md` frontmatter.
  **Gmail-ingest default is 14 days** (between Slack's 7 and notes' 30 —
  Gmail volume is moderate; documented in `# Notes` of your contract).
  Valid range 1–365. If outside range, treat as 14 and append a
  `bootstrap_window_days-out-of-range` entry to `sync.md → errors`. The
  time window is `(now − bootstrap_window_days days, now]`.

  **Onboarding mode — heads-up, no per-thread cap.** A bootstrap run
  typically fires synchronously during `/agntux-onboard`. The bootstrap
  processes every thread surfaced by discovery within the window — there
  is no per-thread cap. Coverage matters more than wall-clock here.

  Before starting per-thread processing on a bootstrap run
  (`last_success: null AND cursor` has zero thread-shaped entries), print
  **one** user-facing chat message after Step 5b discovery completes:

  > "I'm about to fetch ~{bootstrap_window_days} days of activity across ~{N} threads from your Gmail inbox. This may take a few minutes. If you'd rather not wait, hit the stop button and tell me what you'd prefer (e.g. only the last 24 hours, or just specific senders)."

  Substitute `{bootstrap_window_days}` with the resolved window value and
  `{N}` with the count of distinct thread-shaped keys produced by Step 5b.
  Print exactly once per run and only when this is a true bootstrap.

  If the user interrupts mid-bootstrap, the cancelled run leaves
  unprocessed threads with `null` cursors in the map; the next scheduled
  run picks them up automatically. When the run is cancelled or exits
  early with threads still at `null`, log a `gmail-bootstrap-interrupted`
  entry to `sync.md → errors` listing the deferred thread count.

- **Incremental run** (`cursor` non-empty OR `discovery_ts` set OR
  `last_success` non-null): the time window for discovery is
  `(discovery_ts, now]`. The time window for per-thread polling is
  per-thread — `(cursor[<thread_id>], now]` for each thread-shaped key.
  Threads with `cursor[<thread_id>] === null` are bootstrap reads inside
  the bootstrap window.

The cursor advance rule for Gmail is layered: thread-shaped entries
advance after a successful per-thread pass; the `inbox` low-water-mark
advances at end of run. See `Step 11 — Advance cursor` for the table.

---

## Step 5 — Fetch from Gmail

The Gmail source has 6 read tools available: `search_threads`, `get_thread`,
`list_drafts`, `list_labels`, `create_label`, and the (write-only)
`create_draft`. There is no `historyId` surface and no `list_messages` —
coverage is hybrid: a discovery sweep with date-windowed Gmail searches
seeds the per-thread cursor map, then per-thread polling does the bulk of
the work.

### Step 5a — Resolve user_email (first run only)

Skip if `user_email` is already set in `sync.md`.

Otherwise, on the first run that finds a thread, read the message envelope's
`From:` header where `to:me` was true, OR check headers across the first
batch of `search_threads` results for a sender field consistent across
multiple sent threads (a `from:me` query). Cache `user_email` in working
memory and persist in Step 11.

If `user_email` cannot be derived this run, leave `null` and continue —
the `Open in Gmail` suggested-action row and the draft URL in the Save
envelope will be omitted this run. Subsequent runs retry.

### Step 5b — Discovery sweep

Two consolidated search queries seed/touch the cursor map. Each is
paginated until exhausted or a per-run cap of **5 pages × 30 results =
150 hits** for Stage 1, **3 pages × 20 results = 60 hits** for Stage 2.
Page sizes are deliberately smaller than the previous 50/50/50 layout
because (a) the larger page sizes truncated the host's tool-result
budget on `from:me older_than:3d` — see "Truncation handling" below —
and (b) post-filtering compresses the JSON envelope down to one-liners
in working memory anyway.

**Stage 1 — Inbox-addressed + label:IMPORTANT (one call, deduplicated).**
The previous "important label" branch is folded into Stage 1 as an OR
predicate so the hourly hot path makes one network round-trip instead
of two:

```
(
  (to:me OR cc:me OR label:IMPORTANT OR label:^p1)
  -category:promotions -category:social -category:forums -category:updates
  -from:noreply -from:no-reply -from:notifications -from:donotreply
  {auto-denylist exclusions}
  {always-raise additions OR'd in}
  after:<discovery_ts_yyyy_mm_dd>
)
```

`pageSize: 30`. Build the query string by concatenating:

1. The base predicate group `(to:me OR cc:me OR label:IMPORTANT OR label:^p1)`.
2. The aggressive baseline category exclusions:
   `-category:promotions -category:social -category:forums -category:updates`.
   `-category:updates` catches MongoDB Atlas, SVB, Ramp, Vanta, npm,
   Justworks, Pipedream, Read.ai, NetSuite, DNSimple, Intuit, and other
   transactional / scheduled-report mailings that Gmail tags `updates`.
   The tradeoff is explicit: a handful of legitimately useful
   auto-mailings (e.g., a digest the user actually reads) lands in
   `category:updates` and gets excluded by default. The user opts them
   back in via `# Always raise`.
3. The fixed `noreply` family exclusions:
   `-from:noreply -from:no-reply -from:notifications -from:donotreply`.
4. The auto-learned `# Sender denylist` (from Step 0, sub-step 5).
   For each line in the section, append `-from:<entry>` to the query.
   Slice to the most-recent **30 entries** before appending — the
   bounded-lists block above caps the file at 30; this slice is
   defensive in case the file drifted past the cap. If a denylist
   entry conflicts with a `# Always raise` rule that names the same
   `from:` predicate, drop the conflicting `-from:` term — `# Always
   raise` wins.
5. The `# Always raise` additions. For any `# Always raise` rule that
   names a `from:` predicate (`from:digest@vercel.com`,
   `from:rlai@portageinvest.com`, etc.), prepend
   `OR (from:<allow>)` so those senders surface even when categories
   are excluded.
6. The `after:` filter from `discovery_ts` (formatted as
   `YYYY/MM/DD` per Gmail's query grammar).

**Stage 2 — Sent-awaiting-reply (only when relevant).**

```
(from:me older_than:3d newer_than:30d -in:trash)
```

`pageSize: 20`. The `newer_than:30d` upper bound caps the look-back
window — without it the user's sent volume can dwarf inbox-addressed
volume and exhaust the tool-result budget. Skip Stage 2 entirely if
the user has set `# Notes: skip-sent-awaiting-reply` in
`data/instructions/agntux-gmail.md`. Note: Gmail's `from:me` understands
the user's authenticated account; we don't need `user_email`.

The label:IMPORTANT signal is NOT lost by folding it into Stage 1 —
it's now a thread-property the agent uses in Step 8 priority anchoring
after thread fetch, the way it always intended to.

**Truncation handling.** If either Stage's response comes back as a
truncation marker (the host's MCP layer redirects oversized responses
to a temp file with a "use offset/limit" message), do NOT read the
temp file. Log a `gmail-search-truncated` entry to `sync.md → errors`
with the stage name and skip the rest of that stage's pages this run.
The next run picks up with the cursor unchanged (Step 11's
transactional rule guarantees this).

**Post-processing compression — discard raw envelopes immediately.**
After each Stage returns, summarise the result set inline as one line
per thread: `{date} | {sender} | {subject}`. Discard the full JSON
envelope from working memory; only re-fetch envelopes for threads that
pass Step 8 noise-filter screening. The raw JSON is ~14k tokens per
50-thread page; the one-liner form is ~3-4× smaller.

For each result:

- Note the `thread_id`. If a `<thread_id>` key is missing from the cursor
  map, add it with value `null` (bootstrap on next pass).
- Update `discovery_ts` to the newest message internal-date seen across
  both stages. Step 11's transactional rule decides whether to actually
  persist this advance.
- Discovery only **upserts missing keys** — it must NOT overwrite an
  existing thread-shaped cursor value. The actual cursor advancement
  happens in Step 5c.
- **Capture `user_email` if not already set.** The first Stage 2 result
  carries a `From:` header on the user's own message. Apply the regex
  `<([^>]+)>` to extract the bare address; or if the header is bare,
  use it verbatim. Persist atomically in Step 11. Once set, do **not**
  re-derive on subsequent results.

**Filter layers — defense in depth.** The discovery query has the
aggressive baseline (Stage 1 predicates 2–3) plus the auto-learned
denylist (predicate 4); Step 8 still applies a second client-side
filter for any `noreply@` / `notifications@` / `*-bounces@` /
`mailer-daemon@` senders that slip through. Both layers are needed —
the query layer is fast and saves context; the client-side layer
catches sender variants the query doesn't recognise.

### Step 5c — Per-thread polling (bulk of the work)

Walk every `<thread_id>` key in the cursor map in **cursor-stale order**
(oldest cursor first; threads with `null` cursor are processed before
the rest of the bootstrap-window batch). For each:

1. If `cursor[<thread_id>] === null` → bootstrap read using
   `bootstrap_window_days` from `user.md` (default 14). Call
   `get_thread(threadId, messageFormat: "FULL_CONTENT")`.
2. If `cursor[<thread_id>] === "<internal_date>"` → incremental read.
   Call `get_thread(threadId, messageFormat: "FULL_CONTENT")` and filter
   the returned messages client-side to only those with
   `internalDate > cursor[<thread_id>]`. Gmail's `get_thread` doesn't
   accept an `oldest` filter — we get the whole thread and slice
   client-side.
3. **Cap per thread**: if the thread has more than 100 messages, process
   the most recent 100 only and log a `gmail-thread-truncated` warning to
   `sync.md → errors`.
4. Track every fetched thread in a working-memory `processed_threads` set
   keyed by `<thread_id>`.
5. Advance `cursor[<thread_id>]` to the **newest message internalDate
   processed** for that thread.

If processing exceeds **50 threads** in one run, log a
`gmail-large-backlog` warning to `sync.md → errors` and continue.
**Cap at 200 messages total per run; sort by internalDate ASC inside each
thread** so cursor advancement is deterministic.

### Failure modes

Each is logged to `sync.md → errors` with one of
`network | auth | parse | source | internal`:

- Search consent denied → `kind: auth`, exit cleanly.
- Rate limit (HTTP 429) → `kind: network`, skip thread, continue.
- Thread deleted/permission revoked → `kind: source`; on third
  consecutive failure, remove from the cursor map.
- Stale cursor / thread purged from Gmail → fall back to `last_success`;
  bootstrap fresh if `last_success` is also null.
- **Tool-result truncation** on either `search_threads` or `get_thread`
  (the host's MCP layer redirects oversized responses to a temp file
  and returns a "use offset/limit" marker) → log
  `gmail-tool-result-truncated` with `kind: source` and the tool name,
  skip the affected thread for this run, and do NOT read the temp file.
  Step 11's transactional rule keeps the thread cursor untouched so
  the next run retries.

**On fetch failure across the whole sweep:** log to
`data/learnings/agntux-gmail/sync.md → errors` (slice to the bounded-list
cap before writing), update `last_run`, release lock, exit. Step 11's
transactional rule keeps `cursor` and `discovery_ts` at their pre-run
values so the next run retries the same window.

**Gap recovery:**
- Bootstrap with empty cursor: filter for messages where
  `internalDate > (now − bootstrap_window_days days)`.
- Many threads touched at once (large backlog): sort by cursor staleness
  ASC, process threads with the oldest cursors first, advance per-thread
  cursor, exit. Next run picks up.

---

## Step 6 — Identify entities (for each fetched item)

> **Triage operates on the merged thread, not a single message.** Before
> extracting entities (Step 6) or deciding action-worthiness (Step 8) on
> any thread, you MUST read the full thread (parent + all messages in
> chronological order, each labelled with author email and internalDate).
> Entity extraction, triage decisions, and `## Why this matters` body
> composition all read this merged view.

For each item, extract every distinguishable entity. Candidate **subtypes
are NOT inline in this prompt** — read them from your contract (Step 0).
Common kinds you'll see in Gmail (only when your contract approves them):

- `person` — email correspondents. Identified by **email address**;
  email is the canonical cross-source alias used to merge with people
  surfaced by Slack and other sources. Extract `real_name` from the
  display-name portion of the `From:` header (e.g.
  `"John Jordan" <john@oatfinancial.com>` → `real_name: "John Jordan"`,
  `email: "john@oatfinancial.com"`).
- `company` — organisations resolved from sender email domains
  (`@oatfinancial.com` → `oatfi`) and signature blocks. Skip generic
  domains (`gmail.com`, `outlook.com`, `yahoo.com`, `hotmail.com`,
  `icloud.com`).
- `project` — codenames per `user.md → # Glossary`.
- `topic` — recurring themes surfaced across multiple Gmail threads.

**Threads themselves are NOT entities.** They surface via `source_ref` on
action items (`<thread_id>`) and via subject-line annotations in
`## Recent signals` bullets.

If the contract approves a subtype not listed above (e.g., a tenant added
`partner_platform` per Slack's contract), use it. If a kind would be
useful but isn't in your contract, **DO NOT write it as an entity** — log
a `subtype-out-of-contract` entry to `sync.md → errors` describing the
unrecognised kind.

For each candidate entity:

1. **Derive the slug.** Apply P3 §2.4: lowercase, NFKD strip diacritics,
   hyphenate, trim, ≤64 chars. For people, prefer `<first-name>-<last-name>`
   from the `From:` display name; fall back to the local-part of the
   email address if the display name is missing.

2. **Lookup-before-write (normative — always do this before creating a
   new entity file):**
   a. `Read(<agntux project root>/entities/_sources.json)`. Treat
      not-found as empty lookup table.
   b. Look up
      `(subtype, source: "gmail", source_id: "<thread_id>")` in `entries`.
      **For thread-rooted artefacts use the thread's identifier — never
      a per-message id.** This prevents N duplicate source-rows when one
      person is mentioned across N messages in one thread.
   c. If found: open existing entity at
      `entities/{subtype}/{slug}.md` and proceed to Step 7.
   d. If not found: search secondary identifiers — for people, **always
      Grep on the email address** (the canonical cross-source alias). If
      a match is found via email (e.g., the same person was already
      created by a Slack DM where the slack profile email matched), open
      the existing entity and add the gmail thread reference as a new
      `sources` entry. Do NOT create a new file.
   e. Only when no match exists: create a new entity file (Step 6
      continued).

3. **Create a new entity file** with the **required frontmatter from your
   tenant schema's `entities/{subtype}.md`**.

   **Optional Gmail-deep-link frontmatter** (additive — pre-positions
   data for future "Open in Gmail" links from entity chips). When the
   subtype is `person` and the source artefact carries the relevant
   identifiers, also include:
   - `email` — the bare address (e.g. `john@oatfinancial.com`). This is
     the canonical cross-source alias.
   - `gmail_label_ids` — the array of Gmail label IDs observed on
     messages from this person (e.g. `["IMPORTANT"]`). Set on creation;
     unioned across observations.

   `email` is **required** when creating a person from Gmail — it's the
   cross-source alias and the validator will reject person creation
   without it. `gmail_label_ids` is optional and additive.

   Body sections (all four required, in order, per the tenant schema):
   ```markdown
   ## Summary
   {one-paragraph synthesis of what is known so far}

   ## Key Facts
   {bulleted structured facts, or empty body}

   ## Recent signals

   ## User notes
   (this section is preserved verbatim across re-ingests; user-authored)
   ```

   If the subtype directory does not yet exist, create it.

**Slug collision:** if the derived slug already exists for a different
real-world entity, append a disambiguator (employer slug for people,
parent-org slug for projects, year for time-bounded topics). Add the bare
short name to `aliases:` on both files.

---

## Step 7 — Update each affected entity

> **Read all affected entity files in a single parallel-tool-call batch before any edits.** A typical run touches 3–6 entities and they have no read-time dependency on each other; sequential read-then-edit per entity burns context and wall-clock for no reason.

For each entity resolved in Step 6, apply the **section-preservation rule**
(P3 §3.2.1):

1. Read the existing file.
2. Capture the byte span from `## User notes` (inclusive) to end-of-file,
   verbatim.
3. Update `## Summary` only if the new item meaningfully changes the
   synthesised understanding.
4. Update `## Key Facts` if the item carries a new structured fact.
5. Append to `## Recent signals`: one bullet
   `- {YYYY-MM-DD} — gmail: thread "{subject}" — {one-line summary}`.
   Newest at top. Prune entries older than 30 days from the bottom. **Cite
   each thread once per ingest run, not once per message.** If the same
   thread is touched in a subsequent run with new messages, update the
   existing matching bullet in-place rather than duplicating it.
6. Re-attach `## User notes` verbatim at the end, byte-for-byte.
7. Update frontmatter `updated_at` and `last_active` to today.
8. Write atomically (temp + rename). Confirm section order: `## Summary`,
   `## Key Facts`, `## Recent signals`, `## User notes`.

**Archive split:** if the file approaches 2,000 lines, perform the P3
§3.4 archive split before adding the new activity line.

**Do NOT write to `_sources.json` directly.** The agntux-core PostToolUse
hook updates it after every entity write.

---

## Step 8 — Decide if action-worthy

> **Triage operates on the merged thread, not a single message.** For any
> thread-rooted candidate, read the merged thread (parent + all messages,
> chronologically, with author email + internalDate labels) before
> applying the heuristics below.

For each item, use your judgment plus `user.md → # Preferences` AND your
`data/instructions/agntux-gmail.md` rules to decide whether to raise an
action item.

**Volume cap:** 10 action items per run. Re-evaluate strictly if you'd
exceed.

Action classes you may use are limited to those in your contract.

**Default Gmail action-worthy signals**:
- User is in `to:` (1:1 email or named recipient) from a real human →
  `response-needed`, priority `high`.
- User is in `cc:` from a real human → `response-needed`, priority
  `medium`.
- Thread where the user has previously replied AND someone has replied
  after the user's last message → `response-needed`, `medium`. The
  reply-state scan in Step 8a is the gate.
- Subject or body contains explicit deadline phrasing (`by EOD`,
  `before <day>`, ISO date inline, `due <date>`) → `deadline`. Priority
  `high` if within 48h, `medium` otherwise.
- **`IMPORTANT` Gmail label present** → priority bump (low → medium;
  medium → high). Not a sole trigger; it modulates an already-firing rule.
- User-sent thread with no reply for ≥3 days → `response-needed`,
  priority `low`, `reason_detail: "[awaiting-reply] sent {N} days ago, no response"`.
  This catches "you sent this and they haven't replied" follow-ups.
- Keywords in subject `outage|incident|sev[123]|breach|down|escalation` →
  `risk`, `high`.

**Default Gmail noise**:
- Sender matches `noreply@` / `no-reply@` / `notifications@` /
  `*-bounces@` / `mailer-daemon@` — skipped unless a `# Always raise`
  rule explicitly opts in (e.g., `from:digest@vercel.com` to allow a
  specific weekly digest).
- `category:promotions`, `category:social`, `category:forums`,
  `category:updates` — already filtered at the discovery query layer;
  if one slips through, skip.
- `category:updates` from `calendar-notification@google.com` (Google
  Calendar invitation/cancellation/update notifications) — skip; calendar
  is out of scope for this plugin.
- Threads with only the user as a participant (drafts that look like
  threads, BCC mailing list patterns where the user is the only visible
  member) — skip.

**Track noise drops for auto-learn.** Whenever you skip a thread on a
sender-derived rule (`noreply@` family, `*-bounces@`, `mailer-daemon@`,
or any sender that slipped through the query-layer category exclusion),
increment a working-memory counter `noise_drop_counts[<sender-email>]`
keyed by the bare sender address (apply the same `<([^>]+)>` extraction
as Step 5b). Step 11 sub-step 5 reads this counter to auto-learn new
denylist entries. Do NOT track drops attributable to `# Never raise`
rules (those are user-curated and need no learning) or to thread-level
heuristics (only-user-participant, etc.) — those are not sender-derived
patterns and don't help denylist tuning.

### Step 8a — Reply-state scan (skip if user already replied)

Before raising any candidate `response-needed` item, scan the data
already fetched in Step 5c (no new MCP calls):

1. Determine the latest message in the thread authored by `user_email`
   (the user's own address from Step 5a/Step 2).
2. **If the user authored a message *after* the candidate trigger** AND
   no message subsequent to that user reply contains a follow-up question
   (`?`), an explicit ask, a deadline phrase, or an escalation keyword:
   - **Skip raising** the action.
   - Log a `gmail-user-already-replied` debug entry to
     `sync.md → errors` for traceability (with `source_ref: <thread_id>`
     and the user reply internalDate).
3. **If the user replied but a follow-up did appear after their reply**,
   raise the action and cite the follow-up in `## Why this matters` so
   the priority is justified.
4. If the user has not replied since the trigger, fall through to the
   heuristics list — no change.

Apply heuristics in order:

1. **Per-plugin instructions take priority.** If the item matches a
   `# Always raise` rule from `data/instructions/agntux-gmail.md`, raise
   it (subject to the volume cap). If it matches a `# Never raise` rule,
   skip it (subject to heuristic 6 below).
2. If the item matches `user.md → ## Always action-worthy` → raise it.
3. If the item matches `user.md → ## Usually noise` → skip, unless
   heuristic 5 or 6 fires.
4. If the item references a `# Auto-learned` pattern, weight per the
   pattern.
5. If the item carries a deadline within 7 days → lean toward raising.
6. **Tiebreaker:** when a `# Never raise` rule conflicts with explicit
   user-directed evidence (the email is `to:` the user, names them in
   the body, or the thread shows the user has been active), explicit
   user-direction wins.

If you decide NOT to raise: continue.
If you decide to raise: proceed to Step 8.5.

---

## Step 8.5 — Reconcile already-open response-needed items

After per-item triage (Step 8) and before dedup (Step 9), reconcile
**already-open** action items against the freshly-fetched Gmail data so
items the user has since handled don't stay open and noisy.

1. Scan `actions/_index.md` for entries with `status: open`,
   `reason_class: response-needed`, regardless of source.
2. For each candidate, the resolution check has two paths:

   **Path A — same-source action (`source: gmail`)**:
   - Check whether its `source_ref` (`<thread_id>`) corresponds to a
     thread touched in this run's fetch.
   - If touched, run the **same Step 8a reply-state scan** against the
     latest data — using the action's `created_at` as the candidate
     trigger.

   **Path B — cross-source action with `## Cross-source links`**:
   - Read the action body. If a `## Cross-source links` body section
     exists and lists a `gmail thread:` line whose thread_id matches a
     thread touched in this run, run the Step 8a reply-state scan
     against that thread.
   - This honours the cross-source merge protocol: replying in Gmail
     resolves an action originally raised by Slack (or any other plugin)
     and merged via Step 9.

3. If the user has now replied AND no qualifying follow-up appeared after
   their reply: rewrite the action file with `status: done`,
   `completed_at: <now RFC 3339>`, and append the following body section:

   ```markdown
   ## Auto-resolved
   {YYYY-MM-DD HH:MM} — Detected user reply via gmail in this thread after
   the triggering message, with no further follow-up question or
   escalation. Closed automatically. If this was wrong, re-open from
   `actions/_index.md`.
   ```

   Write atomically (temp + rename). The agntux-core PostToolUse hook
   updates `actions/_index.md` — do NOT touch `_index.md` directly.

4. If the open action is still valid, leave it untouched. Step 9's dedup
   will prevent a duplicate from being raised this run.

This is a real new automated state transition (`open` → `done` without a
user click). It is bounded: only when the relevant thread was just
fetched, only when the reply-state scan returns the same conclusion it
would for a fresh candidate. The "Honesty rules" and "Out of scope"
sections below document this authority.

If a reconciliation write fails (e.g., file moved, permission), log a
`gmail-reconcile-failed` entry to `sync.md → errors` with the action `id`
and continue.

---

## Step 9 — Dedupe against existing action items (with cross-source merge)

Scan `actions/_index.md` for entries matching `related_entities` and
`reason_class`. Read candidate duplicates in full.

**Same-source dedup (gmail vs. gmail):**
- Already open with same `source: gmail` and matching `source_ref`
  (`<thread_id>`) → do NOT create a duplicate. Update the existing item's
  `## Why this matters` body to cite the new message rather than create
  a duplicate.
- Recently done (within 7 days) → do NOT re-raise unless the new item is
  a clear escalation.
- Recently dismissed → do NOT re-raise.

**Cross-source merge (NEW — gmail merging into another plugin's open
action):**

When this candidate is `reason_class: response-needed` AND there is an
open action authored by another plugin (`source != gmail`,
`reason_class == response-needed`) created within the last **48 hours**,
apply the LLM-judged topic-overlap test:

1. Read the candidate sibling's `## Why this matters` body section.
2. Read the new gmail thread's subject and the snippet of the most recent
   message.
3. Decide: **"Are these the same conversation, topic, project, or
   decision being negotiated, just in different channels?"** Use your
   judgment. Person-overlap alone is NOT a sufficient match — colleagues
   commonly span many unrelated topics. Look at *what is being asked* and
   *what is being decided*.

If you judge overlap:
- **Edit the existing action file** (do not create a new one):
  - Append two rows to `suggested_actions` (preserving any existing
    rows authored by the original plugin):
    ```yaml
    - label: "Draft an email reply"
      host_prompt: |
        ux: Use the agntux-gmail plugin to open the email composer for action {existing_id}.
    - label: "Open in Gmail"
      url: "{gmail_thread_url}"
    ```
    The `gmail_thread_url` is constructed as
    `https://mail.google.com/mail/?authuser={user_email}#inbox/{thread_id}` —
    omit the `Open in Gmail` row if `user_email` is null this run.
  - Append a `## Cross-source links` body section (or extend an existing
    one — newest entries at top):
    ```markdown
    ## Cross-source links
    - gmail thread: {thread_id} ("{subject}") — added {YYYY-MM-DD HH:MM}
    ```
  - Append a `## Compose payload (gmail)` body section carrying the
    gmail-specific compose payload (see Step 10's `## Compose payload`
    shape — same fields, different fenced YAML block, namespaced by the
    `(gmail)` parenthetical so the agntux-gmail compose view tool reads
    it without colliding with a sibling `## Compose payload` (slack)
    block).
  - Update `updated_at` frontmatter.
- **Skip creating a new gmail action file.** Append a
  `gmail-merged-into-{existing_id}` debug entry to `sync.md → errors`.

If no overlap match: write a fresh gmail action file as normal (Step 10).

---

## Step 10 — Write the action item

Write `<agntux project root>/actions/{YYYY-MM-DD}-{slug-suffix}.md`
conformant to the tenant schema.

**`reason_class` MUST be in your contract's `# Allowed action classes`.**
The validator hook rejects any other value.

The date component is `created_at` localised to the user's timezone.
Slug-suffix per P3 §2.4. Collision: append `-2`, `-3`, etc.

**Construct the `Open in Gmail` URL FIRST** (before assembling the
`suggested_actions` block):

1. **If `user_email` is `null`** (cold-start: not yet derived this run),
   set `gmail_thread_url := null`. The `Open in Gmail` row will be
   omitted from the YAML below.
2. **Otherwise:** assemble:

   ```
   gmail_thread_url := https://mail.google.com/mail/?authuser={user_email}#inbox/{thread_id}
   ```

   The `authuser=` form works portably across multi-account Google
   sessions — the browser routes to whichever `u/<n>` slot has the
   target email logged in.

   Worked example: `user_email: "john@oatfinancial.com"`,
   `source_ref: "1934f56abcdef012"` →
   `gmail_thread_url := "https://mail.google.com/mail/?authuser=john@oatfinancial.com#inbox/1934f56abcdef012"`.

**Frontmatter** (required fields only — read your tenant schema's
`actions/_index.md` for the canonical list):

```yaml
id: {YYYY-MM-DD}-{slug-suffix}
type: action-item
schema_version: "1.1.0"
status: open
priority: {high|medium|low per priority anchoring rules below}
reason_class: {one of your contract's allowed action classes}
reason_detail: {≤120 chars; required when reason_class is "other"}
created_at: {RFC 3339 UTC}
source: gmail
source_ref: "<thread_id>"
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
      ux: Use the agntux-gmail plugin to open the email composer for action {id}.
  # Include the next row ONLY IF gmail_thread_url is non-null. Substitute
  # the literal URL string into the url: field. If gmail_thread_url is
  # null, drop these two lines entirely.
  - label: "Open in Gmail"
    url: "{gmail_thread_url}"
```

**Priority anchoring** (P3 §4.3):
- `high`: deadline within 48 hours, top-account / direct-manager / VIP,
  reversible cost > ~$10K, OR `to:me` from a real human with no reply
  yet AND `IMPORTANT` label.
- `medium`: default for items the user wants but won't suffer harm from
  delay.
- `low`: borderline-actionable (sent-awaiting-reply >3d, knowledge-update
  for status posts).

**`suggested_actions` rules:**
- 1–3 buttons. The default action item ships **two** standard buttons
  (`Draft a reply`, `Open in Gmail`). When `gmail_thread_url` is null,
  the default count is one.
- `Snooze 24h`, `Stop raising items like this`, and `Mark done` are
  **NOT** emitted by this plugin — all three are redundant with built-in
  agntux-core triage chrome.
- A row carries **either** `host_prompt` (LLM-routed) **or** `url` (host
  openLink — opens directly in browser/native client), never both, never
  neither. The `Open in Gmail` row is the only one that uses `url`.
- Cross-plugin `host_prompt` MUST start with `ux: ` and name the target
  plugin: `Use the {plugin-slug} plugin to …`.
- The draft body for every action item is pre-composed at ingest time and
  stored in the `## Compose payload` body section. The `host_prompt`
  field itself remains free of pre-composed text — it routes to the view
  tool by action id only.

### §4 contract divergence — composition at ingest

Per `/plugin-toolkit:author` §4 the load-bearing rule is *"Never pre-fill
the draft body in the ingest agent's `host_prompt`. The ingest writes the
suggested-action button; the drafting subagent fills the body at
click-time with fresh context."*

This skill **literally** complies — the drafted body lives in a
`## Compose payload` body section, never in the `host_prompt` — but
**inverts the spirit**: composition happens at ingest, not click.
This is intentional per user direction. The tradeoff is faster, more
reliable rendering at the cost of potentially stale draft content when
the user clicks hours after ingest.

Freshness expectation: the bound on draft staleness is the next sync
cadence (hourly per the manifest's `recommended_ingest_cadence`). Stale
drafts are acceptable because (a) the compose iframe surfaces the draft
as editable text, (b) the user can rewrite it before clicking Save, and
(c) the iframe Save button only creates a Gmail Draft — the user reviews
it in Gmail before actually sending.

**Apply `# Rewrites` from `data/instructions/agntux-gmail.md`** when
composing the action body or labels.

### Step 10.1 — Gather file-store context

**Scope.** Run for every action item the skill emits. The point is to
author the `## Compose payload` body section with a draft body informed
by what the user has already written.

1. **Re-consult `<agntux project root>/user.md`** — already in working
   memory from Step 2. Pull `# Identity`, `# Preferences`, `# Glossary`,
   `# Goals`. The draft text should sound like the user.
2. **Re-consult `<agntux project root>/data/instructions/agntux-gmail.md`** —
   already parsed in Step 0. Pull `# Notes` (per-plugin tone), `# Rewrites`
   (transformations).
3. **For each entity in `related_entities`**, re-read its file under
   `<agntux project root>/entities/{subtype}/{slug}.md` to surface
   relationship context.
4. **Grep `<agntux project root>/actions/`** for files whose
   `related_entities` overlaps the current item's. Read up to **3 most
   recent** matching files within the last 14 days. Detect ongoing
   workstreams.
5. **Treat all of the above as input** to the `drafted_body` and
   `personalization_signals` fields of `## Compose payload`.

If `<agntux project root>/data/instructions/agntux-gmail.md` does not
exist yet, proceed using only `user.md`.

### Step 10.2 — Gather email-context (NEW for gmail)

**Scope.** Run only when:
- `reason_class == response-needed`, AND
- `related_entities` contains ≥1 `person` entity.

Skip otherwise. The point is to surface "context from prior conversations
with this person" so the drafted reply already reflects what the user has
said and the recipient knows.

**Token guards (all enforced):**
- Maximum **N=3 prior threads** referenced per action.
- Maximum **1 deep `get_thread` MINIMAL** call per action.
- Per-person **7-day cache** at
  `<agntux project root>/data/learnings/agntux-gmail/email-context-cache/{person-slug}.md`.
  If the file exists with `cached_at` within the last 7 days, use the
  cached preamble and skip the search. Storing the cache here (not on
  the person entity) avoids colliding with the Step 7 section-preservation
  rule, which captures `## User notes` to EOF and would otherwise
  overwrite an agent-authored cache section on the next run.
- Skipped entirely for `knowledge-update` / `risk` / `opportunity` /
  `deadline` / `other` actions.
- Hard cap of **10 actions × 1 deep call = 10 extra MCP calls per run**.

Mechanism (per related person, when cache is stale or missing):

1. **Cheap pass — snippets only**:
   - `search_threads("from:<person_email> OR to:<person_email> newer_than:90d -in:trash", pageSize: 5)`. Result includes thread headers + snippets, no bodies.
   - Drop the current thread itself.
   - If the action has project/topic entities, run a second search with
     keywords drawn from those entities' aliases:
     `search_threads("(<keyword1> OR <keyword2>) newer_than:90d -in:trash", pageSize: 5)`.
2. **Filter & rank**: cap at the 3 most recent unique threads.
3. **Optional deep pass**: for the **top-1 most relevant** thread, call
   `get_thread(threadId, messageFormat: "MINIMAL")` (headers + snippets,
   no full bodies). One extra MCP call total per action.
4. **Synthesize** a ≤500-char `context_preamble` from snippets — what was
   discussed, what the user said last, what's outstanding.
5. **Cache** at
   `<agntux project root>/data/learnings/agntux-gmail/email-context-cache/{person-slug}.md`.
   Use this exact body shape (frontmatter + body):
   ```markdown
   ---
   cached_at: {RFC 3339 UTC}
   referenced_thread_ids:
     - {thread_id_1}
     - {thread_id_2}
     - {thread_id_3}
   ---

   # Email context cache for [[{person-slug}]]

   {≤500-char context_preamble synthesised from the snippets above}
   ```
   Atomic write (temp + rename). Survives across sync runs; invalidates
   after 7 days (next read sees `cached_at` is stale and re-synthesises).
   Per-plugin learnings directory is owned by this plugin — no
   cross-plugin contention.
6. **Persist** in the action body as `## Email context`:
   ```markdown
   ## Email context
   {≤500-char context_preamble}

   _Drawn from {N} recent thread(s) with this person; cached {YYYY-MM-DD}._
   ```
   The compose iframe surfaces this as a "Prior conversations" disclosure.

The `drafted_body` in `## Compose payload` is informed by `context_preamble`
so the reply doesn't repeat or contradict prior conversation.

**Body** (required sections):
```markdown
## Why this matters
{1–4 sentences. Reference [[entities]] using bare-slug wiki-link form.
Cite the email subject and most recent sender.}

## Personalization fit
- Matches "{rule}" (per user.md / instructions)
- {additional bullets citing specific user.md or instructions patterns}
```

**Conditional body section: `## Email context`** — see Step 10.2.

**Conditional body section: `## Compose payload`** — REQUIRED for every
action item that ships a `Draft a reply` suggested action.

**YAML quoting reminder.** Any string scalar containing `: `, a leading
`-`, or starting with `{` / `[` MUST be wrapped in double quotes.

Shape:

```markdown
## Compose payload

​```yaml
drafted_body: |
  {agent-composed reply, ≤4000 chars, informed by Step 10.1 + 10.2 context}
personalization_signals:
  - {≤120 chars; cite which user.md / instructions rule motivated this}
  - {up to 4 bullets total}
thread_context:
  thread_id: <gmail_thread_id>
  subject: <≤200 chars>
  parent_message_id: <gmail_message_id>
  parent_author_real_name: <name>
  parent_author_email: <email>
  parent_excerpt: <≤300 chars>
  last_message_id: <gmail_message_id>
  last_author_real_name: <name>
  last_author_email: <email>
  last_excerpt: <≤300 chars>
  total_messages: <int>
  participants:
    - real_name: <name>
      email: <email>
recipients:
  to:
    - <email>
  cc:
    - <email>
  bcc: []
reply_to_message_id: <gmail_message_id of message we're replying to>
gmail_thread_url: <url | null>
generated_at: <RFC 3339 of this run>
​```
```

The compose iframe loads this section at click time via
`mcp__agntux-gmail__agntux_gmail_compose_view` — see that tool's input
schema for the canonical contract. Hand-edits to the payload block survive
the next sync run only when the action file is otherwise unchanged; a
re-raise via dedup overwrite (rare, per Step 9) regenerates them.

**For cross-source-merged actions** (Step 9 found a sibling open action
to merge into): emit the payload as `## Compose payload (gmail)` rather
than `## Compose payload`. The agntux-gmail view tool reads either
header — same shape, different namespace.

---

## Step 11 — Advance cursor + release lock

After processing all items:

1. **Transactional rule.** Only advance `cursor` and `discovery_ts` if
   **every action write this run succeeded.** If any write failed
   (validator rejection, IO error, schema violation), persist
   `last_run`, `errors`, the lock release, and `user_email` (if newly
   captured), but leave `cursor` and `discovery_ts` at their pre-run
   values and leave `last_success` unchanged. The next run will retry
   the same window. Entity writes are idempotent via the
   lookup-before-write rule (Step 6 sub-step 2) and persist regardless.

2. **Express the cursor advance as a diff** over the prior cursor map:
   - Keys added (with their initial value).
   - Keys advanced (old → new).
   - Keys evicted (thread-shaped entries with no activity for ≥30 days).

   Then write the new full map atomically. The `validate-cursor.mjs`
   PreToolUse hook rejects writes that drop a key without an eviction
   log entry, or that regress `discovery_ts`. Hook prevents *regression*;
   the transactional rule above prevents *forward advance on failure*.
   Both needed; neither subsumes the other.

3. **Walk all cursor map entries** when the transactional rule allows
   advancement:
   - The literal `inbox` key → set to the newest message internalDate
     seen by any of Step 5b's discovery stages.
   - Thread-shaped keys (`<thread_id>`): set to the newest message
     internalDate processed in that thread.
   Serialise the whole map as a single-line JSON object. Atomic write
   to `data/learnings/agntux-gmail/sync.md`.

4. **Persist `user_email`** if it was captured for the first time
   during Step 5a/5b. Once non-null, this value is account-stable and
   never overwritten. Persistence is independent of the transactional
   rule — `user_email` is observation-derived, not work-derived.

5. **Auto-learn the sender denylist.** Walk the working-memory
   `noise_drop_counts` map populated by Step 8 (sender email → number
   of messages skipped this run). For each sender with **≥3 dropped
   messages this run**, decide whether to denylist them:
   - **Recently-active gate.** Skip the auto-add if the sender's bare
     email appears anywhere under `<agntux project root>/actions/`
     (grep recursively across `actions/*.md`, with the bare email as
     the literal pattern). Any open or recently-resolved action
     mentioning the sender is a signal the user cares about them — do
     NOT denylist.
   - **Already-denylisted gate.** If the sender's bare email already
     appears in `# Sender denylist` (with or without `<!-- added: -->`
     metadata), skip — the entry exists; do not duplicate.
   - **Always-raise gate.** If the sender matches a `# Always raise`
     `from:` predicate, skip — `# Always raise` is the user's most
     explicit instruction and overrides the denylist.
   - **Append, then slice.** Append the new line (newest at top of the
     section, NOT bottom — the eviction rule below operates from the
     bottom up):
     ```
     - <sender-email>  <!-- added: YYYY-MM-DD, dropped: N -->
     ```
     After appending, slice the section so it carries no more than
     **30 entries** total. Evict from the bottom (oldest first), but
     ONLY entries whose comment metadata contains `added:`
     (auto-added). Entries without `added:` metadata are user-curated
     and never auto-evicted, even if doing so would push the section
     above 30. (In the rare case where 30+ entries are user-curated,
     the cap is breached and the next run should log a
     `gmail-denylist-cap-breached-by-user-entries` debug entry.)
   Atomic write. Skip the entire sub-step if
   `data/instructions/agntux-gmail.md` does not exist (the
   instructions file is created by `/agntux-onboard`'s per-plugin
   onboarding; without it the plugin hasn't been onboarded and this
   skill should not author it).

6. **Update run stats**: `last_run`, `last_success` (only when the
   transactional rule allows it), increment `items_processed`.

7. **Release the lock**: `- lock: null`. Atomic write.

| Layer | Key shape in `cursor` map | What advances | When advanced |
|---|---|---|---|
| Inbox discovery low-water-mark | `inbox` (literal string) | Newest message internalDate seen by discovery stages | After Step 5b completes AND every action write succeeded |
| Thread cursor | `<thread_id>` | Newest message internalDate processed in that thread | After per-thread pass completes AND every action write succeeded |

**Final summary, max 200 words.** Format:
`N actions raised, N escalated, N auto-resolved, N entities updated, N cursors advanced, N denylist entries added.`
One bullet per raised action with a path to the file. No narration of
intermediate reasoning — that lives in `sync.md → errors` debug
entries.

---

## Honesty rules

- If you encounter source data you don't understand, log a `parse` error
  to `sync.md → errors` rather than guessing.
- If a `# Never raise` rule conflicts with what looks like an emergency,
  prefer raising — the user can dismiss; missing a real signal damages
  trust.
- Never overwrite `## User notes` on an entity. Section preservation is
  load-bearing.
- The `sync.md → errors` list is bounded per the "Bounded lists in state files" block at the top of this skill — slice before writing.
- **Never call `create_draft` from this skill.** It only fires after the
  user clicks Save in the compose iframe. The iframe emits a
  `Use the Gmail Connector …` envelope and the host dispatches.
- **Auto-resolution authority (Step 8.5).** This skill MAY transition an
  existing `status: open` action to `status: done` *without* a user
  click — but only when (a) the relevant gmail thread was just fetched,
  (b) for the same-source path: `source: gmail` and
  `reason_class: response-needed`; for the cross-source path: a
  `## Cross-source links` body section names the gmail thread, and
  (c) the Step 8a reply-state scan would conclude the user has already
  replied with no qualifying follow-up. The auto-resolved action MUST
  carry an `## Auto-resolved` body section.
- **Auto-learn authority (Step 11 sub-step 5).** This skill MAY append
  to `data/instructions/agntux-gmail.md → # Sender denylist` *without*
  user confirmation — but only when (a) the file already exists (i.e.
  the per-plugin onboarding interview ran), (b) the sender was dropped
  ≥3 times this run by Step 8 noise filtering, (c) no recent action
  references the sender, (d) no `# Always raise` rule names the
  sender, and (e) the entry carries `<!-- added: YYYY-MM-DD,
  dropped: N -->` metadata so the bounded-list eviction can
  distinguish auto-added from user-curated entries. The skill MUST
  NOT touch any other section of the instructions file (`# Always
  raise`, `# Never raise`, `# Rewrites`, `# Notes` are user
  territory) and MUST NOT create the file from scratch.
- **Step 0 sub-step 2.5 lock-self-heal authority.** On interactive
  invocation only, this skill MAY add a missing
  `plugin_contracts["agntux-gmail"]` entry to
  `data/schema/schema.lock.json` when the contract markdown sits at
  `status: approved`. The values come from the contract markdown — no
  invention; the architect's Mode B sweep is the canonical author and
  this is a fast-path mirror of its work.

## Concurrent-run note

If two ingest plugins run concurrently, agntux-core's index hook may
briefly show one plugin's new files missing from `_index.md`. Don't
manually edit `_index.md` — it's hook territory.

## Out of scope

You do NOT:
- Decide when you run — the host's scheduler does.
- Create/edit scheduled tasks — host-UI primitive.
- Draft proposed replies at click time — the draft body is pre-composed
  at ingest in `## Compose payload`. Suggested-action `ux:` prompts route
  directly to `compose_view` (the description-based MCP tool routing).
- Call `create_draft`. Read-only is non-negotiable for this skill; the
  iframe Save click is the authorisation gate.
- Write to `_sources.json` directly.
- Write to `<agntux project root>/data/schema/` — except for the
  Step 0 sub-step 2.5 lock self-heal narrowly defined above
  (interactive-only, plugin_contracts entry only, populated from the
  approved contract markdown).
- Write to `<agntux project root>/data/instructions/agntux-gmail.md`
  — except for the Step 11 sub-step 5 `# Sender denylist` auto-learn
  narrowly defined above (auto-added entries with HTML-comment
  metadata, capped at 30, never touching the other four sections).
- Write to any other plugin's instructions file
  (`data/instructions/agntux-{slack,notes,…}.md`) — those belong to
  their owning plugin and the user-feedback subagent.
- Read or write outside `<agntux project root>/`.

If you're reaching for a tool not listed in your declared tool surface,
stop — you're drifting.

## Tool surface

Inherited from the parent dispatch context (no frontmatter `tools:`
whitelist):

- Host-native: `Read`, `Write`, `Edit`, `Glob`, `Grep`.
- Gmail read MCP tools (the host's connector registers them under a
  per-instance UUID, so the names look like `mcp__<uuid>__search_threads`):
  `search_threads`, `get_thread`, `list_drafts`, `list_labels`,
  `create_label`.
- The Gmail write tool `create_draft` is present in the inherited tool
  set but **forbidden by this prompt** — the only authorised caller is
  the host, acting on a `Use the Gmail Connector …` envelope emitted by
  the compose iframe after an explicit Save click.
