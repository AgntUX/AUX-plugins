# Step 5 — Fetch from Jira (Atlassian Cloud)

This file is a wholesale replacement of the canonical `reference/fetch.md`.
All Jira-specific fetch detail lives here. Nothing here changes the step
numbering, the transactional cursor rule, or the 10-actions-per-run cap.

The Rovo `search` tool is available as a fallback for free-text queries the
user asks at chat time (handled by `reference/ask.md`). It is NOT used during
the sync pass — the primary sync path uses the JQL tools below.

---

## 5a. Resolve the Atlassian Cloud instance

Before querying any project data, confirm the `cloud_id` and
`atlassian_site_url` are available in the sync state (loaded in Step 2).

- **If already present in sync state:** use the stored values. Do not call
  `getAccessibleAtlassianResources` again.
- **If absent (first run or gap recovery):** call
  `getAccessibleAtlassianResources`. From the response, locate the resource
  entry where `scopes` includes `read:jira-work`. Extract:
  - `id` → `cloud_id`
  - `url` → `atlassian_site_url`

  Write both values to `data/learnings/agntux-jira/sync.md` frontmatter
  immediately before proceeding. This call is read-only and does not count
  against the source-fetch budget.

If `getAccessibleAtlassianResources` returns no resource with `read:jira-work`
scope, log `kind: auth` and stop.

---

## 5b. Discover visible projects

Call `getVisibleJiraProjects` with no filter arguments. Record all returned
project keys and display names.

If the response is empty, log `kind: jira-project-discovery-empty` and stop.

Do not hardcode the project list. The tool returns the live set; trust it.

### 5b.i — Filter projects before fetch

Apply these filters before issuing any `searchJiraIssuesUsingJql` call:

1. **Archived/inactive flag.** Skip any project where the connector returns
   `archived: true` or `state: archived` in the project object. Log each
   skipped project as `skipped: archived` in the sync-state debug log.

2. **Name-prefix exclusion.** Skip any project whose `name` (not `key`)
   matches the case-insensitive regex
   `^(DELETE\b|TEST[\s-]|ARCHIVE[D]?\b|\[OLD\]|\[DEPRECATED\])`.
   This covers the patterns `DELETE *`, `TEST ` / `TEST-`, `ARCHIVE` /
   `ARCHIVED`, `[OLD]`, and `[DEPRECATED]` — the most common admin patterns
   for projects pending hard-delete or no longer active. Every Jira workspace
   accumulates renamed-for-deletion projects. Skipping by name prefix avoids
   spending ingest tokens scanning them and keeps the cursor map from
   accumulating dead keys.

   Apply this filter after the archived-flag check, on each project object
   returned by `getVisibleJiraProjects`. For each skipped project emit a
   one-line debug log entry:

   ```
   jira-project-name-prefix-skipped: {project.key} ({project.name})
   ```

3. **User allowlist / denylist (if set).** Read `user.md` frontmatter:
   - If `jira.project_allowlist` is a non-empty list of project keys, query
     ONLY those keys (intersected with the post-filter visible set above).
   - Else if `jira.project_denylist` is a non-empty list, drop those keys
     from the visible set.
   - If neither is set, proceed with the full post-filter visible set.

---

## 5c. Determine the query window per project

For each project key that survived 5b filtering, read the cursor state (see
`reference/cursor.md` for full semantics):

- **Bootstrap mode** (`cursor[project_key]` absent or null): use
  `updated_after = today − bootstrap_window_days` (default 30 days; read
  from `user.md` frontmatter `bootstrap_window_days` if present).
- **Incremental mode** (`cursor[project_key]` present): subtract a 60-second
  safety margin — `query_ts = cursor[project_key] − 60s` — then truncate to
  minute precision for JQL compatibility. Use `updated_after = query_ts`.

Log the mode (bootstrap or incremental) and the `updated_after` value for
each project to the sync-state debug log.

---

## 5d. Fetch updated issues — JQL, volume-capped, fields-projected

For each project, call `searchJiraIssuesUsingJql` with the following JQL:

**Incremental runs:**

```
project = {project_key}
  AND (assignee = currentUser() OR watcher = currentUser()
       OR reporter = currentUser()
       OR (text ~ currentUser() AND statusCategory != Done))
  AND updated >= "{YYYY-MM-DD HH:mm}"
ORDER BY updated DESC
```

**Bootstrap (first run for a project or gap recovery):**

