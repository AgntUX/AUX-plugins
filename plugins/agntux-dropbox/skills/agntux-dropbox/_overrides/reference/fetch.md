# Dropbox fetch — Step 5 orchestration

Wholesale override for `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
Dropbox uses a three-phase shape: walk the folder tree via the server-side
list_folder cursor (Step 5a), fetch metadata and text content per changed file
(Step 5b), then sweep shared links and file requests for action-worthy events
(Step 5c). Read-only — no write tools are called during ingest.

All cursor sub-keys (`folder_cursor`, `files`, `shared_links_cursor`,
`file_requests_seen`) are read from `data/learnings/agntux-dropbox/sync.md →
cursor` at Step 2. Parse the cursor JSON at Step 2 and keep all four sub-keys
in scope. Bootstrap state: `cursor: null`.

---

### Step 5a — Walk the Dropbox folder tree

**Incremental run (folder_cursor present):**

```
list_folder/continue({ cursor: <folder_cursor> })
```

Page via successive `list_folder/continue` calls until `has_more` is false.
Apply a **run cap of 200 file entries** (folder entries excluded from cap): if
the cap is reached before `has_more` is false, stop, log `dropbox-rate-limited`
(kind: `source`, message: "file discovery cap reached; deferred to next run"),
and proceed to Step 5b with files collected. The cursor from the last response
is valid even at a mid-cap stop.

**Cursor-expired error:** Log `dropbox-folder-cursor-expired` (kind: `source`),
then fall back to a fresh `list_folder` from root bounded by
`bootstrap_window_days`. Do NOT exit — continue the run with the fresh listing.

**Bootstrap run (cursor null OR folder_cursor absent OR cursor malformed):**

If the cursor string is non-null but unparseable, log `dropbox-cursor-malformed`
(kind: `parse`). Then call:

```
list_folder({ path: "", recursive: true })
```

Page until `has_more` is false or the 200-file cap is reached. Keep only file
entries (`.tag == "file"`) whose `server_modified` falls within
`(now − bootstrap_window_days days, now]`. Default `bootstrap_window_days`:
**30** (user-overridable via `user.md → bootstrap_window_days`).

Store the cursor from the final list_folder/continue response as `folder_cursor`
for Step 11.

**Mount detection and recursive walk (both bootstrap and incremental):**

After collecting entries from the root walk, detect every entry with
`.object_type == "mount"` (team folders, shared-folder mounts, and
namespace roots surfaced as mount-type entries). These entries are NOT
automatically descended by the root `list_folder({ path: "", recursive: true })`
call — their contents are only accessible by issuing a separate recursive
`list_folder` against each mount's own namespace path (`entry.path`, form
`"ns:<id>//<name>"`). For each mount entry:

1. Enqueue a fresh `list_folder({ path: entry.path, recursive: true })`.
2. Page via `list_folder/continue` until `has_more` is false or the shared
   200-file run cap is exhausted (cap is global across root + all mounts).
3. Recurse transitively: if any entry within a mount also has
   `.object_type == "mount"`, enqueue it the same way.
4. De-duplicate by `file.id`: if the same file `id` appears via more than one
   namespace path, process it exactly once (first occurrence wins; subsequent
   occurrences with the same `id` are skipped).

Apply the same per-file change test below to all file entries regardless of
whether they came from the root walk or a mount walk.

**Per-file change test (both incremental and bootstrap):**

For each file entry (`.tag == "file"`) collected in Step 5a (root + mounts):

1. Look up the file's `.id` in `cursor.files`.
2. **New** (id absent): process.
3. **Changed** (id present AND new `rev` ≠ stored value): process.
4. **Unchanged** (id present AND `rev` matches): skip re-ingestion;
   still update the files-map entry at Step 11.

**Change key — `rev`, not `content_hash`:** this connector's `list_folder`
entries expose `{file_id, modified_time, name, size}` with NO `content_hash`
field. `get_file_metadata` returns `rev` (e.g., `"016552eabad06e70000000362a07e03"`)
but also does NOT expose `content_hash`. Because `content_hash` is never
present in this connector's responses, using it as a change key would leave
every file permanently in "unknown" state — they would re-ingest on every run.
Use `rev` as the sole change key. `rev` advances on any server-side mutation
(content edits, moves, metadata writes); this may produce occasional
over-detection (a metadata-only touch triggers re-ingest) but never under-detection
(a genuine content change is always caught). Do NOT use `content_hash` anywhere
in this plugin — it is intentionally absent from this connector.

**Folder entries** (`.tag == "folder"`): create/update a lightweight `folder`
entity; do NOT call `fetch` or `get_file_metadata`; do not consume the file cap.

**Deleted entries** (`.tag == "deleted"`): if the id is in `cursor.files`, log
`dropbox-cursor-evicted` (kind: `source`), remove from files map, close any open
action referencing that entity. Do not consume the file cap.

---

### Step 5b — Fetch file metadata and text content

For each file passing the Step 5a change test, classify by file type:

**Text-extractable** (full fetch — metadata + body + signals):
- Text/markup: `.txt`, `.md`, `.markdown`, `.rst`, `.html`, `.htm`, `.csv`, `.tsv`
- Documents: `.docx`, `.doc`, `.odt`, `.rtf`, `.pages`
- Spreadsheets: `.xlsx`, `.xls`, `.ods`, `.numbers`
- Presentations: `.pptx`, `.ppt`, `.odp`, `.key`
- PDF: `.pdf`
- Code/config: `.py`, `.js`, `.ts`, `.json`, `.yaml`, `.yml`, `.toml`, `.xml`,
  `.sh`, `.sql`

**Binary/metadata-only** (Rule 2 — no `fetch` call): images, video, audio,
archives, executables, and anything not in the text-extractable list above. If
the extension is absent or unrecognised, attempt `fetch` once; use its result
to determine the class.

#### Text-extractable files

**Metadata:**

```
get_file_metadata({ path: <entry.path_lower> })
```

Capture: `id`, `name`, `path_lower`, `size`, `client_modified`,
`server_modified`, `rev`, `sharing_info`. (`content_hash` is not surfaced
by this connector; do not attempt to capture it.) On failure, log
`dropbox-metadata-missing` (kind: `source`); omit `sharing_info`/`rev` but
continue the body fetch — list_folder entry metadata is sufficient.

**Body:**

```
fetch({ path: <entry.path_lower> })
```

- Succeeds with body: use for entity content and Signal 3 mention scan. Capture
  any Dropbox link in the response as `viewUrl`.
- Fails or empty body: log `dropbox-content-unavailable` (kind: `source`). Call
  `file_preview` to obtain `viewUrl`. Create a metadata-only entity; skip
  Signals 1/2/3 for this file.
- Body appears truncated (>5 MiB file): note "content may be truncated" in the
  entity body; still advance the files-map entry.

**Shared-link capture:** After the body fetch, call
`list_shared_links({ path: <entry.path_lower> })`. If any links are returned,
record the first `url` as `sharedLinkUrl` on the entity.

#### Binary/metadata-only files (Rule 2)

1. Call `file_preview({ path: <entry.path_lower> })` to obtain `viewUrl`.
2. Create a lightweight entity: `title` (name), `subtype: other`,
   `fileExtension`, `size`, `server_modified`, `viewUrl`, `path`.
3. No `fetch`, no content summary, no Signals 1/2/3.
4. Still update the `files`-map entry with the current `rev`.
5. If `file_preview` fails: log `dropbox-metadata-missing`, use
   `https://www.dropbox.com/home{path}` as `viewUrl` fallback.

