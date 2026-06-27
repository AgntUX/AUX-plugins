
**Apple Notes — per-source reconcile signals**

- **Resolved when** — the note referenced by `source_ref` is no longer returned
  by `get_note_content` (not-found or permission-denied = deleted upstream); or
  the note is a checklist and every item in `checklist_items` is `checked: true`
  (task fully completed). For create-note actions (no upstream note yet), close
  only when a note matching `draft_title` already exists in `target_folder` (the
  user created it manually or a prior run succeeded).
- **Changed-but-valid when** — the body returned by `get_note_content` differs
  materially from `current_content` in the action's `## Compose payload`; or the
  note was moved to a different folder. Rewrite `## Why this matters`, update
  `folder` / `current_content` / `is_checklist` / `checklist_items`, and
  regenerate `draft_body` in the Compose payload.
- **Re-check via** — `get_note_content({ note_name: <note_name>, folder: <folder> })`
  using `note_name` and `folder` from the action's `## Compose payload`; an
  empty or error response means deleted. For create-note actions there is no
  upstream note to re-check — skip the re-check sub-step for those actions.
