
**Dropbox — per-source reconcile signals**

- **Resolved when** — `get_file_metadata({ path: <file_path or item_path> })`
  returns not-found, deleted, or access-revoked for the file or folder; for a
  share-file action, an active shared link already exists for the file (a fresh
  `list_shared_links` call returns a non-empty link for that path); for a
  file-request action, `get_file_request({ id: <source_ref> })` returns not-found
  or the request's `is_open` field is false (fulfilled or closed).
- **Changed-but-valid when** — `get_file_metadata` shows a different `rev` or
  `path_lower` than at last ingest (file renamed, moved, or content changed); or
  the file's sharing state changed (link revoked, permissions narrowed). Update
  `file_path` / `file_name` / `item_path` / `item_name` and `existing_link` in
  the Compose payload, rewrite `## Why this matters`, and regenerate all
  `suggested_*` fields.
- **Re-check via** — `get_file_metadata({ path: <file_path or item_path> })`
  using the path from the action's `## Compose payload`; not-found = deleted.
  For file-request actions use `get_file_request({ id: <source_ref> })` instead.
