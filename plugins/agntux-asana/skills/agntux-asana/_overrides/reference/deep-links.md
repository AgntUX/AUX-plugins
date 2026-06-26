# Asana deep-link construction — Step 10 reference

Companion to `../SKILL.md` Step 10. Wholesale override for
agntux-asana — replaces the canonical `reference/deep-links.md` stub.

## Task permalink

Asana tasks expose a `permalink_url` field directly in the API
response (present in `get_my_tasks` and `get_task` when
`opt_fields` includes `permalink_url`). **Prefer this field** — it is
the canonical, stable, workspace-scoped URL Asana generates:

```
https://app.asana.com/0/{project_gid}/{task_gid}
```

When a task belongs to multiple projects, `permalink_url` uses the
first (primary) project GID. Use the API-returned value verbatim; do
not reconstruct it from GIDs.

**If `permalink_url` is null** (rare — task not in any project, or
membership not yet set): use the workspace-scoped fallback:

```
https://app.asana.com/0/{workspace_gid}/list
```

where `workspace_gid` is from `sync.md → workspace_gid`. If
`workspace_gid` is also null (cold-start first run before Step 5a
resolved it), set the URL to `null` and omit the `Open in Asana` row
from `suggested_actions`.

## Project permalink

For project-level signals (status updates):

```
https://app.asana.com/0/{project_gid}/list
```

Use the `project_gid` from the status overview object.

## URL family summary

| Artefact | URL pattern | Source field |
|---|---|---|
| Task (primary project) | `permalink_url` from API | `get_task` → `permalink_url` |
| Task (no project) | `https://app.asana.com/0/{workspace_gid}/list` | `sync.md → workspace_gid` |
| Project | `https://app.asana.com/0/{project_gid}/list` | `projects[].gid` |

## Worked example

Task GID `1234567890` in project GID `9876543210`:
```
https://app.asana.com/0/9876543210/1234567890
```
This is the value the API returns in `permalink_url`. Use it as-is.
