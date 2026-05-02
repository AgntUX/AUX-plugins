# Cursor Strategies — Per-Source Reference

This file is the canonical reference for cursor conventions used by per-source ingest plugins.
P6's plugin generator reads this file when substituting `{{source-cursor-semantics}}` into the
ingest subagent template.

Each entry covers: cursor type, where it is stored in the per-plugin sync file, how to advance
it after a successful run, and how to recover when a gap or expiry is detected.

> **P3a path note.** Every plugin owns a single sync file at
> `<agntux project root>/data/learnings/{{plugin-slug}}/sync.md`. The legacy shared `.state/sync.md` and the
> per-source `.state/notes/{{source-slug}}.md` learnings files are retired. Cursor + lock + the
> bounded `errors` list (last 10 entries) are the entire writable surface; there is no separate
> per-plugin "learnings.md".

---

## Gmail (`gmail-ingest`)

### Cursor type

`historyId` — a monotonically increasing opaque integer string emitted by the Gmail API.
Each Gmail mailbox has a single global history sequence. The `historyId` returned by
`users.history.list` represents "the state of the mailbox at this point in time." It is NOT
a timestamp; it cannot be computed from one.

### Storage in `data/learnings/gmail-ingest/sync.md`

```markdown
- cursor: "1234567890"     ← verbatim historyId string from the last successful fetch
```

Stored as a quoted string (YAML string). Never coerce to an integer — JSON number precision
can corrupt large historyId values.

### How to advance

After a successful `users.history.list` call:

1. Collect all `historyId` values returned in the `history[]` array.
2. The new cursor is the **largest** `historyId` in the response (or the `historyId` field
   on the `users.history.list` response envelope if the array is empty — this represents
   the current head of the mailbox history).
3. Write the new cursor to `data/learnings/gmail-ingest/sync.md` atomically.

### Recovering from a gap

**Symptom:** the Gmail API returns HTTP 404 with `reason: "historyNotFound"` when you call
`users.history.list?startHistoryId={cursor}`. This means the `historyId` is too old (Gmail
purges history after approximately 30 days) or was never valid.

**Recovery procedure:**
1. Read `last_success` from `data/learnings/gmail-ingest/sync.md`. If non-null, use it as a
   timestamp lower bound: fetch messages with `q: "after:{YYYY/MM/DD}"` derived from
   `last_success`.
2. If `last_success` is null (never successfully synced), fall back to the
   `bootstrap_window_days` window from `user.md` frontmatter (default 30 days).
3. Process the recovered messages as a bootstrap batch.
4. After the batch completes, call `users.getProfile` to obtain the current `historyId` and
   write it as the new cursor. This re-anchors the cursor at the present.
5. Append a structured `historyid-gap` entry to `sync.md → errors` (last 10 entries kept) so
   the staleness surfaces in the next `/ux` retrieval freshness check.

**Do NOT reset cursor to null** — that would re-process up to `bootstrap_window_days` of mail
on the next run and likely flood the action-item list.

---

## Slack (`slack-ingest`)

### Cursor type

Per-channel `ts` (timestamp string) — a Slack channel-message timestamp in the form
`"1714043640.001200"` (Unix seconds + microseconds, dot-separated, as a string). Each channel
has its own independent cursor; Slack has no mailbox-wide sequence number comparable to Gmail's
`historyId`.

### Storage in `data/learnings/slack-ingest/sync.md`

```markdown
- cursor: {"C01ABC": "1714043640.001200", "C02DEF": "1713990000.000000", "D03GHI": null}
```

The cursor value is a **JSON object serialised as a single-line string** (no newlines) mapping
channel/DM IDs to their latest-processed `ts`. A channel whose value is `null` has been
discovered but not yet bootstrapped. A channel not yet in the map has never been seen.

Because the sync file is markdown, store the object as an inline JSON string on the cursor
line. The ingest agent reads it with `JSON.parse(cursor)` (or equivalent) and writes it back
with `JSON.stringify(obj)` (no pretty-printing).

