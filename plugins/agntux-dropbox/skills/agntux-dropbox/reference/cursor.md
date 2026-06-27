# Cursor advance reference — agntux-dropbox (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/cursor.md`.

Dropbox uses a **four-part hybrid cursor** strategy. The cursor is a JSON
object stored as a single-line string on the `sync.md → cursor` key. The
four sub-keys serve distinct, non-overlapping roles that together cover the
full surface of the Dropbox connector: server-side folder deltas
(`folder_cursor`), client-side revision-based change detection (`files`), a
timestamp watermark for shared links (`shared_links_cursor`), and a seen-id
set for file requests (`file_requests_seen`).

---

## Strategy name

**Four-part hybrid cursor (opaque server delta + rev map +
timestamp watermark + seen-id set)**

This compound shape is required because Dropbox exposes three logically
independent data sources — the folder tree, shared links, and file
requests — each with a different incremental mechanism, and because file
change detection must be keyed on a stable server-issued change token
rather than on time.

### Why not a single scalar cursor

A run timestamp would force re-fetching every file every run: `server_modified`
is unreliable across moves and copies — the same file can end up with a
regressed or spuriously updated timestamp. The `folder_cursor` + `rev`
pairing eliminates both failure modes without requiring a full re-scan.

### Mount namespace coverage

Dropbox's `list_folder({ path: "", recursive: true })` walks the **root
namespace** only. Team folders and shared folders are surfaced as entries
with `object_type: "mount"` — the walk returns the mount entry itself but
does **not** descend into it. Each mount is a separate namespace that must
be listed independently using its own `ns_path`.

**Consequence for `folder_cursor`:** the opaque `folder_cursor` returned by
Dropbox is scoped per-namespace under the hood. A single `folder_cursor`
obtained from a root walk only tracks delta changes within the root
namespace; it does NOT track changes inside mounted team/shared folders.

**Per-run re-enumeration of mounts:** on every run (bootstrap and
incremental), after completing the root walk, collect all entries with
`object_type == "mount"` and enqueue each mount's `ns_path` for its own
`list_folder` / `list_folder/continue` sweep. Mounts can be added or
removed between runs, so the mount list must be re-derived each run from
the live `list_folder` response rather than cached from a previous run.

**`folder_cursor` coverage is therefore root + discovered mounts.** Each
mount namespace produces its own independent cursor, but all cursor values
are folded into the single `folder_cursor` string stored in `sync.md` — the
implementation in fetch.md uses a compound cursor that encodes both the
root cursor and each mount's cursor (see fetch.md for the exact envelope
shape). From cursor.md's perspective the invariant is: after Step 11, the
stored `folder_cursor` must encode a valid continuation point for the root
namespace and for every mount namespace visited this run.

**Stability:** a mount that was not visited last run (newly added) is
treated as bootstrap for that namespace — no prior cursor exists for it.
A mount that disappears from the listing (removed/unshared) means its
prior cursor entry is implicitly abandoned; no eviction error is needed.

### Does this source need a tracked-parent registry?

**No.** Dropbox has no first-class comment-thread API through this connector.
Collaboration signals surface only when file content changes (bumping `rev`),
which the `folder_cursor` delta already detects. Comment-only interactions
that do not change file content are undetectable — no thread-reply endpoints
exist to poll. The `files` map contains only bare file `id` keys; no
`<id>#<comment_id>` entries.

---

## Cursor shape

```yaml
# data/learnings/agntux-dropbox/sync.md — bootstrap state
cursor: null
last_run: null
last_success: null
```

```yaml
# After the first successful run
cursor: '{"folder_cursor":"AAHo1x2y3z...","files":{"id:abc123":"a1b2c3d4e5f6","id:ghi789":"f6e5d4c3b2a1"},"shared_links_cursor":"2026-06-26T10:00:00Z","file_requests_seen":["id:req001","id:req002"]}'
```

The cursor is a **JSON object serialised as a single-line string** on the
`sync.md → cursor` frontmatter key. Do not expand it to multi-line YAML —
`validate-cursor.mjs` diffs it as a scalar.

### Top-level keys

