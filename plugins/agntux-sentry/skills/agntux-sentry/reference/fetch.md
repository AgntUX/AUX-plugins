# Step 5 — Fetch from Sentry

Wholesale replacement of `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
All Sentry-specific fetch detail lives here. Nothing here changes the step
numbering, the transactional cursor rule, or the 10-actions-per-run cap.

Do NOT hard-code org slugs, project slugs, or issue IDs. Every value below is
resolved at runtime from connector responses or from
`data/learnings/agntux-sentry/sync.md`. Per-user signal weighting and scoping
preferences live in `data/instructions/agntux-sentry.md` and `user.md`.

Do NOT call `analyze_issue_with_seer` during sync — it is too slow for a
scheduled pass. It is available on-demand only (user-initiated via ask branch).

---

## 5a. Resolve the org slug

Call `find_organizations()` once per run (no arguments). Extract the first
organization the token can access:

- `slug` → `org_slug`. Store in working memory for all subsequent calls.
- `id` → `org_id`. Store for deep-link construction.

**Persist.** Write `org_slug` and `org_id` to
`data/learnings/agntux-sentry/sync.md` frontmatter on first successful
resolution. On subsequent runs read from the sync file and skip
`find_organizations` when `org_slug` is already non-null and `last_success` is
within 7 days.

If `find_organizations` returns an empty list or no token-readable org, log
`kind: sentry-org-not-found`, release the lock, and exit. Do NOT proceed
without an org slug.

If the token has access to more than one organization, use the first one
returned. If the user has set `sentry.org_slug` in `user.md` frontmatter, use
that value and skip the `find_organizations` call entirely (the user's explicit
override takes precedence).

---

## 5b. Enumerate projects

Call `find_projects(organizationSlug: "{org_slug}")` once per run. Record each
project's:

- `slug` → project slug (cursor map key, filter value for `search_issues`).
- `name` → human-readable display name.
- `id` → used in deep-link construction if needed.

**Persist the project list.** Write the list to
`data/learnings/agntux-sentry/sync.md` frontmatter under `projects` as a JSON
array of `{slug, name}` objects. On subsequent runs, read from the sync file
and skip `find_projects` when `projects` is already non-null and `last_success`
is within 24 hours.

If `find_projects` returns an empty list, log `kind: sentry-project-not-found`,
release the lock, and exit.

**Filtering.** If the user has set `sentry.project_allowlist` in `user.md`
frontmatter as a non-empty list of project slugs, restrict the fetch to those
projects (intersected with the live project list). If the user has set
`sentry.project_denylist`, exclude those slugs. If neither is set, process all
projects returned.

---

## 5c. Determine the query window per project

For each project slug, read its cursor entry from the sync state
(`cursor[project_slug]`):

- **Bootstrap** (`cursor[project_slug]` absent or null): compute the period as
  `bootstrap_window_days` days ending now (default 30 days; read from `user.md`
  frontmatter `bootstrap_window_days` if present). Pass this as the `period`
  argument to `search_issues` using Sentry's relative-time notation
  (e.g. `"30d"` for 30 days). Set `sort: "date"`.
- **Incremental** (`cursor[project_slug]` present): this project has a known
  last-seen timestamp. Pass `sort: "date"` and filter on `lastSeen:>{cursor_ts}`
  by embedding it in the `query` string (e.g.
  `query: "is:unresolved lastSeen:>2026-06-25T17:00:00"`). Omit the `period`
  argument when providing an explicit `lastSeen` filter.

Log the mode (bootstrap or incremental) and the effective time boundary per
project to the sync-state debug log before any `search_issues` call.

---

## 5d. Fetch issues per project — volume-capped

For each project that survived the 5b filters, call `search_issues` with:

```
organizationSlug: "{org_slug}"
projectSlugOrId: "{project_slug}"
query: "is:unresolved"          # base query — see 5d.i for augmentation
sort: "date"                    # newest lastSeen first
```

In incremental mode, augment the base query with the lastSeen filter:

```
query: "is:unresolved lastSeen:>{cursor_ts}"
```

**Volume cap: 50 issues per project per run.** Sentry's `search_issues` returns
paginated results; iterate pages until either 50 issues are collected or there
are no more pages. When the cap is hit, log
`kind: sentry-pagination-overflow` with the project slug and stop fetching
that project for this run. The cursor still advances to the newest `lastSeen`
seen in the collected batch — the next scheduled run picks up the remainder.

**Multi-status coverage.** The `is:unresolved` query covers new, unresolved,
and escalating issues simultaneously (Sentry's `unresolved` status encompasses
`new`, `returning`, and `escalating`). Do not issue separate queries for each
status sub-type per project — this avoids counting against the cap multiple
times for the same project. If the user has set
`sentry.extra_queries` in `user.md`, add those queries in additional passes
within the remaining cap headroom.

### 5d.i — Flat record projection

For each issue returned by `search_issues`, extract and retain only the
following fields. Discard all other nested data immediately to control token cost.

```
{
  id:           issue.id,
  short_id:     issue.shortId,         # e.g. "AGNTUX-APP-1" — already project-prefixed; used for source_id
  title:        issue.title,
  level:        issue.level,           # "error" | "warning" | "info" | "fatal"
  status:       issue.status,          # "unresolved" | "resolved" | "ignored"
  culprit:      issue.culprit,         # module / transaction path
  project_slug: issue.project.slug,
  count:        issue.count,           # total event count (string)
  user_count:   issue.userCount,
  first_seen:   issue.firstSeen,       # ISO 8601
  last_seen:    issue.lastSeen,        # ISO 8601 — used as cursor value
  permalink:    issue.permalink,       # stable URL to the issue in Sentry UI
  assigned_to:  issue.assignedTo,      # null | {type, name, email} object
}
```

Discard the rest of the issue object. Full event details (stack trace,
breadcrumbs) are fetched selectively in step 5e. Keeping the flat record in
working memory only costs a few hundred bytes per issue.

---

## 5e. Deep-fetch issue detail (selective)

After 5d builds the working buffer of flat records, construct a **shortlist
of issues needing full detail** for downstream classification:

- Issues with `level: "fatal"` or `level: "error"` first seen within the last
  48 hours (new high-severity issues).
- Issues with `user_count` greater than a threshold (default 5; read from
  `user.md` frontmatter `sentry.user_count_threshold` if set) — indicates
  broad user impact.
- Issues where `assigned_to` is the current user (from `user.md` email or
  `user.md` frontmatter `sentry.assigned_to_email` if set).
- Issues where `count` increased by more than 2× compared to the last-known
  count in the entity file (escalating by volume).

For each shortlisted issue, call `get_sentry_resource` once:

```
get_sentry_resource(
  resourceType: "issue",
  resourceId: "{issue.id}"
)
```

Extract:
- Latest event: exception type, message, stack frames (top 5), release version.
- Breadcrumbs: last 3 entries (category, message, timestamp).
- Any linked `contexts` (runtime, OS, GPU, request URL) relevant for triage.

**Cap the shortlist at 20 issues per run.** Issues not deep-fetched are still
recorded as entities in Step 7 with a `## Context` placeholder ("full detail
not fetched this pass — see Sentry"); they will be re-evaluated on the next run
if they remain in the incremental window.

