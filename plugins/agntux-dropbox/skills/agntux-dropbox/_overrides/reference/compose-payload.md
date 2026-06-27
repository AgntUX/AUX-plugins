# Dropbox compose payload — Step 10 reference

Wholesale override for the canonical `compose-payload.md`.

Documents the `## Compose payload` body section written into every
{{source-display-name}} action file at Step 10. The view tool lifts this
section from disk at click time to pre-fill the action composer without
re-fetching Dropbox metadata.

---

## `## Compose payload` body section shape

Every action file whose `suggested_actions` opens a Dropbox view MUST include
a `## Compose payload` section. All four Dropbox view handlers read the
**same** `## Compose payload` header — the field set differs by which handler
the action opens. Write only the fields for the matching mode below; leave out
fields that belong to other modes.

**YAML quoting reminder.** Any string scalar containing `: ` (colon-space),
a leading `-`, or starting with `{` / `[` MUST be wrapped in double quotes —
otherwise the parser interprets it as a key/value pair, list item, or flow
collection. The view tool falls back to a `compose_payload_missing` error
envelope when normalisation drops a field, blocking the iframe from rendering.

---

## Share-file mode

For actions whose `suggested_actions` opens the share-file view
(`agntux_dropbox_share`):

```markdown
## Compose payload

```yaml
source_context: "{1–2 sentences: what prompted sharing this file}"
file_path: "{absolute Dropbox path to the file, e.g. '/Work/report.pdf'}"
file_name: "{bare file name with extension, e.g. 'report.pdf'}"
file_type: "{file extension or MIME class, e.g. 'pdf', 'docx', 'image'}"
existing_link: "{existing shared-link URL for this file, or empty string if none}"
suggested_access: "{recommended access level: 'anyone' (default), 'password', or 'team'}"
suggested_expiry: "{ISO-8601 date for link expiry, e.g. '2026-07-15', or empty string if no expiry suggested}"
```
```

### Field rules

**`file_path`**: Absolute Dropbox path as returned by `get_file_metadata`.

**`existing_link`**: The URL of any currently-active shared link from
`list_shared_links`. Empty string when none exists — never omit the key.

**`suggested_access`**: Infer from the file's current sharing state and the
user's apparent intent. Default `anyone` when unclear.

**`suggested_expiry`**: Suggest an expiry only when the content is
time-sensitive (e.g. a contract with a deadline, a temporary download link).
Empty string otherwise.

---

## Organize-file mode

For actions whose `suggested_actions` opens the organize-file view
(`agntux_dropbox_organize`):

```markdown
## Compose payload

```yaml
source_context: "{1–2 sentences: why this file or folder should be moved or copied}"
item_path: "{absolute Dropbox path of the item to move/copy}"
item_name: "{bare item name}"
item_type: "{file | folder}"
suggested_destination: "{absolute Dropbox path of the recommended target folder}"
mode: "{move | copy — default 'move'}"
```
```

### Field rules

**`item_type`**: `file` or `folder`. Passed through to the organize iframe.

**`suggested_destination`**: The absolute path the agent believes best fits
the item based on folder structure observed during ingest. Do not invent a
path not seen during this run.

**`mode`**: `move` when the original location should be vacated; `copy` when
both locations are intentional. Default `move`.

---

## New-folder mode

For actions whose `suggested_actions` opens the new-folder view
(`agntux_dropbox_new_folder`):

```markdown
## Compose payload

```yaml
source_context: "{1–2 sentences: why this folder should be created}"
parent_path: "{absolute Dropbox path of the parent directory, e.g. '/Work'}"
parent_name: "{bare name of the parent directory}"
suggested_folder_name: "{agent-suggested folder name, concise and descriptive}"
```
```

### Field rules

**`parent_path`**: The folder under which the new folder should be created,
as observed during ingest. Use `/` for Dropbox root.

**`suggested_folder_name`**: Concise, file-system-safe name. No leading slash.
Based on the content or project the new folder is meant to contain.

---

## File-request mode

For actions whose `suggested_actions` opens the file-request view
(`agntux_dropbox_file_request`):

```markdown
## Compose payload

```yaml
source_context: "{1–2 sentences: what this file request is for and who it is directed at}"
destination_path: "{absolute Dropbox folder path where uploaded files will land}"
destination_name: "{bare name of the destination folder}"
suggested_title: "{human-friendly request title, e.g. 'Q2 Budget Submissions'}"
suggested_deadline: "{ISO-8601 date by which files should be uploaded, e.g. '2026-07-01', or empty string if no deadline}"
```
```

### Field rules

**`destination_path`**: The folder the file-request link will deposit files
into. Must be an existing Dropbox path observed during ingest.

**`suggested_title`**: What the request link will be labelled when the
recipient sees it. Concise and specific enough that submitters understand
what to send.

**`suggested_deadline`**: Suggest a deadline only when context implies one
(e.g. a project milestone date). Empty string otherwise.

---

## Cross-source-merged actions

When Step 9 finds a sibling open action to merge into, emit the payload as
`## Compose payload (dropbox)` rather than `## Compose payload`. The view
tools read either header — same shape, different namespace. This is the
contract Step 9's cross-source merge depends on.