```
project = {project_key}
  AND (assignee = currentUser() OR watcher = currentUser()
       OR reporter = currentUser()
       OR (text ~ currentUser() AND statusCategory != Done))
  AND updated >= "{YYYY-MM-DD HH:mm}"
ORDER BY updated DESC
```

The same user-scoping clause applies on both passes. It keeps the result set
to the AgntUX-relevant slice (issues assigned to, watched by, reported by, or
mentioned in the body of the current user) and avoids pulling every issue from
high-volume projects. The window date is the only difference between bootstrap
and incremental.

The `text ~ currentUser()` branch is paired with `statusCategory != Done` so
Closed/Resolved issues whose body happens to contain the user's name don't
leak into sync.

**Volume caps:**

| Mode | Issues per project per run |
|---|---|
| Incremental | 100 |
| Bootstrap — steady-state cold-start | 200 |
| Bootstrap — first run ever (`last_success: null AND cursor: {}`) | 100 per project, max 3 projects this run |

First-run-ever detection: `last_success: null` in the sync state combined with
an empty or absent cursor map. The tighter cap keeps the first scheduled run
snappy. Subsequent runs that bootstrap a newly added project (cursor absent for
that key but `last_success` non-null) use the 200-issue cap.

When exactly the cap limit is returned for a project, log `volume_cap_hit:
true` in the sync-state debug log. The next run will catch the remainder; do
not treat a cap hit as an error.

**Mandatory `fields` projection.** Always pass an explicit `fields` parameter.
The Atlassian MCP wrapper returns ~17 KB per issue by default; projected fields
reduce this to ~120 KB per 100 issues. Pass exactly:

```
fields: ["summary","status","issuetype","priority","assignee","reporter",
         "created","updated","duedate","labels","issuelinks"]
```

Do NOT request `description` or `comment` here — defer those to the selective
deep fetch in 5e.

**Page size.** Pass `maxResults: 10` on every call and iterate via
`nextPageToken` up to the volume cap. The MCP wrapper does not honour field
projection for nested objects and returns ~35 KB per 10-issue page — fits
cleanly within the host's per-call budget. Do not attempt larger page sizes
without re-testing against a live Atlassian site.

### 5d.i — Reduce to minimal record shape immediately

After each page is returned, project each issue to a flat record and discard
the rest:

```
{
  key:              issue.key,
  summary:          issue.fields.summary,
  status_name:      issue.fields.status.name,
  status_category:  issue.fields.status.statusCategory.key,
  priority_name:    issue.fields.priority?.name,
  assignee_id:      issue.fields.assignee?.accountId,
  assignee_email:   issue.fields.assignee?.emailAddress,
  reporter_id:      issue.fields.reporter?.accountId,
  reporter_email:   issue.fields.reporter?.emailAddress,
  created:          issue.fields.created,
  updated:          issue.fields.updated,
  due_date:         issue.fields.duedate,
  labels:           issue.fields.labels,
  issue_links:      issue.fields.issuelinks,
}
```

Keeping the raw nested objects inflates token cost on every downstream step;
discard them once the flat record is built.

### 5d.ii — Stale-but-assigned secondary pass

On every sync run (both incremental and bootstrap), after the primary 5d JQL
pass completes for all projects, issue one additional cross-project JQL call:

```
assignee = currentUser() AND statusCategory != Done AND updated < -30d ORDER BY updated ASC
```

with `maxResults: 50`. This returns the 50 oldest open issues the user is
still assigned to — issues that sit stale for months while still being actionable.

Reporter-only stale tickets are deliberately excluded — filing a ticket that
someone else (or no one) owns isn't an action item; it's an artifact of triage.
The user can rediscover those via search if needed.

Project-tracker work doesn't always update on a steady cadence — open tickets
can sit stale for months while still being actionable. The stale-assigned pass
surfaces them at most once per action item (the action item is deduped via
`_sources.json`).

**Processing the secondary-pass results:**

- Apply the same minimal record projection from 5d.i to each returned issue.
- Skip any issue key already present in the primary 5d result set this run
  (avoid double-processing the same issue).
- Compute stale age: `stale_days = today − date(issue.fields.updated)`, rounded
  to whole days.
- Each surviving result carries `reason_class: needs-decision` into Steps 6–8.
- When writing the action item body in Step 10, include a stale-age line in the
  body:

  ```
  Still assigned, last updated {stale_days}d ago — does this still need to ship?
  ```