Do NOT call `get_sentry_resource` for issues already classified as
`knowledge-update` only (e.g. a previously resolved issue that simply moved
status). Reserve deep fetches for genuine `response-needed` candidates.

---

## 5f. Optional event-volume context (selective)

Call `search_events` only when a specific issue's `count` is very high
(>1000) and the classification in Step 8 depends on knowing the event
distribution over time (e.g. to distinguish a sudden spike from a slow burn):

```
search_events(
  organizationSlug: "{org_slug}",
  dataset: "errors",
  query: "issue.id:{issue_id}",
  fields: ["count()", "timestamp"],
  period: "24h"
)
```

This call is expensive — limit to at most **5 issues per run** that genuinely
need volume trend data. Skip if the flat record from 5d is sufficient for
classification.

---

## Thread and parent-child semantics

Each Sentry **issue** (the grouped-error object with a stable `id` and
`shortId`) is the top-level thread unit. Its **individual events** (occurrences)
are children — not surfaced as separate entities. The action item and entity
files reference the issue, not individual events.

When the primary signal is a new comment on an issue, the issue is still the
parent entity written to `entities/sentry-issue/` in Step 7. Store comments
(from issue detail, if present) in a `## Comments` section within the entity
file. Do not create a separate entity per event or per comment.

---