#### Subtype mapping

| Entry / extension group | Entity subtype | Fetch class |
|---|---|---|
| `.tag == "folder"` | `folder` | metadata-only (no rev entry; not in files map) |
| `.docx`, `.doc`, `.odt`, `.rtf`, `.pages`, `.txt`, `.md`, `.rst`, `.html` | `document` | text-extractable |
| `.xlsx`, `.xls`, `.ods`, `.numbers`, `.csv`, `.tsv` | `spreadsheet` | text-extractable |
| `.pptx`, `.ppt`, `.odp`, `.key` | `presentation` | text-extractable |
| `.pdf` | `pdf` | text-extractable |
| `.py`, `.js`, `.ts`, `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.sh`, `.sql` | `file` | text-extractable |
| images, video, audio, archives, executables, other | `other` | binary/metadata-only (Rule 2) |
| Shared link (Step 5c) | `shared-link` | metadata-only |
| File request (Step 5c) | `file-request` | metadata-only |

**Entity slug derivation.** Take the first 6 meaningful words of the filename
(drop extension and filler words), lowercase, hyphen-separated, ≤60 chars, with
the first 8 chars of the Dropbox `id` (after `id:` prefix) appended for
uniqueness. Keep the full name as the entity's display title.

---

### Step 5c — Sweep shared links and file requests

