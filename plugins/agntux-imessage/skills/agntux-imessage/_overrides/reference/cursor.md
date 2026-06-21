# Cursor advance reference — agntux-imessage (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/cursor.md`.

iMessage uses the **per-handle last-seen-timestamp map** strategy: a
JSON object stored on the `sync.md → cursor` line where every key is
the sender handle exactly as returned by the connector and every value
is the ISO-8601 UTC timestamp of the newest message successfully
processed from that sender.

---

## Strategy name

**Per-handle last-seen-timestamp map (client-side dedup)**

This strategy applies when:

- The source exposes no server-side since-timestamp filter and no
  opaque pagination or sync token.
- Fetching returns the current snapshot (unread queue or recent thread)
  with no way to ask "give me only what changed after T".
- Multiple independent conversation threads exist and each thread's
  progress must be tracked independently.
- Volume per conversation is low but the number of distinct contacts
  can be large.

iMessage satisfies all four conditions. `get_unread_imessages` returns
the current unread snapshot; there is no `since` parameter and no
server-issued cursor token. Each 1:1 thread (or group-chat handle) is
independent. Client-side dedup by `(handle, date)` is the only
available mechanism.

---

## Canonical cursor map shape

```yaml
# data/learnings/agntux-imessage/sync.md — example after a successful run
cursor: '{"+14155550101":{"last_seen":"2026-06-18T18:15:00Z"},"+14155550102":{"last_seen":"2026-06-18T17:45:00Z"},"alex@icloud.com":{"last_seen":"2026-06-17T09:22:00Z"}}'
```

The cursor value is a **JSON object** serialised to a single-line
string on the `sync.md → cursor` frontmatter key.

### Map key

The key is the **sender handle exactly as returned by the
`get_unread_imessages` `sender` field** — not the contact display name.
Handles arrive in E.164 form (`+14155550101`), bare-digits form
(`4155550100`), or email form (`alex@icloud.com`) depending on the
connector's normalisation. Treat each as an opaque string. Do not
normalise, strip `+`, or reformat. Use the handle verbatim for map
lookup and for map writes.

Keying on the display name (contact name from `search_contacts`) is
explicitly wrong:

- Contact names are mutable: a user renaming "Mom" to "Patricia Jordan"
  would cause a stale key to accumulate in the map forever and a new
  key to be inserted, re-processing all messages from that contact.
- Contact name resolution may fail (`imessage-contact-unresolved`), in
  which case there would be no stable key. The handle is always present.
- The handle is the source's native identifier and the correct
  `source_id` for entity lookup — the cursor key should match it.

Note: `fetch.md`'s YAML example (the `## Cursor shape for iMessage`
section) uses display names (`"Mom"`, `"John Jordan"`) as map keys.
That example is illustrative shorthand. This file is the authoritative
cursor specification; the handle-keyed form governs. The ingest skill
MUST use the raw `sender` string as the cursor map key.

### Value shape

Each value is a JSON object with a single required field:

```json
{ "last_seen": "<ISO-8601 UTC timestamp>" }
```

`last_seen` is the `date` field of the newest message successfully
processed from this sender during the most recent run in which at least
one of their messages was processed. It is always written in
`YYYY-MM-DDTHH:MM:SSZ` form (second precision, UTC, `Z` suffix).

The value is intentionally minimal. Do not add contact name, thread
metadata, or classification results to the value — those belong in
entity files, not in the cursor state. The cursor map must survive
contact renames, contact resolution failures, and schema-version
upgrades without needing field migrations.

### Bootstrap state

```yaml
cursor: null
last_success: null
```

A null cursor and null `last_success` together signal "first run ever".
The bootstrap window applies (see below).

---

## Client-side dedup by (handle, date)

Because the connector exposes no server-side since-filter, every run
fetches the current unread snapshot and applies a client-side filter:

```
For each message M with sender handle H:
  if cursor[H] exists:
    keep M if and only if M.date > cursor[H].last_seen
  else:
    keep M if M.date is within the bootstrap window
      (see "New senders and bootstrap window" below)
```

The comparison is strict greater-than on the ISO-8601 UTC string
(lexicographic comparison is valid for this format at second
precision). A message whose `date` equals `cursor[H].last_seen` was
the boundary message of the previous run and is intentionally
excluded — it has already been processed.