### How to advance

After processing messages for a channel:

1. Set `cursor_map[channel_id]` to the `ts` of the **newest** message processed in that channel.
2. Serialise the updated map and write back to the `cursor` line.
3. Write the sync file atomically after all channels in the batch are advanced.

Advance one channel at a time if processing sequentially; advance all at once at the end if
processing in a single batch. Either is conformant — the cursor is only read at the start of
the next run.

### Recovering from a gap

**Symptom:** a channel's stored `ts` is older than the Slack message retention window (varies
by workspace plan; free plans keep 90 days, paid plans keep longer). The `conversations.history`
call with `oldest={ts}` succeeds but returns no messages (the cursor is stale but technically
within range), OR the workspace admin has deleted old messages and the cursor references a
message that no longer exists.

**Recovery procedure:**
1. Read `last_success` from `data/learnings/slack-ingest/sync.md`. If non-null, compute a Unix
   timestamp from `last_success` and use it as the `oldest` parameter for
   `conversations.history`.
2. If `last_success` is null, use the `bootstrap_window_days` window.
3. For channels that have never been bootstrapped (`ts: null` in the cursor map), always use
   the `bootstrap_window_days` window regardless of `last_success`.
4. After the recovery batch, advance the cursor map as normal.
5. Append a `slack-ts-stale` entry (kind `source`) to `sync.md → errors` so the staleness
   surfaces on the next `/ux`.

**DM channels** use the same `ts`-based cursor. They appear in the cursor map with their
`D`-prefixed channel ID (e.g., `"D03GHI"`).

**Thread replies** are fetched separately via `conversations.replies`. Their `ts` values are
children of the parent message's `ts` — do not confuse them with channel-level cursors. When
a thread reply triggers an action item, use the parent thread's `ts` as `source_ref` in the
action-item frontmatter.

---

## Jira (`jira-ingest`)

### Cursor type

