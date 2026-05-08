# Gmail fetch — Step 5 orchestration

Companion to `../SKILL.md` Step 5. The Gmail source has two read tools the sync flow uses (`search_threads`, `get_thread`) plus a third (`list_labels`) that is host-side metadata and not part of the Step 5 path. The write tools (`create_label`, `create_draft`) are inherited from the connector but **forbidden by this skill** — drafting fires from the iframe Save/Send button at click time via `sendFollowUpMessage`, never from the sync flow. There is no `historyId` surface and no `list_messages` — coverage is hybrid: a discovery sweep with date-windowed Gmail searches seeds the per-thread cursor map, then per-thread polling does the bulk of the work.

`list_drafts` was previously included in the tool surface as a "do I have an in-progress draft for this thread?" signal but no Step 5 path consumes it; subsequent runs informed by drafts go through the iframe's own state. It is dropped from the manifest in `frontmatter.yaml`. The MCP layer still permits it on the connector — UI handlers can call it directly when they need the user's draft inventory.

## Step 5a — Resolve user_email (first run only)

Skip if `user_email` is already set in `sync.md`.

Otherwise, on the first run that finds a thread, read the message envelope's
`From:` header where `to:me` was true, OR check headers across the first
batch of `search_threads` results for a sender field consistent across
multiple sent threads (a `from:me` query). Cache `user_email` in working
memory and persist in Step 11.

If `user_email` cannot be derived this run, leave `null` and continue —
the `Open in Gmail` suggested-action row and the draft URL in the Save
envelope will be omitted this run. Subsequent runs retry. Note: Gmail's
`from:me` understands the user's authenticated account; we don't need
`user_email` to construct it.

## Step 5b — Discovery sweep

Two consolidated search queries seed/touch the cursor map. Each is
paginated until exhausted or a per-run cap of **5 pages × 30 results =
150 hits** for Stage 1, **3 pages × 20 results = 60 hits** for Stage 2.
Page sizes are deliberately smaller than the 50/50/50 layout this
replaced because (a) larger page sizes truncated the host's tool-result
budget on `from:me older_than:3d` (see "Truncation handling" below) and
(b) post-filtering compresses the JSON envelope down to one-liners in
working memory anyway.

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
   bounded-lists block in `../SKILL.md` caps the file at 30; this
   slice is defensive in case the file drifted past the cap. If a
   denylist entry conflicts with a `# Always raise` rule that names the
   same `from:` predicate, drop the conflicting `-from:` term — `# Always
   raise` wins.
5. The `# Always raise` additions. For any `# Always raise` rule that
   names a `from:` predicate (`from:digest@vercel.com`, etc.), prepend
   `OR (from:<allow>)` so those senders surface even when categories are
   excluded.
6. The `after:` filter from `discovery_ts` (formatted as `YYYY/MM/DD`
   per Gmail's query grammar).

**Stage 2 — Sent-awaiting-reply (only when relevant).**

```
(from:me older_than:3d newer_than:30d -in:trash)
```

`pageSize: 20`. The `newer_than:30d` upper bound caps the look-back
window — without it the user's sent volume can dwarf inbox-addressed
volume and exhaust the tool-result budget. Skip Stage 2 entirely if
the user has set `# Notes: skip-sent-awaiting-reply` in
`data/instructions/agntux-gmail.md`.

**`label:IMPORTANT` priority anchoring (verify-then-use).** Folding
the label into Stage 1 catches the threads in discovery, but Step 8
priority anchoring on the label is conditional on `get_thread`
returning a `labels:` field on each message in `FULL_CONTENT` mode.
Inspect the first thread's response envelope this run for a `labels:`
field at message or thread level: if present, treat
`labels` containing `IMPORTANT` (or `^p1`) as a priority-bump anchor
in Step 8 and cite it in `## Why this matters`. If absent, do **not**
infer label state from the discovery query alone — the label set the
search matched on might have changed between search-time and
fetch-time, and inferring is hallucination. Step 8 then derives
priority from content heuristics only (deadline phrases, escalation
keywords, dollar figures) and cites those. Either path is honest;
silently claiming "label-driven priority" without label evidence is
not.

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
  existing thread-shaped cursor value. Step 5c owns advancement.
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

## Step 5c — Per-thread polling (bulk of the work)

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
4. Track every fetched thread in a working-memory `processed_threads`
   set keyed by `<thread_id>`.
5. Advance `cursor[<thread_id>]` to the **newest message internalDate
   processed** for that thread.

If processing exceeds **50 threads** in one run, log a
`gmail-large-backlog` warning to `sync.md → errors` and continue.
**Cap at 200 messages total per run; sort by internalDate ASC inside
each thread** so cursor advancement is deterministic.

For per-source failure modes, gap recovery, and worked examples, see the
sibling `runbook.md` resource (linked from `../SKILL.md`).