#### Sweep 1 — Shared links

```
list_shared_links({})
```

For each link, parse `server_modified` (or `client_modified` if absent) to
ISO-8601 UTC. Process only links whose timestamp is strictly greater than
`cursor.shared_links_cursor` (or all links if `shared_links_cursor` is absent).

For each new link, call `get_shared_link_metadata({ url: <link.url> })` and
create a `shared-link` entity. Then raise **Signal 4**:

```yaml
title: 'A Dropbox link was shared: "{name}"'
kind: knowledge-update
source_id: dropbox:shared-link:{link_id_or_url_hash}
suggested_actions:
  - label: "Open shared link"
    url: "{sharedLinkUrl}"
```

Use the link's `id` if exposed; otherwise SHA-256-hash the URL and take the
first 16 hex chars as the id. On `get_shared_link_metadata` failure, log
`dropbox-shared-link-revoked` (kind: `source`) and continue.

#### Sweep 2 — File requests

```
list_file_requests({})
```

For each returned file request whose `id` is NOT in `cursor.file_requests_seen`:

Call `get_file_request({ id: <request.id> })`. Skip if `is_open == false`.
Create a `file-request` entity with: `title`, `subtype: file-request`,
`fileRequestId`, `description`, `destination`, `deadline` (ISO-8601 if set),
`isOpen: true`, `viewUrl: https://www.dropbox.com/requests/{id}`.

Raise **Signal 5**:

```yaml
title: 'Dropbox file request: "{title}"'
kind: response-needed
source_id: dropbox:file-request:{id}
suggested_actions:
  - label: "View file request"
    url: "https://www.dropbox.com/requests/{id}"
```

Body section: include description, destination folder, and deadline. Example:
```
Dropbox is requesting files from you.
Description: {description}
Upload to: {destination}
Deadline: {deadline or "none"}
```

On `get_file_request` failure: log (kind: `source`) and continue.

---

### Step 5d — Content-change and mention signals (text-extractable files only)

#### Signal 1 — file-changed (modifier unknown)

Condition: file passed Step 5a change test AND `get_file_metadata` returned no
usable modifier attribution.

```yaml
title: '"{name}" was updated in Dropbox'
kind: knowledge-update
source_id: dropbox:changed:{file_id}
suggested_actions:
  - label: "Open in Dropbox"
    url: "{viewUrl}"
```

Body: SHORT summary (≤5 sentences) of current content from `fetch`. Open with
"Content as of {server_modified}:". Do NOT claim diff visibility.

#### Signal 2 — file-updated-by-someone (modifier known)

Condition: file passed Step 5a change test AND `get_file_metadata` returned a
`sharing_info` block with non-empty modifier name or email.

```yaml
title: '"{name}" was updated by {modifier_display_name}'
kind: knowledge-update
source_id: dropbox:changed:{file_id}
suggested_actions:
  - label: "Open in Dropbox"
    url: "{viewUrl}"
```

