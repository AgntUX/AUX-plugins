## Step 11 — Google Calendar attendee entity lookup-before-write

**Applies to new attendees with no existing `people/*.md` file** (those
resolved in Step 5f.1 need no further work here). Run before cursor
advance or lock release.

Apply the canonical lookup-before-write protocol (Step 6) keyed on
`(subtype: "person", source: "google-calendar", source_id: "<attendee-email>")`:

1. Read `entities/_sources.json` (treat not-found as empty).
2. If found → merge any new display-name or role into the existing
   `entities/person/{slug}.md`. Do NOT create a new file.
3. If not found → search by email across all entries (email is the
   canonical cross-source alias). On match under a different source,
   add a `_sources.json` entry for the Google Calendar variant (PostToolUse
   hook upserts after Write).
4. If no match → create `entities/person/{email-slug}.md` with frontmatter
   name, email alias, `source: google-calendar`. Hook registers it.

**Do NOT direct-edit `_sources.json`.** Write the entity file; the hook handles registration.

---

## Step 11 — Google Calendar cursor advance, eviction, and lock release

After all action writes succeed (advance only on full success — transactional rule):

### Advance per-event cursor entries

```
cursor["<calendarId>#<eventId>"] = event.updated   (RFC3339)
```

For recurring instances: `cursor["<calendarId>#<eventId>#<occurrenceStart>"]`.
Do NOT update for failed writes — leave the previous value; next run retries.

Set `look_ahead_window_end = now() + 7 days` (informational; always advances).

### Evict past events

For each key flagged `pending_cursor_eviction: true` by Step 5i:
remove the cursor entry and log `kind: google-calendar-cursor-evicted`.
Write all removals in the same atomic sync-state write as advances and lock clear.

### Write sync state summary

In the same atomic write:
- `updated_at`, `last_run`, `last_success` (only if no write failed),
  `events_processed`, `volume_cap_hit: true|false`, `lock: null`.

On any write failure: omit `last_success`; write `kind: internal` error
entry listing failed event IDs.

### Cursor advance log

```
cursor advance — new: {N} | updated: {M} | evicted: {K} | failed: {F}
look_ahead_window_end: {endTime RFC3339}
```
(Omit `failed` clause when F == 0.)
