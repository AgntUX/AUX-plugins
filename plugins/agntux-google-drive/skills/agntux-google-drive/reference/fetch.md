# Google Drive fetch — Step 5 orchestration

Wholesale override for `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
Google Drive uses a two-phase shape: discover changed files via a server-side
modifiedTime query (Step 5a), then fetch body + metadata per changed file
(Step 5b). Three kinds of action items are raised from the resulting content:
doc-changed, doc-updated-by-someone, and mention. This plugin is read-only —
no write tools are called.

## Step 5 — Fetch from Google Drive

Call the tools listed below using the host-resolved names (the host
UUID-prefixes them at runtime; call them by whatever name the host exposes).
All cursors are read from `data/learnings/agntux-google-drive/sync.md → cursor`
at Step 2. The cursor is a JSON object; parse it at Step 2 and keep `watermark`
and `files` in scope for Step 5. Bootstrap state: `cursor: null`.

This plugin is **read-only**: do NOT call `download_file_content` or any write
tool during ingest. Prefer `read_file_content` over `download_file_content` for
all body fetches.

---

### Step 5a — Discover changed files

**Incremental run (cursor non-null and watermark key present):**

```
search_files({
  query: "modifiedTime > '{watermark}'",
  pageSize: 50
})
```

where `{watermark}` is the `cursor.watermark` value (an ISO-8601 UTC string
exactly as stored — e.g. `"2026-06-19T10:00:00Z"`). The Drive API RFC 3339
query format matches ISO-8601 UTC directly; no conversion is needed.

Page using `pageToken` until all results are returned or the run cap of
**100 files** is reached (whichever comes first). If the cap is reached
mid-page, stop, log `google-drive-rate-limited` (kind: `source`) with
`message: "file discovery cap reached; remainder deferred to next run"`,
and proceed to Step 5b with the files discovered so far. Do NOT advance
the watermark in Step 11 unless every action write this run succeeded.

**Bootstrap run (cursor null OR watermark absent):**

```
list_recent_files({
  orderBy: "recency",
  pageSize: 50,
  excludeContentSnippets: false
})
```

Page until all files within the bootstrap window are collected or the
100-file cap is reached. Apply a client-side filter: keep only files whose
`modifiedTime` falls within `(now − bootstrap_window_days days, now]`.
Default `bootstrap_window_days` is **30** (declared in `frontmatter.yaml`;
user-overridable via `user.md → bootstrap_window_days`).

**Per-file change test (for both incremental and bootstrap runs):**

After the discovery step, for each file in the result set:

1. Look up the file's `id` in `cursor.files` (the per-file map).
2. **New file** (id absent from map): always process — it has not been seen
   before.
3. **Changed file** (id present AND new `modifiedTime` strictly greater than
   stored value): process — a genuine content change.
4. **Already-current file** (id present AND new `modifiedTime` equal to or
   less than stored value): skip — the server may have returned this file
   due to an index delay or other artifact; no action should be raised.

This per-file map test is the primary deduplication gate at Step 5.

**Folder exclusion (Rule 1):** After the change test, inspect each file's
`mimeType`. If `mimeType` is `application/vnd.google-apps.folder`, **skip
the file entirely** — do NOT proceed to Step 5b for it, do NOT create a
knowledge entity for it, and do NOT raise doc-changed or mention actions for
it. Still add/update its entry in `cursor.files` (so it is not reconsidered
on the next run), then continue to the next file. Folders are containers with
no readable knowledge content; child files appear in their own search results
when modified.

---

### Step 5b — Fetch file body and metadata

For each file that passes the Step 5a change test (and is not a folder),
determine the file's content class before deciding which tools to call:

**Text-extractable mimeTypes** (full fetch — body + change summary + mention scan):
- `application/vnd.google-apps.document`
- `application/vnd.google-apps.spreadsheet`
- `application/vnd.google-apps.presentation`
- `application/pdf`
- Office/ODF formats: `application/vnd.openxmlformats-officedocument.*`,
  `application/vnd.oasis.opendocument.*`
- Plain text / markdown: `text/plain`, `text/markdown`, `text/csv`

**Binary/metadata-only mimeTypes** (Rule 2 — metadata fetch only, no content read):
Everything else — `image/*`, `video/*`, `audio/*`, archives, proprietary
binary formats. These get a lightweight entity (title, subtype `other`,
owner, modifiedTime, createdTime, viewUrl) but no `read_file_content` call,
no content body or change summary, and no mention scan.

#### Text-extractable files — full fetch

**Body fetch (required):**

```
read_file_content({
  fileId: <file.id>,
  includeComments: true
})
```

Always pass `includeComments: true`. The connector inlines comments into
the body response; this is the surface through which mention detection
(Step 5c) operates. A separate comments API call is not available and not
needed.

If `read_file_content` returns an empty body or an access-denied result,
log `google-drive-content-unavailable` (kind: `source`) with the fileId and
title, skip this file for the run, and continue. Do NOT update the
`cursor.files` entry for a skipped file (leave it at its prior value so
the next run retries).

**Metadata fetch (for author attribution — selective):**

```
get_file_metadata({ fileId: <file.id> })
```

Call `get_file_metadata` for every text-extractable file that passes the
Step 5a change test. Extract the `lastModifyingUser` field (typically a name
+ email object). If `lastModifyingUser` is absent or null, log
`google-drive-metadata-missing` (kind: `source`) with the fileId, and
proceed without author attribution — omit the "who updated it" phrase from
the action title and body rather than claiming an unknown author. Do NOT skip
the file because metadata is missing; content is still actionable.

**Permissions fetch (for new files only):**

```
get_file_permissions({ fileId: <file.id> })
```

Call `get_file_permissions` **only for new files** (id absent from
`cursor.files` at Step 5a time). For already-known changed files, skip the
permissions call — sharing state is unlikely to change between runs and the
call adds latency. Store the permissions summary in the entity body
(`## Permissions` section) on first write; update it only if you detect a
new share event from file metadata.

#### Binary/metadata-only files (Rule 2)

For files whose mimeType is NOT in the text-extractable list above:

1. Call `get_file_metadata({ fileId: <file.id> })` to capture owner,
   modifiedTime, createdTime, and the `webViewLink` (viewUrl).
2. Do NOT call `read_file_content` or `download_file_content`.
3. Create a lightweight knowledge entity with:
   - `title`: file name
   - `subtype`: `other`
   - `mimeType`: verbatim from the API
   - `owner`: from metadata
   - `modifiedTime`, `createdTime`: from metadata
   - `viewUrl`: the `webViewLink` from metadata (the "Open in Google Drive"
     link — always capture this so the user can click through)
4. Do NOT produce a content summary or change-summary body section.
5. Do NOT perform mention scanning (there is no text to scan).
6. Do NOT raise doc-changed or doc-updated-by-someone action items for
   binary files — there is no extractable text to summarize.
7. Still add/update the file's entry in `cursor.files` (so it is not
   reprocessed on the next run).
8. If `get_file_metadata` fails for a binary file, log
   `google-drive-metadata-missing` (kind: `source`) with the fileId, skip
   entity creation for this file, and continue.

**Subtype mapping:**

| mimeType | Entity subtype | Fetch class |
|---|---|---|
| `application/vnd.google-apps.document` | `document` | text-extractable |
| `application/vnd.google-apps.spreadsheet` | `spreadsheet` | text-extractable |
| `application/vnd.google-apps.presentation` | `presentation` | text-extractable |
| `application/pdf` | `pdf` | text-extractable |
| Office/ODF/text/markdown types | `document` or `other` | text-extractable |
| `application/vnd.google-apps.folder` | `folder` | **excluded** (Rule 1 — skip entirely) |
| anything else (`image/*`, `video/*`, binary, etc.) | `other` | binary/metadata-only (Rule 2) |

Always record the raw `mimeType` alongside the derived subtype in the entity body.

**Entity fields to capture:**

| Field | Text-extractable | Binary/metadata-only |
|---|---|---|
| `title` | yes | yes |
| `fileId` | yes | yes |
| `subtype` | derived from mimeType | `other` |
| `mimeType` | verbatim | verbatim |
| `owner` | yes | yes |
| `modifiedTime` | yes | yes |
| `createdTime` | yes | yes |
| `viewUrl` | `webViewLink` from API | `webViewLink` from API |
| `parentId` | if available | omit |
| `lastModifyingUser` | from `get_file_metadata` or `null` | omit |
| `permissionsSummary` | sharing state summary | omit |
| `contentSnippet` | ≤ 300 chars from body | omit |

**Entity slug derivation.** Drive file titles can be long. Slug: take the
first 6 meaningful words of the title, lowercase, hyphen-separated, capped at
60 chars, with the first 8 chars of the `fileId` appended to guarantee
uniqueness (e.g. `quarterly-review-q2-2026-a1b2c3d4`). Keep the full title
as the entity's display name.

---

### Step 5c — Identify action items

For each **text-extractable** file processed in Steps 5a–5b, evaluate the
following three action signals in order. Binary/metadata-only files (Rule 2)
and folders (Rule 1) are excluded from all signal evaluation. A single file
may generate both a doc-changed/doc-updated-by-someone action AND a mention
action if both conditions hold — raise each as a separate action item with a
distinct `source_id`.

#### Signal 1 — doc-changed (change detected, author unknown or omitted)

Condition: the file passed the Step 5a change test (modifiedTime advanced past
the stored value) AND `get_file_metadata` did not return a valid
`lastModifyingUser`.

Action item shape:

```yaml
title: '"{title}" was updated'
kind: knowledge-update
source_id: google-drive:changed:{fileId}
suggested_actions:
  - label: "Open in Google Drive"
    url: "{viewUrl}"
```

Body section: include a SHORT summary (≤ 5 sentences) of the file's current
content produced by summarising the `read_file_content` result. Open with a
single sentence like "Content as of {modifiedTime}:". Do NOT claim line-level
diff visibility — the connector exposes no revision history. Do not use phrases
like "the following changes were made" or "this section was edited". Summarise
what the document currently says, not what changed.

#### Signal 2 — doc-updated-by-someone (change detected, author known)

Condition: the file passed the Step 5a change test AND `get_file_metadata`
returned a valid `lastModifyingUser` with a non-empty display name or email.

Action item shape:

```yaml
title: '"{title}" was updated by {lastModifyingUser.displayName}'
kind: knowledge-update
source_id: google-drive:changed:{fileId}
suggested_actions:
  - label: "Open in Google Drive"
    url: "{viewUrl}"
```

Use `lastModifyingUser.displayName` if non-empty; fall back to
`lastModifyingUser.emailAddress` if display name is absent. If both are
absent, fall back to Signal 1 (doc-changed) instead of this signal.

Body section: identical shape to Signal 1 — a SHORT content summary. Add one
sentence: "Last modified by {displayName or emailAddress}." Do NOT add
speculation about what the person changed.

**Signal 1 and Signal 2 are mutually exclusive for a given fileId on a given
run.** Use Signal 2 when author data is available; Signal 1 otherwise. Both
share the same `source_id` (`google-drive:changed:{fileId}`), so the dedup
check at Step 9 treats them as the same change event — do NOT raise one of
each for the same file on the same run.

#### Signal 3 — mention (comment or assignment references the user)

Condition: `read_file_content(includeComments=true)` returns a comment or
suggestion text that mentions the current user.

**Resolve the user's identity from `user.md`** (read at Step 1 preflight).
Extract the user's primary email address and any display names or aliases
listed in `user.md`. Match against ALL of the following (case-insensitive):

- The user's primary email address (from `user.md`)
- The user's display name or first name as a standalone word (not a substring
  of a longer name — e.g. match "Jordan" only as a whole word)
- Any aliases listed in `user.md`

Do NOT hardcode any specific email address, name, or alias in this skill —
always derive the match set from `user.md` at runtime. Apply the match to
comment bodies, suggestion text, and inline @-mention strings surfaced by the
connector. If multiple comments in the same file match, group them into a
single mention action item for that file (do not raise one action per comment).

Action item shape:

```yaml
title: 'You were mentioned in "{title}"'
kind: response-needed
source_id: google-drive:mention:{fileId}
suggested_actions:
  - label: "Open in Google Drive"
    url: "{viewUrl}"
```

Body section: quote the matching comment(s) verbatim, one per bullet, capped
at 300 chars per comment. Include the commenter's name if available. Example:

```
- @[User] can you review the Q3 numbers in section 2? — Jordan Lee
- [User], I've left a suggestion on paragraph 4. — Sam Rivera
```

**Mention deduplication across runs.** A mention action is raised once per
fileId until the action is closed or dismissed. Before raising, check
`_sources.json` and `actions/_index.md` for an existing open action with
`source_id: google-drive:mention:{fileId}`. If one exists, update the entity
body with any new comment snippets but do NOT raise a duplicate action.

**Note on new-file mentions.** A new file (first time seen) may also trigger
a mention if its body already contains a matching comment. Raise both the
doc-changed/doc-updated-by-someone action AND the mention action if both
signals apply — they carry distinct `source_id` values and represent distinct
affordances (reading the document vs responding to the comment).

---

### Step 5 summary — on fetch failure

On any failure from any Google Drive tool call:

- Log to `data/learnings/agntux-google-drive/sync.md → errors` with kind
  `network | auth | parse | source | internal` (or the google-drive-specific
  extension from the permitted-error-kinds list in `frontmatter.yaml`).
- Slice the errors list to the last 10 entries (newest-first) before writing.
- On `auth` failure: release the lock and exit. Do NOT proceed to Step 5b.
- On `network` failure during discovery (Step 5a): release the lock and exit.
  Step 11's transactional rule keeps the cursor at its pre-run value.
- On `read_file_content` failure for a specific file: log
  `google-drive-content-unavailable`, skip that file, and continue with
  remaining files. Do NOT advance that file's cursor.files entry.
- On `get_file_metadata` failure for a text-extractable file: log
  `google-drive-metadata-missing`, omit author attribution for that file,
  and continue.
- On `get_file_metadata` failure for a binary/metadata-only file: log
  `google-drive-metadata-missing`, skip entity creation for that file,
  and continue.
- On connector quota / rate-limit (429 or similar): log
  `google-drive-rate-limited` (kind: `source`), stop fetching for this run,
  release the lock. Do NOT advance the watermark.

---

## Cursor shape for Google Drive

The cursor is a JSON object serialised as a single-line string on the
`sync.md → cursor` key:

```yaml
# data/learnings/agntux-google-drive/sync.md — bootstrap state
cursor: null
last_success: null
```

```yaml
# After the first successful run
cursor: '{"watermark":"2026-06-19T10:00:00Z","files":{"1abc...":"2026-06-19T09:50:00Z","2def...":"2026-06-18T14:00:00Z"}}'
```

| Field | Type | Meaning |
|---|---|---|
| `watermark` | ISO-8601 UTC string | Newest `modifiedTime` across all files processed this run. Feeds `search_files(modifiedTime > watermark)` on the next run. |
| `files` | JSON object | Per-fileId map. Each key is a Drive `id`; each value is the ISO-8601 UTC `modifiedTime` last successfully processed for that file. |

Parse the cursor JSON at Step 2. If `cursor` is null (bootstrap) or
unparseable, log `google-drive-cursor-malformed` (kind: `parse`) and treat
both `watermark` and `files` as absent (fall back to bootstrap discovery).

**Watermark advance (Step 11):** Set `watermark` to `max(modifiedTime)` across
all files successfully processed this run. Update each successfully processed
file's entry in `files` to that file's current `modifiedTime`. Advance only
when every action write this run succeeded (transactional rule). If any write
failed, leave `cursor` at its pre-run value.

**Files-map maintenance:**
- Add new fileIds to `files` on first successful processing.
- Update existing fileId values when the file's modifiedTime advances.
- On successful processing of a file that raised no action (e.g. a binary
  file processed as metadata-only per Rule 2, or a folder skipped per Rule 1),
  still add/update its `files` entry so it is not reprocessed on the next run.
- Evict a fileId from `files` when `read_file_content` or `get_file_metadata`
  returns a permanent not-found or access-revoked result. Log
  `google-drive-cursor-evicted` (kind: `source`) with the fileId.

Bootstrap state (full sync.md template):

```yaml
---
plugin: agntux-google-drive
version: 0.1.0
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

---

## Deduplication

Before raising any action item at Steps 8–9, look up the candidate `source_id`
in `_sources.json` and `actions/_index.md`:

- An existing **open** action with the same `source_id` is the same event.
  Do NOT raise a new action. Update the entity body if the upstream content
  has changed (new summary, new modifiedTime, new commenter).
- An existing **closed or dismissed** action with the same `source_id` may
  be re-raised if the file has been modified again after the prior action was
  closed (i.e., the new `modifiedTime` strictly exceeds the `modifiedTime`
  recorded in the prior action's entity body).
- No existing action → create a new action item normally.

**Doc-changed vs mention actions share separate source_id namespaces:**
`google-drive:changed:{fileId}` and `google-drive:mention:{fileId}`. A file
can have one open action of each type simultaneously without conflict.

---

## Entity subtype mapping table

| mimeType | Subtype | Plain-language label | Fetch class |
|---|---|---|---|
| `application/vnd.google-apps.document` | `document` | "document" | text-extractable |
| `application/vnd.google-apps.spreadsheet` | `spreadsheet` | "spreadsheet" | text-extractable |
| `application/vnd.google-apps.presentation` | `presentation` | "presentation" | text-extractable |
| `application/pdf` | `pdf` | "PDF" | text-extractable |
| Office/ODF/text/markdown types | `document` or `other` | "file" | text-extractable |
| `application/vnd.google-apps.folder` | `folder` | "folder" | **excluded** — no entity created, no action raised (Rule 1) |
| anything else (`image/*`, `video/*`, binary, etc.) | `other` | "file" | binary/metadata-only — entity with viewUrl, no content or actions (Rule 2) |

---

## Suggested actions per signal type

All three signal types (doc-changed, doc-updated-by-someone, mention) use
the same single URL action — no `host_prompt` entries (this plugin is
read-only and ships no write handler):

```yaml
suggested_actions:
  - label: "Open in Google Drive"
    url: "{viewUrl}"
```

`viewUrl` is the `webViewLink` captured during Step 5b. For mention actions,
the action item body carries the quoted comment snippet(s) so the user can
read the mention context before navigating.

---

## Failure modes

| Symptom | kind | Action |
|---|---|---|
| `search_files` auth failure | `auth` | exit, release lock, retry next run |
| `list_recent_files` auth failure | `auth` | exit, release lock, retry next run |
| `search_files` network failure | `network` | exit, release lock, retry next run |
| Connector quota / 429 / rate-limit | `source` + `google-drive-rate-limited` | stop, exit, release lock; do NOT advance watermark |
| `read_file_content` returns empty or access-denied for one file | `source` + `google-drive-content-unavailable` | skip file, log, continue with remaining files |
| `get_file_metadata` returns no `lastModifyingUser` (text-extractable file) | `source` + `google-drive-metadata-missing` | omit author attribution, continue |
| `get_file_metadata` fails for a binary/metadata-only file | `source` + `google-drive-metadata-missing` | skip entity creation for this file, log, continue |
| `get_file_permissions` fails | `network` or `source` | log, omit permissionsSummary for this file, continue |
| File deleted / access revoked (permanent 404 / 403) | `source` + `google-drive-cursor-evicted` | evict fileId from cursor.files, log, continue |
| `cursor` JSON malformed | `parse` + `google-drive-cursor-malformed` | fall back to bootstrap discovery, log, continue |
| Discovery cap (100 files) reached mid-page | `source` | log deferred count, proceed to Step 5b with files so far; do NOT advance watermark if any write fails |
| Folder encountered in result set | — | skip entirely per Rule 1; update cursor.files entry; no log needed |
| Binary/image/video file encountered | — | metadata-only path per Rule 2; no content fetch; no action raised |
