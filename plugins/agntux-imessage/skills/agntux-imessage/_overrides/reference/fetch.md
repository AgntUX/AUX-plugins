# iMessage fetch — Step 5 orchestration

Wholesale override for `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
iMessage uses a three-phase shape: discover unread messages, resolve each
sender to a contact name, then optionally pull recent thread context per sender
for better classification and drafting.

## Step 5 — Fetch from iMessage

Call `mcp__Read_and_Send_iMessages__get_unread_imessages`,
`mcp__Read_and_Send_iMessages__search_contacts`, and (where needed)
`mcp__Read_and_Send_iMessages__read_imessages`. The host may UUID-prefix
these at runtime; call them by their host-resolved names.

### Step 5a — Discover unread messages

Call `get_unread_imessages` once to retrieve new inbound messages:

```
get_unread_imessages({ limit: 50 })
```

Use `limit: 50` as the default; increase to 100 on bootstrap runs where
the window is wider. There is no pagination token — if the connector
returns the full limit, assume there may be more and note it in `sync.md
→ errors` (kind: `source`, describe as truncated-at-limit) so the next
run picks up the rest.

**Filter out the user's own sent messages.** Discard any message where
`is_from_me` is `true`. These are the user's own sent messages and are
relevant only as thread context (Step 5c), not as inbound items to triage.

**Incremental filter.** For each remaining message, check the sender
against `cursor[sender]` (the per-contact JSON map from Step 2):

- If `cursor[sender]` exists: keep only messages where `date > cursor[sender]`.
- If `cursor[sender]` does not exist (new contact or bootstrap): keep all
  messages from that sender within the bootstrap window or since last run.

Group the retained messages by `sender` handle. Each sender represents
one conversation thread to process.

**Bootstrap run (cursor null or empty map).** Include messages whose
`date` falls within `(now − bootstrap_window_days, now]`. Default
`bootstrap_window_days` for iMessage is 7 (declared in `frontmatter.yaml`).

**Run cap.** Process at most 20 distinct sender threads per run. If more
than 20 new-sender threads surface, sort by the newest message date
descending (most-urgent first) and defer the remainder to the next run.
Do NOT advance the cursor for deferred senders.

### Step 5b — Resolve contact names

For each distinct sender handle, call `search_contacts` to resolve the
phone number or email to a human-readable contact name:

```
search_contacts({ query: "<sender handle>" })
```

Use the result's contact name for entity display and for triage. If
`search_contacts` returns no match, use the raw sender handle as the
display name and log an `imessage-contact-unresolved` entry to
`sync.md → errors` (kind: `source`) with the sender handle. Continue
processing — an unresolved handle is not a fatal error.

**Do not hard-code phone number formats.** The connector may return
handles in E.164 form (`+14155550100`), local form (`4155550100`), or
as an email address (for iMessage-over-Apple-ID senders). Treat whatever
the connector returns as the opaque key for both cursor map lookup and
entity source_id.

### Step 5c — Pull thread context (selective)

For senders that resolved to a named contact in Step 5b, call
`read_imessages` to retrieve recent thread history. This serves two
purposes: (1) establishing whether two-way history exists (needed by
Step 5d triage), and (2) providing drafting context for `needs-you`
action items.

```
read_imessages({ phone_number: "<sender handle>", limit: 10 })
```

This gives the last 10 messages in the conversation (both inbound and
outbound). Do NOT call `read_imessages` for senders that did NOT resolve
to a named contact — their classification defaults to
`promotional-automated` (Step 5d) and no thread context is needed.

If `read_imessages` fails or returns an empty array, log
`imessage-rate-limited` (kind: `source`) if the connector returns a
throttle signal, otherwise log a generic `source` error. Treat as "no
two-way history" for Step 5d purposes; the action item can still be
written using only the unread message(s) from Step 5a.

### Step 5d — Triage classification

Classify each sender thread into exactly ONE of the three tiers using
these generalizable, per-user-agnostic signals. Never use a block list
or hard-coded contact names.

**Establish sender identity first.** Before scoring any content signals,
determine two facts about each sender:

- **named-contact**: `search_contacts` returned a match for this sender handle.
- **two-way history**: `read_imessages` result for this sender contains at
  least one entry where `is_from_me: true` (the user has sent at least one
  message to this sender previously). If `read_imessages` was not called for
  this sender (e.g., early-stage pre-classification), treat as "no two-way
  history" — do not assume history you have not confirmed.

A sender that is **not a named contact AND has no two-way history** is an
unresolved stranger. Content signals about questions or requests do NOT
elevate an unresolved stranger to `needs-you`; the default tier for such
senders is `promotional-automated` (see below).

---

**`needs-you` (high priority) — raise an action item.**
Any of these signals present:

- Sender is a named contact (resolved via `search_contacts`) AND the
  thread has prior outbound messages (`is_from_me: true` entry exists in
  `read_imessages` result).
- **[Gated on sender identity]** Message body contains a direct question
  (ends with `?`, or uses question words: who, what, when, where, why, how,
  can you, could you, will you, are you, do you, would you) — **only when
  the sender is a named contact OR the thread has two-way history**. A
  question from an unresolved, history-less sender does NOT qualify.
- **[Gated on sender identity]** Message body contains a request or directive
  (imperative verbs: "please", "can you", "could you", "need you to",
  "reminder", "don't forget", "ASAP", "urgent", "let me know") — **only when
  the sender is a named contact OR the thread has two-way history**.
- **[Gated on sender identity]** Message body references a specific time, date,
  deadline, or event requiring confirmation or acknowledgement — **only when
  the sender is a named contact OR the thread has two-way history**.

**`personal-fyi` (medium) — record but do not raise action.**
All of these true simultaneously:
- Sender resolves to a named contact (not a short-code or unknown number).
- Message is informational: no question, no request, no time-sensitive
  element (e.g., "Heading out now", "Thanks!", "On my way", "Saw your
  message").
- No two-way history required, but reply is optional and not urgent.

**`promotional-automated` (low) — suppress entirely.**
Any of these signals present:
- Sender handle is 5–6 digits (short-code SMS).
- Message body contains: "Reply STOP", "Opt out", "STOP to cancel",
  "msg&data rates", "verification code", "Your code is", "OTP",
  "one-time password", "security code", "%off", "discount", "promo",
  "limited time", "click here", "unsubscribe".
- **Sender is NOT a named contact AND has no two-way history** — regardless
  of message content (including questions, requests, or time references).
  Cold outreach, unsolicited recruiting, and spam are classified here even
  when the body contains a question mark or request language.

**Conflict-resolution rule — prefer the higher tier, with one explicit
exception.** When multiple signals fire and point to different tiers, assign
the higher-priority tier. Exception: question, request, and time-reference
signals alone do NOT promote an unresolved, history-less sender out of
`promotional-automated`. Those content signals only count toward `needs-you`
when sender identity is established (named contact or two-way history). A
named contact forwarding an OTP — where both `promotional-automated` language
signals and named-contact identity are present — still resolves to the higher
tier (`needs-you` or `personal-fyi`) because the sender IS a named contact.

### Step 5 summary — on fetch failure

On any failure from `get_unread_imessages`:

- Log to `data/learnings/agntux-imessage/sync.md → errors` with
  kind `network | auth | source | internal` as appropriate.
- Slice the errors list to the last 10 entries (newest-first).
- Release the lock and exit. Do NOT advance the cursor.
- Step 11's transactional rule keeps the cursor map at its pre-run state;
  the next scheduled run retries.

## Cursor shape for iMessage

The cursor is a per-contact JSON map on the `sync.md → cursor` line:

```yaml
# sync.md frontmatter — example after a successful run
cursor: '{"Mom":{"handle":"+14155550101","last_seen":"2026-06-18T18:15:00Z"},"John Jordan":{"handle":"+14155550102","last_seen":"2026-06-18T17:45:00Z"}}'
```

Each entry: `contact_name` → `{ handle, last_seen }` where `handle` is
the opaque sender string from the connector and `last_seen` is the
ISO-8601 UTC timestamp of the newest message processed from that sender.

Advance each entry to `max(date)` across all messages successfully
processed from that sender this run. Advance only when every action
write in the run succeeds (Step 11 transactional rule).

**Eviction:** remove cursor entries for senders whose `last_seen` is
more than 90 days before `now` at Step 2 read time. Log each eviction
as `imessage-cursor-evicted` (kind: `source`) with the contact name and
last_seen date. Eviction bounds the map size for active users without
losing contacts who just haven't messaged recently.

## Failure modes

| Symptom | kind | Action |
|---|---|---|
| `get_unread_imessages` auth error | `auth` | exit, retry next run |
| `get_unread_imessages` network failure | `network` | exit, retry next run |
| `get_unread_imessages` returns empty unexpectedly after repeated runs | `source` | log, continue — may be permission issue |
| `search_contacts` returns no match | `source` + `imessage-contact-unresolved` | use raw handle, continue |
| `read_imessages` rate-limited or throttled | `source` + `imessage-rate-limited` | skip thread context, continue |
| `read_imessages` returns empty | `source` | skip thread context, continue; draft without history |
| Cursor map corrupted or unparseable | `parse` | treat as bootstrap, log, continue |