| Key | Type | Meaning |
|---|---|---|
| `folder_cursor` | opaque string | The Dropbox server-side continuation cursor returned by `list_folder` or `list_folder/continue`. Passed to `list_folder/continue` on the next run to receive only entries changed since this checkpoint. |
| `files` | JSON object | Per-file change-detection map. Each key is a Dropbox file `id` exactly as returned by the API (e.g., `"id:abc123..."`). Each value is the `rev` last successfully confirmed for that file (e.g., `"a1b2c3d4e5f6"`). |
| `shared_links_cursor` | ISO-8601 UTC string | The `server_modified` timestamp of the newest shared link processed in the most recent successful run. Applied client-side as a strict-greater-than filter when `list_shared_links` results are evaluated. |
| `file_requests_seen` | JSON array of strings | The set of file-request `id` values already raised as actions. Append-only; entries are pruned only when the corresponding request is confirmed closed (`is_open: false`). |

### `files` map keys and values

**Key:** the Dropbox `id` field exactly as returned — prefix `id:` included.
Do not normalise, truncate, or strip the prefix. The `id` field is stable
for the lifetime of the file across renames, moves, and permission changes;
it changes only if the file is deleted and a new file is uploaded in its
place.

**Value:** the `rev` exactly as returned by `get_file_metadata`. `rev` is
the opaque revision token Dropbox issues server-side and advances on any
server-side mutation — content writes, metadata-only touches, and moves.
A changed `rev` signals a server-registered mutation; re-ingest. A matched
`rev` means no change; skip. Over-detection (a metadata-only touch may bump
`rev`) is acceptable: re-ingestion produces an identical entity body and
Step 9 dedup suppresses duplicate actions.

**Why `rev` and not `content_hash` or `server_modified`:** this connector's
`list_folder` responses expose `{file_id, modified_time, name, size}` with
no `content_hash` field; `get_file_metadata` returns `rev` but also no
`content_hash`. `content_hash` is not available at the connector level — it
cannot be used. `server_modified` is unreliable across moves and copies
(a moved file may retain its old timestamp, causing misses or spurious
re-ingestion). `rev` is the only stable, server-assigned change token this
connector surfaces and is immune to both failure modes.

---

## Step 2 — Parse and validate cursor

At Step 2 (before any tool calls):

1. Read `cursor` from `data/learnings/agntux-dropbox/sync.md` frontmatter.
2. If `cursor` is null: enter bootstrap mode. Set `folder_cursor = null`,
   `files = {}`, `shared_links_cursor = null`,
   `file_requests_seen = []`.
3. If `cursor` is a non-null string: attempt `JSON.parse`.
   - On parse failure: log `dropbox-cursor-malformed` (kind: `parse`) with
     the raw cursor string truncated to 200 chars. Treat all four sub-keys
     as absent. Enter bootstrap mode. Continue the run — do not exit.
   - On parse success: extract each sub-key. If a sub-key is absent or its
     type does not match the expected type (string / object / string /
     array), treat that sub-key only as absent and continue. Log no error
     for individual missing sub-keys — this handles partial cursor writes
     from interrupted runs gracefully.
   - Specifically: if `folder_cursor` is absent or not a string, enter
     bootstrap mode for the folder walk only (Step 5a). Other sub-keys
     that parsed successfully are used normally.

Never exit the run solely because the cursor is malformed or a sub-key is
missing. Bootstrap mode is always safe for a read-only connector.

---

## Bootstrap run (folder_cursor null or absent)

Trigger: `cursor` is null OR parsed `folder_cursor` is absent OR Step 5a
receives a cursor-expired error on an incremental run.

**Discovery:**

```
list_folder({ path: "", recursive: true })
```

Page via `list_folder/continue` until `has_more` is false or the 200-file
cap is reached. Keep only file entries (`.tag == "file"`) whose
`server_modified` falls within `(now − bootstrap_window_days days, now]`.
Default `bootstrap_window_days`: **30**.

**Mount namespaces during bootstrap:** collect all entries with
`object_type == "mount"` encountered during the root walk. After the root
walk completes, issue a separate `list_folder({ path: <ns_path>, recursive:
true })` for each mount and apply the same file filter and cap accounting.
The 200-file cap is shared across root and all mount namespaces within a
single run. Each mount produces its own cursor; see fetch.md for how these
are encoded into the single `folder_cursor` value stored in `sync.md`.

**Onboarding-mode provision:** detect "first run ever" as
`last_success: null AND cursor: null` (both). On a true first run, apply a
tighter scope: cap at **50 files** (shared across root and all mounts) and
treat `bootstrap_window_days` as **14** regardless of the frontmatter
default. The first run executes synchronously during Personalization State A
wrap-up; the reduced scope keeps it under 1 minute. Do NOT apply the
onboarding cap during a cursor-expired recovery — that is not a first run.