## Deduplication rule for re-surfacing issues

Before writing a new action item in Step 10, check `actions/_index.md` for an
existing open or closed entry with the same `source_id`:

- **Existing open item, same issue, unchanged signal** → update the existing
  item (`updated_at`, body refinements); do NOT create a new item.
- **Existing open item, same issue, escalated** (e.g. user_count jumped,
  level changed from `warning` to `fatal`) → update the existing item's
  `priority` and body; do NOT create a new item.
- **Existing closed/dismissed item, issue re-surfaced** (issue was
  `resolved` or `ignored` then returned to `unresolved` with new activity) →
  raise a NEW action item. Note in `reason_detail` that this is a re-opened
  issue (e.g. `[sentry-regression] web-1Z43 re-opened after resolve`).
- **Issue was merged into another issue** → log `kind: sentry-merged-into`
  with both issue ids; update the surviving issue's entity if it appears in
  this run's buffer; skip the merged-away issue.

---

## Source ID format

Construct `source_id` for each issue as:

```
sentry:{short_id_lowercased}
```

where `{short_id_lowercased}` is the Sentry `shortId` field value, lowercased.

Sentry's `shortId` is **already project-prefixed** — it is always of the form
`{PROJECT}-{N}` (e.g. `AGNTUX-APP-1` for project `agntux-app`). Do NOT
prepend the project slug again; doing so double-prefixes the project and
breaks deduplication on re-surface.

Full example: for `shortId: "AGNTUX-APP-1"` → `source_id: "sentry:agntux-app-1"`

The `shortId` is stable across event accumulation and is the Sentry-native
human-readable handle. Do NOT construct the source_id from the numeric `id`
field alone — the shortId is more durable as a display identifier and is
globally unique within the org.

---

## Suggested actions

Deep-link URL is returned directly by the connector in the `permalink` field.
Use it for the "Open in Sentry" action.

### Unresolved / escalating issue (response-needed)

```yaml
suggested_actions:
  - label: "Resolve issue"
    host_prompt: "Use the agntux-sentry plugin to resolve issue action {id}"
  - label: "Assign issue"
    host_prompt: "Use the agntux-sentry plugin to assign issue action {id}"
  - label: "Open in Sentry"
    url: "{issue.permalink}"
```

### Status change or informational update (knowledge-update)

```yaml
suggested_actions:
  - label: "Open in Sentry"
    url: "{issue.permalink}"
```

Emit `host_prompt` entries only for issues where a commit action exists
(resolve, assign). All issues emit the `url` open-in-Sentry entry.

---

## Failure modes

| Symptom | `kind` | Action |
|---|---|---|
| Auth error (401 / expired token) | `auth` | release lock, exit |
| Network failure | `network` | release lock, exit |
| Rate limit (429) | `source` + `sentry-rate-limited` | stop fetching, release lock, exit |
| `find_organizations` returns empty list | `sentry-org-not-found` | release lock, exit |
| `find_projects` returns empty list | `sentry-project-not-found` | release lock, exit |
| Per-project cap hit | `sentry-pagination-overflow` | log project + count, advance cursor for processed issues, stop that project |
| Issue was merged, original id missing | `sentry-merged-into` | log both ids, skip original, continue |
| Cursor entry malformed for one project | `sentry-cursor-evicted` | reset that project to bootstrap, log, continue |
| Malformed JSON / missing fields in response | `parse` | log, skip item, continue |
| `get_sentry_resource` fails for one issue | `source` | log issue id, skip deep fetch, continue with flat record |

On any failure, log to `data/learnings/agntux-sentry/sync.md → errors` (slice
to last 10 entries, newest-first). The transactional cursor rule in Step 11
ensures the cursor does not advance past successfully processed records only.
