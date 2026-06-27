
### Step 10.1c — Apple Notes compose payload

This plugin ships two view tools that each read `## Compose payload`. Write
the section for every action whose suggested action opens a note view, using
exactly the field names the handler reads — full schema in the compose-payload
reference shape.

**Create-note view** (action opens `agntux_apple_notes_create_note`):
Write `## Compose payload` with: `source_context`, `draft_title`, `draft_body`
(agent-composed, in the user's voice, ≤4000 chars), `target_folder` (best-
matching folder name; default `Notes`), `available_folders` (string list of all
distinct folder names seen across notes fetched this run).

**Update-note view** (action opens `agntux_apple_notes_update_note`):
Write `## Compose payload` with: `source_context`, `note_name`, `note_id`
(the `x-coredata://` URI or note name as fallback), `folder`, `current_content`
(verbatim note body from `get_note_content`, ≤4000 chars), `draft_body`
(agent-composed revision, ≤4000 chars), `is_checklist` (boolean),
`checklist_items` (array of `{text, checked}` objects when `is_checklist: true`;
otherwise `[]`).