The connector returns `date` as an ISO-8601 string. No normalisation
is required before comparison, but confirm the value is UTC-suffixed
(`Z` or `+00:00`). If the connector ever emits a local-timezone form,
convert to UTC before comparing. Log a `parse` error if conversion
fails and skip the message; do NOT advance the cursor for that sender
on account of a skipped message.

---

## Advance rule

### Incremental run (cursor non-null and map is non-empty)

For each sender handle H processed this run:

1. Collect all messages from H that passed the client-side filter
   (date strictly greater than the existing `cursor[H].last_seen`, or
   all messages if H is newly seen this run).
2. Compute `new_last_seen(H) = max(date)` across all messages from H
   **that were durably written** (action write for this sender's item
   succeeded or the item was intentionally suppressed, e.g.,
   `promotional-automated`). A message that was fetched but whose
   action write failed does NOT contribute to `new_last_seen(H)`.
3. After every action write in the run has been attempted (Step 11):
   - If all writes succeeded: advance `cursor[H].last_seen` to
     `new_last_seen(H)` for every H processed this run.
   - If any write failed: do NOT advance any cursor entry. Leave the
     entire cursor map at its pre-run state. Record the failures in
     `sync.md → errors`. The next run re-processes from the same
     thresholds.

**Why max-across-run:** the connector has no since-filter, so
setting the cursor to start-of-run would not help on the next call
anyway. The only protection against re-processing is having the cursor
set to the exact timestamp of the last message processed. Using
max(date) per sender achieves this precisely.

**Why advance only on full-run success (transactional rule):** a
partial-failure run that advanced the cursor for the successful senders
would permanently skip the failed messages for those senders on the next
run — there is no way to re-request exactly those messages from the
connector. The cursor must move atomically: either all senders advance
or none do.

### Bootstrap run (cursor null OR last_success null)

Onboarding-mode provision: when `cursor` is null AND `last_success` is
null (first run ever), apply the bootstrap window:

- Include messages from all senders where `date` falls within
  `(now - bootstrap_window_days days, now]`. Default
  `bootstrap_window_days` is 7 (declared in `frontmatter.yaml`).
- Apply the 20-distinct-sender-thread run cap (see "Run cap" below).
  On a busy bootstrap this limits the first run to the 20 most-recent
  senders. Subsequent runs pick up deferred senders.

After all action writes succeed, write a cursor entry for every sender
processed, with `last_seen` set to the max(date) seen from each.

For a second or later run where `cursor` is non-null but a specific
sender handle H is absent from the map, treat that sender as "new this
run" and apply the bootstrap window to their messages. Do NOT treat an
absent-from-map sender as license to pull unlimited history — bound by
the same 7-day window.

---

## New senders and the bootstrap window

A sender absent from the cursor map is not necessarily a new contact
in the real world — they may be a long-dormant contact whose cursor
entry was evicted (see "Eviction" below), or a sender whose handle
changed form (e.g., `4155550101` vs `+14155550101`). Treat all of
these identically:

- Process messages from the past `bootstrap_window_days` days (default
  7). Do not fetch unbounded history.
- After durable write, add a new cursor entry for the handle.
- Log no warning for a new-sender insert; it is the normal path for
  any contact first seen after plugin installation.

This bounds the catch-up work for a new contact to at most 7 days of
messages, which keeps the first run snappy (target <1 minute total).

---

## Run cap

Process at most **20 distinct sender threads per run**. If
`get_unread_imessages` returns messages from more than 20 distinct
sender handles after the client-side date filter:

1. Sort senders by `max(date across their messages)` descending
   (most-recently-active first).
2. Process the first 20 senders.
3. For deferred senders: do NOT advance their cursor entries and do NOT
   log a per-sender error. The next scheduled run will pick them up —
   they will still be in the unread queue.
4. Log a single `source` error entry noting how many senders were
   deferred: `"N senders deferred to next run (cap 20)"`.

The 20-sender cap is separate from and in addition to the canonical
200-item per-run cap. Each sender thread counts as one item for cap
purposes at the thread level.

---

## Eviction

Remove cursor entries for sender handles whose `last_seen` is more than
**90 days** before the current run's `now` timestamp (captured at
Step 2).