Body: same as Signal 1 plus "Last modified by {modifier_display_name}."

Signals 1 and 2 are **mutually exclusive per file per run** and share the same
`source_id` — the Step 9 dedup treats them as the same change event.

#### Signal 3 — mention

Condition: `fetch` succeeded AND the body references the current user.

Resolve the user's identity from `user.md` (read at Step 1). Match (case-
insensitive, whole-word for names) against: primary email, display name / first
name, and any aliases. Do NOT hardcode any identity. Group multiple matches
in the same file into a single mention action.

```yaml
title: 'You were mentioned in "{name}"'
kind: response-needed
source_id: dropbox:mention:{file_id}
suggested_actions:
  - label: "Open in Dropbox"
    url: "{viewUrl}"
```

Body: quote matching passages verbatim, one per bullet, ≤300 chars each, with
one sentence of surrounding context. Before raising, check `_sources.json` and
`actions/_index.md` for an existing open `dropbox:mention:{file_id}` action —
if found, update the entity body but do NOT raise a duplicate action.

---

## Cursor advance (Step 11 — transactional)

Advance only when every action write this run succeeded:

- `folder_cursor` → cursor from the final list_folder/continue response.
- `files` → for each processed file (new, changed, or unchanged-but-confirmed),
  update its entry to the current `rev` value. `rev` is obtained from
  `get_file_metadata` for text-extractable files and from the `list_folder`
  entry itself (if the entry carries it) for binary/metadata-only files. The
  files map stores `file_id → rev`; `content_hash` is never used or stored.
- `shared_links_cursor` → `max(server_modified)` across all shared links
  processed in Sweep 1.
- `file_requests_seen` → append each new file-request id raised in Sweep 2.
  Prune ids for requests confirmed closed (`is_open: false`).

If any action write failed: leave `cursor` at its entire pre-run value.

Cursor shape in sync.md:

```yaml
# bootstrap state
cursor: null

# after first successful run
cursor: '{"folder_cursor":"AAHo...","files":{"id:abc":"016552eabad06e70000000362a07e03"},"shared_links_cursor":"2026-06-26T10:00:00Z","file_requests_seen":["id:req001"]}'
```

`files` map values are opaque `rev` strings exactly as returned by the API.
Do not normalise, hash, or transform them.

---

## Failure modes

| Symptom | kind | Action |
|---|---|---|
| `list_folder` / `list_folder/continue` auth failure | `auth` | exit, release lock |
| `list_folder/continue` expired-cursor | `source` + `dropbox-folder-cursor-expired` | re-issue `list_folder` from root, continue |
| Network failure during folder walk | `network` | exit, release lock |
| 429 / quota-exceeded | `source` + `dropbox-rate-limited` | stop, exit, release lock; do NOT advance folder_cursor |
| `fetch` fails for a file | `source` + `dropbox-content-unavailable` | fall back to `file_preview`, metadata-only entity, skip Signals 1/2/3 |
| `get_file_metadata` fails | `source` + `dropbox-metadata-missing` | omit author/rev/sharingInfo, continue body fetch |
| `file_preview` fails | `source` + `dropbox-metadata-missing` | use `https://www.dropbox.com/home{path}` as viewUrl |
| File deleted / access revoked (404/403) | `source` + `dropbox-cursor-evicted` | evict from files map, close related actions |
| `cursor` JSON malformed | `parse` + `dropbox-cursor-malformed` | fall back to bootstrap |
| `list_shared_links` failure | `network` | skip Sweep 1; do NOT advance shared_links_cursor |
| `get_shared_link_metadata` not-found | `source` + `dropbox-shared-link-revoked` | skip link, continue |
| `list_file_requests` failure | `network` | skip Sweep 2; do NOT append to file_requests_seen |
| `get_file_request` fails | `source` | skip that request, continue |
| Bootstrap cap (200 files) reached | `source` | log deferred count, proceed with files so far; store folder_cursor at cap point |