Store the `folder_cursor` from the final `list_folder` or
`list_folder/continue` response for each namespace (even a mid-cap stop
returns a valid cursor that resumes from that point). On cap, log `source`
kind with message "file discovery cap reached; deferred to next run". The
stored cursor continues from the cap point on the next run.

---

## Incremental run (folder_cursor present)

Trigger: `cursor` parses successfully and `folder_cursor` is a non-null
string.

**Discovery:**

```
list_folder/continue({ cursor: <folder_cursor> })
```

Page via successive `list_folder/continue` calls until `has_more` is false
or the 200-file cap is reached. The cap rule from fetch.md applies: sort
ascending by `server_modified`, process the oldest 200, advance the cursor.

**Mount namespaces during incremental runs:** issue
`list_folder/continue({ cursor: <mount_cursor> })` for each mount namespace
whose cursor was stored from a prior run. Additionally, re-issue a
lightweight `list_folder({ path: "", recursive: false })` against the root
to discover any **newly added mounts** (entries with `object_type ==
"mount"` not present in the prior mount set). New mounts enter bootstrap for
that namespace (no prior cursor). Mounts that have been removed or unshared
since the last run will not appear; their cursor entries are abandoned
silently — no eviction error is needed.

The 200-file cap is shared across root continuation and all mount
continuations within the same run.

**Cursor-expired error:** on `expired_cursor` for any namespace cursor, log
`dropbox-folder-cursor-expired` (kind: `source`), set that namespace's cursor
to null, fall back to a fresh `list_folder` for that namespace bounded by
`bootstrap_window_days`. Do NOT exit. The `files` map (rev tokens) is
preserved; unchanged files are skipped via Step 5b `rev` comparison.

---

## Per-file change test (both incremental and bootstrap)

For each file entry (`.tag == "file"`) collected in Step 5a:

| Condition | Action |
|---|---|
| `file.id` absent from `cursor.files` | Process as **new file** |
| `file.id` present AND `file.rev` differs from stored value | Process as **changed file** (server-registered mutation) |
| `file.id` present AND `file.rev` matches stored value | **Skip** re-ingestion; still update the `files` entry at Step 11 (confirms the entry is current) |

A file that surfaces in a `list_folder/continue` delta with the same `rev`
as the stored value represents a case where Dropbox surfaced the entry in
the delta without advancing its revision token — treat as no change. It
MUST NOT generate a new action item.

Note: `rev` is obtained from `get_file_metadata` (called per file at Step
5b). The `list_folder/continue` delta entry does not include `rev`; use it
only to identify which file IDs need the Step 5b metadata call, then
compare the returned `rev` against the stored value.

Folder entries (`.tag == "folder"`) and deleted entries (`.tag ==
"deleted"`) are handled separately per fetch.md and do not consume the
200-file cap or enter the `files` map.

---

## Shared-links cursor advance rule

`list_shared_links` returns all shared links for the account; there is no
server-side `since` parameter. The client-side gate:

```
process link if: link.server_modified > cursor.shared_links_cursor
                 (or if shared_links_cursor is null — process all)
```

Use `server_modified` where available; fall back to `client_modified` only
if `server_modified` is absent. Parse to ISO-8601 UTC before comparison.

At Step 11, advance `shared_links_cursor` to
`max(server_modified or client_modified)` across all shared links
**successfully processed** this run (entity written, action raised or
deliberately suppressed). Do not advance if `list_shared_links` itself
failed — leave `shared_links_cursor` at its pre-run value so no links are
skipped on the next run.

---

## File-requests seen-id set advance rule

`list_file_requests` returns all active requests; there is no delta
mechanism. The seen-id set acts as the incremental gate: raise an action
only for IDs not in `cursor.file_requests_seen`.

At Step 11, append newly raised file-request IDs to `file_requests_seen`.
Prune entries for requests confirmed closed: if `get_file_request` returns
`is_open: false` for an ID already in the set, remove it — a re-opened
request with the same ID will be caught as "absent from set" on a future
run. Do not remove entries for requests that were simply absent from the
`list_file_requests` response (absence may be transient).

---

## Step 11 — Transactional cursor advance

All four sub-keys advance together in a single atomic write. The gate:
**advance only when every action write this run succeeded.**