Eviction is evaluated at Step 2 (cursor read time), before fetch.
Eviction rationale: iMessage is a personal communication channel where
contacts may legitimately go months between messages. A 90-day idle
window is longer than the canonical 30-day parent-registry eviction
used for Slack threads because iMessage contact cadence is lower-volume
and more personal. The window is source-specific and declared here.

Procedure:

1. Read and parse the cursor map.
2. Identify all entries where `last_seen < (now - 90 days)`.
3. Remove those entries from the in-memory map.
4. For each evicted entry, append an `imessage-cursor-evicted` error
   entry to `sync.md → errors` (kind: `source`) with:
   - `handle`: the evicted key (redact if privacy mode is active)
   - `last_seen`: the timestamp that triggered eviction
5. Slice the errors list to the last 10 entries (newest-first).
6. Do NOT write the evicted-map back to `sync.md` at Step 2 — write it
   only as part of the transactional cursor advance at Step 11. If the
   run fails before Step 11, evictions are re-evaluated on the next run.

After eviction, if a message from an evicted handle appears in the
unread queue, it is treated as a new sender (bootstrap window applies).
This is correct: a contact that has been silent for 90+ days whose
first new message surfaces is indistinguishable from a new contact for
processing purposes.

---

## No tracked-parent registry

iMessage threads are 1:1 per contact handle (or per group handle).
Ask the tracked-parent registry question:

> "When a new reply lands on an old parent, does the parent's
> cursor field bump?"

For iMessage the question does not apply in the Slack-thread sense:
there are no thread replies on an old parent. Every new inbound
message from any sender surfaces in `get_unread_imessages` as a fresh
unread item — the connector's unread queue is the discovery mechanism.
There is no scenario where a new message from a contact fails to
surface in the unread feed while the contact's cursor is stale.

The tracked-parent registry is **not needed and MUST NOT be created**
for this plugin. The cursor map key space has no `<handle>#<msg_id>`
entries — only bare `<handle>` entries. This is intentional and must
be preserved across plugin versions.

---

## Cursor diff expression (Step 11)

Log this line at Step 11 cursor-advance time:

```
cursor advance — added: <handle>×N, advanced: <handle>×M, evicted: <handle>×K
```

Where:
- `added` covers sender handles newly inserted into the map this run
  (were not present before).
- `advanced` covers existing entries whose `last_seen` moved forward.
- `evicted` covers entries removed by the 90-day idle rule.

Example:

```
cursor advance — added: +14155550103×1, advanced: +14155550101×1 +14155550102×1, evicted: +14088880001×1
```

If no senders of a given category exist, omit that category from the
log line. On a zero-new-message run (all senders filtered out), log:

```
cursor advance — (no change; all messages pre-cursor or run capped)
```

The `validate-cursor.mjs` hook checks that the cursor value is
parseable JSON and that no existing `last_seen` value regresses. A
write where any existing entry's `last_seen` moves backward will be
rejected. The diff log is informational; the hook is the enforcement
gate.

---

## No workspace identifier capture

iMessage is a local/on-device source. There is no tenant workspace
subdomain, portal ID, or organisation URL key. Deep links to iMessage
conversations use the `imessage://` URI scheme
(`imessage://<handle>`) rather than a web permalink, so no
tenant-scope identifier needs to be captured or persisted in
`sync.md` frontmatter.

The `compose-payload.md` override's `"Open in Messages"` suggested
action uses this scheme directly with the contact handle from the
action file body.

---

## `_sources.json` lookup-before-write protocol

The lookup-before-write protocol from Step 6 fully applies. The
`source_id` used for lookup is the sender handle exactly as it appears
in the cursor map key.

Key points for iMessage:

- **Person entities** use the raw sender handle as `source_id`:
  `(subtype: person, source: imessage, source_id: "+14155550101")`.
- **Email as cross-source alias**: call `search_contacts` to resolve
  the handle to a contact. If the contact record carries an email
  address, attempt a secondary lookup in `_sources.json` by
  `(subtype: person, source_id: "<email>")`. If that resolves to an
  existing person entity (e.g., one already created from Gmail), merge
  into that entity rather than creating a new one. This is the standard
  email-anchor cross-source dedup rule.