- This pass does NOT advance the per-project cursor — only the primary 5d pass
  governs cursor advancement in Step 11.
- No `volume_cap_hit` log for this pass; the 50-result cap is fixed and expected.

---

## 5e. Per-issue selective deep fetch (description + comments)

After 5d gives the lightweight projection, build a shortlist of issues that
need `description` and `comment` data for classification:

- Issues assigned to the current user (`user.md → email` or
  `user.md → atlassian_account_id`).
- Issues where a comment author visible at projection level matches an
  `always-flag` person from `user.md → # People`.
- Issues whose `status_name` appears in `user.md → jira.action_statuses`
  (default: `["Blocked","Needs Review","In Review","Code Review"]`).
- Issues with `priority_name` ∈ {`Highest`, `High`} updated in the last
  48 hours.

For each shortlisted issue call `getJiraIssue` once, requesting the `comment`
and `description` fields. Cap the shortlist at **30 issues per run** — defer
the remainder with a `deep-fetch-deferred` debug note and the count.

**Incremental comment filtering.** When reading the returned `comment` array,
keep only comments where `comment.created` is newer than the project's
previous cursor value (the pre-safety-margin cursor, not `query_ts`). This
avoids re-surfacing comments already processed in prior runs.

Issues NOT in the shortlist are still written as knowledge-store entities in
Step 7, but with `description: "(not fetched this pass — see Jira)"` and
`## Comments` section omitted. They re-enter the shortlist on subsequent runs
if their signal persists.

---

## 5f. Fetch remote links (selective)

For issues where `issue_links` is empty, or where classification in Step 8 may
depend on cross-system signals (PR refs, Slack thread links, Confluence pages),
call `getJiraIssueRemoteIssueLinks` for the issue key.

Limit to:
- Issues with 0 `issuelinks` entries.
- Issues where the last commenter is an external actor (comment author account
  differs from all `assignee` and `reporter` accounts seen this run).

Remote links are sibling pointers — not children of the issue. Store them in
a `## Remote links` section on the entity, separate from `## Issue links`.

---

## 5g. Resolve available transitions (selective)

Call `getTransitionsForJiraIssue` only for issues that will be classified as
`action_class: transition` in Step 8. Store the transitions list in the
per-issue scratch buffer; Step 10 embeds it in the `## Compose payload` section.

---

## 5h. Resolve account display names (selective)

Call `lookupJiraAccountId` for any `accountId` that does not already resolve to
a known `person` entity in the knowledge store, and whose `emailAddress` was not
returned inline by the connector. Cache resolved display names for the run to
avoid repeated lookups for the same account.

Do not call `lookupJiraAccountId` for accounts whose `emailAddress` is already
present inline — the email is already available for entity resolution.

Bot/app accounts (`accountType: "app"`, or `emailAddress` absent + display name
matching `Automation for Jira` / `atlassian-addons-admin`) must not become
person entities — record the display name as plain text only.

---

## Thread and parent-child semantics

Each Jira **issue** is the top-level thread unit (one entity per issue). Its
**comments** are ordered children — fetched inline via `getJiraIssue` for
shortlisted issues. Its **remote links** (PR refs, Slack threads, Confluence
pages) are sibling pointers stored in `## Remote links`, not nested children.

Issue links (`issuelinks` — blocking, blocked-by, relates-to, clones) are
peer-issue references stored in `## Issue links`. Do not recursively fetch
linked issues unless they also appear independently in the 5d result set.

One entity per issue, one per comment (if written separately), one per worklog
(if present). See `reference/cursor.md` §5 for why a tracked-parent registry
is not needed — Jira bumps the issue `updated` field on every comment, so
re-surface is guaranteed by the incremental JQL query.

---

## Source ID format

Construct `source_id` for each issue as:

```
jira:{cloud_id}:{project_key}:{issue_key}
```

The `cloud_id` is resolved at runtime from `getAccessibleAtlassianResources`
or from the stored `cloud_id` in `data/learnings/agntux-jira/sync.md`. Do
not hardcode the cloud_id in any rendered skill file.

For comments nested under an issue:

```
jira:{cloud_id}:{project_key}:{issue_key}:comment:{comment_id}
```

For worklogs:

```
jira:{cloud_id}:{project_key}:{issue_key}:worklog:{worklog_id}
```

Example issue source_id (for reference only — never embed):
`jira:1c5b1484-c964-4d92-bb3e-9237be54ca08:OFM:OFM-412`