If any action write in Step 10 failed (validator hook rejection, MCP tool
failure, lock contention), record the failure in `sync.md → errors`
(FIFO-bounded, last 10 entries), re-attempt up to the per-plugin retry
budget, and **leave `cursor` at its entire pre-run value** if any writes
remain failed. The next scheduled run retries from the pre-failure state.

**Exception — content-unavailable soft skip:** a file skipped because
`fetch` returned an error and `file_preview` was used as fallback
(`dropbox-content-unavailable`) is a soft skip, not a write failure. Its
`files` entry IS updated (we confirmed its `rev` via `get_file_metadata`),
and other files' successful writes are not blocked. The cursor still
advances if all non-content-available-failed files wrote successfully.

**Exception — metadata-missing:** a file whose `get_file_metadata` call
failed but whose entity and action item were written successfully
(`dropbox-metadata-missing`) is treated as successfully processed. The
cursor advances normally for that file.

Per-sub-key advance details:

| Sub-key | Advance to | Condition |
|---|---|---|
| `folder_cursor` | Cursor from the final `list_folder/continue` response this run (even a mid-cap stop yields a valid cursor) | All action writes succeeded |
| `files` | For each file processed (new, changed, or unchanged-but-confirmed): update to current `rev` (from Step 5b `get_file_metadata`). For files skipped (unchanged `rev`): update to current `rev` to confirm freshness. For evicted files: remove from map. | All action writes succeeded |
| `shared_links_cursor` | `max(server_modified or client_modified)` across shared links processed this run | All action writes succeeded AND `list_shared_links` did not fail |
| `file_requests_seen` | Append newly raised IDs; prune confirmed-closed IDs | All action writes succeeded AND `list_file_requests` did not fail |

### Cursor diff log line (Step 11)

```
cursor advance — folder_cursor: advanced; files: added: N, advanced: M, evicted: K; shared_links_cursor: {old} → {new}; file_requests_seen: appended: P, pruned: Q
```

Use `0` for any count with no changes. On a zero-change run:

```
cursor advance — (no change; list_folder/continue returned 0 changed entries)
```

---

## `files` map maintenance (Step 11)

After the transactional gate passes:

1. **Add** entries for file IDs that were new this run, set to the `rev`
   returned by Step 5b `get_file_metadata`.
2. **Update** entries for file IDs that were changed this run, set to the
   new `rev` from `get_file_metadata`.
3. **Confirm** entries for file IDs that were unchanged (same `rev`) —
   overwrite the stored value with the same value. This touch confirms the
   entry is live and resets the implicit staleness clock.
4. **Retain** entries for file IDs NOT returned by `list_folder/continue`
   this run — absence from a delta response means the file has not changed,
   not that it has been deleted. The `deleted` tag is the explicit deletion
   signal.
5. **Evict** entries when a `deleted` entry with matching `id` appears in
   the delta, OR when `get_file_metadata` or `fetch` returns a permanent
   not-found or access-revoked error (HTTP 404/403 with no retry path).
   Log `dropbox-cursor-evicted` (kind: `source`) with the file `id` and
   its last-known `rev`. Close any open action referencing that
   file's entity.

The `files` map has no time-based eviction window. The 30-day
tracked-parent eviction rule from the source-semantics advisor does not
apply here — the `files` map is a content-change index, not a
parent-reply tracker. Entries accumulate for all files ever ingested and
are removed only on confirmed deletion or access revocation.

---

## Eviction and expiry recovery summary

| Condition | Detected at | Action |
|---|---|---|
| `cursor: null` | Step 2 | Bootstrap mode; no error logged |
| `cursor` present but not valid JSON | Step 2 | Log `dropbox-cursor-malformed` (kind: `parse`); bootstrap mode; continue run |
| `cursor` valid JSON but `folder_cursor` absent or wrong type | Step 2 | Bootstrap folder walk; use other sub-keys as parsed |
| `cursor.folder_cursor` expired by Dropbox | Step 5a (`expired_cursor` error) | Log `dropbox-folder-cursor-expired` (kind: `source`); fresh `list_folder` from root; continue run; `files` map preserved |
| `cursor.files` absent or wrong type | Step 2 | Treat as `{}`; all files' `rev` values unknown; process all as new this run |
| `cursor.shared_links_cursor` absent or not ISO-8601 | Step 2 | Process all shared links (no watermark); advance normally at Step 11 |
| `cursor.file_requests_seen` absent or not array | Step 2 | Treat as `[]`; raise actions for all open requests |
| File id in `files` but `deleted` tag in delta | Step 5a | Evict from `files` map (removing stored `rev`); log `dropbox-cursor-evicted` |
| File id in `files` but 404/403 on fetch | Step 5b | Evict from `files` map (removing stored `rev`); log `dropbox-cursor-evicted` |
| Shared link not-found on `get_shared_link_metadata` | Step 5c | Log `dropbox-shared-link-revoked` (kind: `source`); skip link; continue |

