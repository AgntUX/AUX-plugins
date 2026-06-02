## Step 2 — Google Calendar sync state initialisation

After reading the sync state, confirm the minimum sync-state frontmatter
is present in `data/learnings/agntux-google-calendar/sync.md`.

**If the file does not exist, create it** with the following frontmatter:

```yaml
---
type: plugin-sync-state
plugin_slug: agntux-google-calendar
schema_version: "1.0.0"
created_at: {today as YYYY-MM-DD}
updated_at: {today as YYYY-MM-DD}
cursor: "{}"
lock: null
last_run: null
last_success: null
events_processed: 0
volume_cap_hit: false
errors: []
---
```

**Google Calendar has no workspace-identifier fetch.** Calendar IDs
returned by `list_calendars` are stable per account — no one-time
resolution step is needed (unlike Jira's `cloud_id`). Proceed directly
to the soft-lock acquire.