ISO 8601 timestamp string — used as the `updated >= "{timestamp}"` clause in JQL queries.
Specifically: `"2026-04-25T18:00:00.000+0000"` (Jira Cloud's preferred format). The cursor
represents "last time we successfully fetched; fetch everything updated after this."

### Storage in `data/learnings/jira-ingest/sync.md`

```markdown
- cursor: "2026-04-25T18:00:00.000+0000"
```

Stored verbatim as the Jira-formatted timestamp string. Do not normalise to RFC 3339 — Jira's
JQL parser is sensitive to timestamp format and the verbatim string avoids re-formatting bugs.

### How to advance

After a successful JQL query batch:

1. Record the **start time of the current run** (not the timestamp of the newest issue — see
   note below) as the new cursor.
2. Write to `data/learnings/jira-ingest/sync.md` atomically.

**Why start-of-run, not newest-issue timestamp?** Jira issues can be updated milliseconds apart.
Using the newest `updated` field as the cursor risks skipping issues updated in the same second
as the newest one in the batch. Using the run-start timestamp ensures overlap: the next run
re-fetches a small window of already-processed issues, which the dedup step (Step 9 in
`ingest.md`) discards harmlessly.

### Recovering from a gap

**Symptom:** the cursor is very old (e.g., machine was offline for weeks) and the JQL query
returns more than 200 results. This is not an error — it is the normal "catch-up" path.

**Recovery procedure:**
1. Process the oldest 200 results (sort by `updated ASC` in JQL), advance the cursor to the
   start-of-run timestamp for that batch, and exit successfully.
2. The next scheduled run fetches the next 200 oldest unprocessed issues (because the cursor
   advanced only partway through the backlog).
3. Repeat until the backlog is drained. No manual intervention needed.

**Symptom:** the cursor is null (bootstrap). Use `updated >= "{now - bootstrap_window_days days}"`.

**Jira pagination note:** Jira Cloud's REST API uses `startAt`/`maxResults` pagination, not
cursor-based. Always sort by `updated ASC` and use the run-start cursor to avoid skipping
issues updated during the fetch window.

---

## Google Drive (`gdrive-ingest`)

### Cursor type

Folder-level `modifiedTime` timestamp — RFC 3339 string representing the most recent
`modifiedTime` seen across all files in the watched folders. Fetch is performed via
`drive.files.list?q=modifiedTime > '{cursor}' and '{folderId}' in parents`.

### Storage in `data/learnings/gdrive-ingest/sync.md`

```markdown
- cursor: "2026-04-25T18:00:00Z"
```

Stored as a quoted RFC 3339 string. If multiple watched folders exist, a single global cursor
(the oldest `last_success` across all folders) is sufficient — re-fetching a small window of
already-processed files is harmless (dedup in Step 9 discards them).

### How to advance

After a successful fetch across all watched folders:

1. Record the **start time of the current run** as the new cursor (same rationale as Jira —
   avoids edge-case skips for files modified in the last second of the window).
2. Write to `data/learnings/gdrive-ingest/sync.md` atomically.

### Recovering from a gap

**Symptom:** the cursor is null (bootstrap) or very old. The `drive.files.list` call may return
hundreds of results.

**Recovery procedure:**
1. Sort results by `modifiedTime ASC`. Process the oldest 200.
2. Advance the cursor to the start-of-run timestamp.
3. Exit; next run picks up the next 200.
4. If the backlog was unexpectedly large, append a `gdrive-large-backlog` entry (kind `source`)
   to `sync.md → errors`.

**Symptom:** a watched folder has been deleted or the Drive permissions were revoked. The API
returns a 404 or 403 for the folder.

**Recovery procedure:**
1. Append a structured error to `data/learnings/gdrive-ingest/sync.md → errors` with kind
   `source` and message `"folder {folderId} not found or permission denied"`.
2. Skip that folder for this run; process other folders normally.
3. Persistent failures surface to the user via retrieval's freshness check on the next `/ux`,
   prompting them to reconfigure the watched folders.

**GDrive change tokens (alternative):** Drive also offers a Changes API with a `pageToken`
(change cursor). This is more efficient for high-volume drives but requires a separate
`changes.getStartPageToken` bootstrap call. For simplicity, the default implementation uses
the `modifiedTime` filter. If the user reports performance issues at scale, the `proposed_schema`
on a future plugin version may opt in to the Changes API instead.

---

## HubSpot (`hubspot-ingest`)

### Cursor type

`updatedAt` timestamp — ISO 8601 UTC string, e.g., `"2026-04-25T18:00:00.000Z"`. HubSpot's
CRM API supports filtering contacts, companies, and deals by `lastmodifieddate` (v1) or
`updatedAt` (v3). Use the v3 `updatedAt ≥ {cursor}` filter.

### Storage in `data/learnings/hubspot-ingest/sync.md`

```markdown
- cursor: "2026-04-25T18:00:00.000Z"
```

Stored verbatim as the HubSpot-formatted timestamp. Separate cursors per object type (contacts,
companies, deals) are NOT required — a single global cursor covers all object types because
HubSpot's API accepts the same timestamp filter across all CRM objects.

### How to advance

After a successful fetch of all object types:

1. Use the **start time of the current run** as the new cursor (same rationale as Jira/GDrive).
2. Write to `data/learnings/hubspot-ingest/sync.md` atomically.

### Recovering from a gap

**Symptom:** the cursor is very old (months of CRM changes queued). The `updatedAt ≥ cursor`
query returns a large result set.

**Recovery procedure:**
1. Sort by `updatedAt ASC`. Process the oldest 200 records across all object types combined.
2. Advance the cursor to start-of-run.
3. Exit; next run continues the backlog.

**Symptom:** the cursor is null (bootstrap). Use `updatedAt ≥ now − bootstrap_window_days`.

**HubSpot rate limiting note:** HubSpot enforces burst limits (100 req/10s for CRM APIs). If the
fetch returns HTTP 429, log kind `network` with message `"HubSpot rate limit; retry next run"`
to `sync.md → errors`, release the lock, and exit. The next scheduled run will continue from the
same cursor.

**HubSpot pagination note:** HubSpot's v3 CRM API uses cursor-based pagination via the `after`
paging token in the response. When paginating within a run, collect all pages up to the 200-item
cap before advancing the cursor. Do not advance the cursor mid-pagination — only after the full
batch is processed.

---

## Filesystem / Notes (`notes-ingest` and similar)

### Cursor type

File modification time (mtime) — RFC 3339 string representing the most recent `mtime` seen
across all processed files in the watched directory. Fetch is performed by listing files in the
watched directory and filtering for those with `mtime > cursor`.

### Storage in `data/learnings/notes-ingest/sync.md`

```markdown
- cursor: "2026-04-25T18:00:00Z"
```

Stored as a quoted RFC 3339 string. This is a global cursor across the entire watched directory.

### How to advance

After successfully processing all files modified since the last cursor:

1. Use the **start time of the current run** as the new cursor.
   - Using start-of-run (not the newest mtime in the batch) prevents a race where a file is
     modified during the run: the file would have `mtime > start-of-run` and would be caught
     on the next run.
2. Write to `data/learnings/notes-ingest/sync.md` atomically.

### Recovering from a gap

**Symptom:** the cursor is null (bootstrap). List all files in the watched directory and filter
for those with `mtime > (now − bootstrap_window_days days)`.

**Symptom:** the cursor is old and many files have been modified (e.g., a bulk import or a
folder migration). The list of modified files exceeds 200.

**Recovery procedure:**
1. Sort files by `mtime ASC`. Process the oldest 200.
2. Advance the cursor to start-of-run.
3. Exit; next run picks up the next batch.

**Symptom:** the watched directory has been moved or deleted.

**Recovery procedure:**
1. Append a structured error to `data/learnings/notes-ingest/sync.md → errors` with kind
   `source` and message `"watched directory not found: {path}"`.
2. Release the lock and exit.
3. Persistent failures surface to the user via retrieval's freshness check on the next `/ux`,
   prompting them to reconfigure the notes directory path in `.mcp.json`.

**File encoding note:** notes files may be UTF-8, UTF-8 BOM, or legacy encodings (RTF). The
filesystem MCP server (`@modelcontextprotocol/server-filesystem`) returns file contents as
UTF-8 where possible. If a file cannot be decoded, log kind `parse` to `sync.md → errors` and
skip the file.

**Subdirectory handling:** the default implementation is flat (one directory, no recursion).
Recursive directory traversal is a potential future enhancement; if the user requests it, the
plugin author should add it as a configuration option in `.mcp.json` rather than expanding the
agent prompt.

---

## Summary table

| Source | Cursor type | Format | Advance at | Gap recovery |
|---|---|---|---|---|
| Gmail | `historyId` (opaque int string) | `"1234567890"` | End of batch (use response envelope historyId) | `historyNotFound` → timestamp fallback from `last_success` or bootstrap window; then re-anchor from `getProfile` |
| Slack | Per-channel `ts` map (JSON object) | `{"C01": "1714043640.001200"}` | End of per-channel batch | Stale ts → use `last_success` Unix timestamp as `oldest`; null channel → bootstrap window |
| Jira | `updated >=` JQL timestamp | `"2026-04-25T18:00:00.000+0000"` | Start of current run | Old cursor → normal catch-up (200-item batches); null → bootstrap window |
| GDrive | Folder `modifiedTime` | `"2026-04-25T18:00:00Z"` | Start of current run | Old cursor → catch-up batches; deleted folder → log error to sync.md → errors |
| HubSpot | CRM `updatedAt` | `"2026-04-25T18:00:00.000Z"` | Start of current run | Old cursor → catch-up batches; 429 → log and exit, retry next run |
| Filesystem | Directory `mtime` | `"2026-04-25T18:00:00Z"` | Start of current run | Null → bootstrap window; moved dir → log error to sync.md → errors, exit |