---

## Workspace identifier capture (deep links)

Dropbox deep links do not include a per-tenant subdomain. Instead, the
link template is based on the file's `path_lower`:

```
https://www.dropbox.com/home{path_lower}
```

For files with a shared link, use the `url` returned by
`list_shared_links` as the canonical `viewUrl`. For files without one,
fall back to the `https://www.dropbox.com/home{path_lower}` template. For
files where `file_preview` succeeds, use the preview URL as `viewUrl`.

No per-tenant workspace identifier is required because Dropbox URLs are
path-rooted rather than subdomain-scoped. The `path_lower` is returned in
every `list_folder` entry and is stable within the account (it changes only
on rename or move — re-fetched on next delta via `folder_cursor`).

Persist `viewUrl` on the entity at Step 5b/5c. Do not persist a workspace
identifier in `sync.md` frontmatter for this source.

---

## `_sources.json` lookup-before-write protocol

The lookup-before-write protocol from Step 6 fully applies.

- **File/folder entities** — look up by `(subtype: {derived-subtype},
  source: dropbox, source_id: "{file.id}")`. Use the Dropbox `id` field
  (e.g., `"id:abc123..."`) as `source_id`. Derived subtypes from fetch.md:
  `document`, `spreadsheet`, `presentation`, `pdf`, `file`, `folder`,
  `other`, `shared-link`, `file-request`.
- **Person entities** from `sharing_info.modified_by` — look up by
  `(subtype: person, source: dropbox, source_id: "{email}")`. Email is the
  canonical cross-source alias. If `sharing_info` returns an email, use it
  as `source_id` so the person resolves against existing entities from Gmail
  or Slack. Do not create a duplicate person entity for the same email.
- Do NOT write to `_sources.json` directly — the PostToolUse hook owns it.

---

## No auto-learned denylist

Files enumerated by `list_folder/continue` are already scoped to the
authenticated user's accessible namespace. The delta mechanism means only
genuinely changed files surface on incremental runs; the `files` map
suppresses unchanged files. The noise floor is low enough that explicit
`# Never raise` curation in `data/instructions/agntux-dropbox.md` is
sufficient. The auto-learned denylist pattern is not applied.

---

## sync.md template

Bootstrap state:

```yaml
---
plugin: agntux-dropbox
version: 0.1.0
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

After the first successful run (onboarding mode, 14-day window, 50-file
cap, 23 files processed):

```yaml
---
plugin: agntux-dropbox
version: 0.1.0
cursor: '{"folder_cursor":"AAHo1x2y3z4AABcDEF...","files":{"id:abc123":"a1b2c3d4e5f6","id:ghi789":"f6e5d4c3b2a1"},"shared_links_cursor":"2026-06-12T08:30:00Z","file_requests_seen":["id:req001"]}'
last_run: "2026-06-26T16:15:00Z"
last_success: "2026-06-26T16:15:00Z"
items_processed: 23
lock: null
errors: (none)
---
```

---

## Self-validation against fetch.md

Key invariants confirmed by this file:

- Four-part cursor shape, Step 2 parse/bootstrap, incremental and bootstrap run procedures: all per the corresponding named sections above.
- Change key is `rev` (from `get_file_metadata`), NOT `content_hash` (not exposed by this connector) and NOT `server_modified` — rationale in the `files` map keys and values section.
- Mount entries (`object_type: "mount"`) are NOT auto-descended; each mount requires a separate recursive `list_folder` against its `ns_path`; mount list re-derived every run — covered by the Mount namespace coverage section.
- Per-file change test (new / changed / unchanged) keyed on `rev`: per-file change test section.
- Transactional advance (all sub-keys advance together; partial failure leaves entire cursor unchanged): Step 11 section.
- Eviction (`dropbox-cursor-evicted`, `dropbox-folder-cursor-expired`, `dropbox-cursor-malformed`, `dropbox-shared-link-revoked`): eviction and expiry recovery summary table.
