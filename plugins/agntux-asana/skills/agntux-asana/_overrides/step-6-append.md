**Asana entity lookup notes:**

- **Task assignee** (`assignee.name` / `assignee.email`): use `email`
  as the canonical lookup key for `person` entities — it's stable
  across display-name changes. If `assignee` is null, the task is
  unassigned; skip person entity creation for the assignee slot.

- **Task projects** (`projects[].name`): each project name maps to a
  `project` entity. Use the project GID as `source_id` in the
  `sources:` array entry; the project name drives the slug. A task
  can belong to multiple projects — create or update an entity for
  each.

- **Story authors** (`stories[].created_by.email`): resolve each
  comment author as a `person` entity using the same email-keyed
  lookup. Batch comment-author lookups with task-assignee lookups in
  the same parallel read call (Step 7's "single parallel-tool-call
  batch" instruction applies across both kinds).

- **Asana source_id convention:** use the task GID (not the task name)
  as `source_id` for `task`-subtype associations, and the project GID
  for `project`-subtype associations. The GID is the stable opaque
  identifier; names can change.
