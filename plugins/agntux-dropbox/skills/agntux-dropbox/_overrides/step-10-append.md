
### Step 10.1c — Dropbox compose payload

This plugin ships four view tools that each read `## Compose payload`. Write
the section for every action whose suggested action opens a Dropbox view, using
exactly the field names the handler reads — full schema in the compose-payload
reference shape.

- **Share view** (action opens share-file): write `source_context`, `file_path`,
  `file_name`, `file_type`, `existing_link` (empty string when none),
  `suggested_access` (`anyone` / `password` / `team`; default `anyone`),
  `suggested_expiry` (ISO-8601 date or empty string).
- **Organize view** (action opens organize-file): write `source_context`,
  `item_path`, `item_name`, `item_type` (`file` or `folder`),
  `suggested_destination` (absolute Dropbox path), `mode` (`move` or `copy`;
  default `move`).
- **New-folder view** (action opens new-folder): write `source_context`,
  `parent_path` (absolute Dropbox path of parent), `parent_name`,
  `suggested_folder_name`.
- **File-request view** (action opens file-request): write `source_context`,
  `destination_path` (absolute folder path for uploads), `destination_name`,
  `suggested_title`, `suggested_deadline` (ISO-8601 date or empty string).