- **Handle-format variation**: `+14155550101` and `14155550101` and
  `4155550101` may refer to the same person but will produce different
  map keys and different `source_id` values. The dedup path through the
  contact name and email anchor is the correct resolution — do not
  attempt to normalise handles in the cursor map. If two handle forms
  for the same contact accumulate separate cursor entries, the 90-day
  eviction will naturally clean up the stale form.
- **Do NOT write to `_sources.json` directly.** The agntux-core
  PostToolUse hook owns it.

---

## sync.md template

Bootstrap state:

```yaml
---
plugin: agntux-imessage
version: 0.1.0
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

After the first successful incremental run with three contacts:

```yaml
---
plugin: agntux-imessage
version: 0.1.0
cursor: '{"+14155550101":{"last_seen":"2026-06-18T18:15:00Z"},"+14155550102":{"last_seen":"2026-06-18T17:45:00Z"},"alex@icloud.com":{"last_seen":"2026-06-17T09:22:00Z"}}'
last_run: "2026-06-18T18:16:30Z"
last_success: "2026-06-18T18:16:30Z"
items_processed: 5
lock: null
errors: (none)
---
```

After a run that evicts one idle contact:

```yaml
---
plugin: agntux-imessage
version: 0.1.0
cursor: '{"+14155550101":{"last_seen":"2026-06-18T18:15:00Z"},"alex@icloud.com":{"last_seen":"2026-06-17T09:22:00Z"}}'
last_run: "2026-09-18T09:00:00Z"
last_success: "2026-09-18T09:00:01Z"
items_processed: 2
lock: null
errors:
  - kind: source
    ts: "2026-09-18T09:00:01Z"
    error_kind: imessage-cursor-evicted
    detail: "Evicted handle +14155550102 (last_seen 2026-06-18T17:45:00Z, idle 92 days)"
---
```

---

## Self-validation against fetch.md and frontmatter.yaml

| Claim in fetch.md / frontmatter.yaml | cursor.md alignment |
|---|---|
| Cursor is a per-contact JSON map (frontmatter.yaml source-cursor-semantics) | Confirmed — map shape section above |
| Map key is sender handle (phone/email, opaque, from connector) (frontmatter.yaml line 17) | Confirmed — map key section explicitly resolves this and corrects fetch.md's illustrative display-name example |
| Value is ISO-8601 UTC timestamp of newest message seen from that sender | Confirmed — value shape section; stored as `last_seen` inside a single-field object |
| Incremental filter: date > cursor[sender] (frontmatter.yaml source-cursor-semantics) | Confirmed — client-side dedup section, strict greater-than |
| All messages kept if sender not yet in map (frontmatter.yaml) | Confirmed — new senders section; bounded by bootstrap window |
| Advance to max(date) across messages processed from that sender this run | Confirmed — advance rule section |
| Advance only on full-run success (transactional) (frontmatter.yaml, fetch.md Step 11 ref) | Confirmed — advance rule section, transactional rule |
| Evict keys idle for 90+ days (frontmatter.yaml source-cursor-semantics) | Confirmed — eviction section with 90-day rationale |
| imessage-cursor-evicted error kind on eviction (frontmatter.yaml permitted-error-kinds) | Confirmed — eviction section step 4 |
| imessage-contact-unresolved on search_contacts miss (frontmatter.yaml permitted-error-kinds) | Noted in _sources.json section; cursor is not advanced for handles whose contact resolution failed if the write also failed |
| imessage-rate-limited on read_imessages throttle (frontmatter.yaml permitted-error-kinds) | Not a cursor concern — cursor advances normally for senders whose thread-context fetch was rate-limited (unread message is still processed) |
| Bootstrap window 7 days (frontmatter.yaml bootstrap-window-default-days) | Confirmed — bootstrap run section and new-senders section both cite 7-day default |
| 20-sender-thread run cap (fetch.md Step 5a) | Confirmed — run cap section; cap value matches fetch.md exactly |
| get_unread_imessages limit: 50 default, 100 on bootstrap (fetch.md Step 5a) | Acknowledged — fetch.md owns this; cursor.md does not repeat it but cursor advance is consistent |
| No tracked-parent registry (iMessage has no thread-reply-on-old-parent scenario) | Confirmed — no tracked-parent registry section |
| No workspace identifier (local source, imessage:// URI scheme) | Confirmed — no workspace identifier section |
