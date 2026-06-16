# Apple Notes fetch — Step 5 orchestration

Wholesale override for `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
Apple Notes uses a two-phase shape: list all notes (paged), then fetch
the body of each changed note individually.

## Step 5 — Fetch from Apple Notes

Call `mcp__Read_and_Write_Apple_Notes__list_notes` and
`mcp__Read_and_Write_Apple_Notes__get_note_content` (the host may
UUID-prefix these at runtime; call them by their host-resolved names).

### Step 5a — List notes

Call `list_notes` once per page until all notes are enumerated or the
200-note run cap is reached. Pass `limit` to control page size; omit
`folder` to retrieve notes across all folders (do not hard-code folder
names — the user's folder layout is personal and unknown at build time).

```
list_notes({ limit: 100 })          # first page
list_notes({ limit: 100, ... })     # subsequent pages if the connector
                                    # supports continuation — see below
```

**Pagination note.** If the connector does not expose a continuation
token, call `list_notes` without `folder` to get all notes in one
batch. If the batch exceeds 200 items after filtering, sort the
candidates ascending by normalised modification_date (oldest first) and
process the first 200 only; advance the cursor to the newest of those
200 and exit. The next scheduled run picks up the remainder.

**Date normalisation (required before any comparison).** The connector
returns `modification_date` as a human-readable locale string such as
`"Monday, June 15, 2026 at 11:53:22 AM"`. Parse this to an ISO-8601
UTC timestamp before comparing to the cursor or to other notes'
dates. If parsing fails, log an `apple-notes-date-parse-failed` entry
to `sync.md → errors` (kind: `parse`) with the note id and the raw
string value, and skip that note for this run.

**Filter for changed notes.** From the full list, select notes where:

- **Incremental run** (`cursor` non-null): normalised `modification_date`
  is strictly greater than `cursor`.
- **Bootstrap run** (`cursor: null`): normalised `modification_date`
  falls within `(now − bootstrap_window_days days, now]`.

Notes whose normalised `modification_date` equals or precedes the cursor
are already processed; skip them.

### Step 5b — Fetch note bodies

For each changed note identified in Step 5a, call
`get_note_content` to retrieve the full text body.

**Title-keyed fetch and collision handling.** `get_note_content` is
keyed by note TITLE (`note_name`), not by the `x-coredata://` id
returned by `list_notes`. Titles are not guaranteed unique across
folders.

Resolution order when a title may be ambiguous:

1. **Pass `folder`** when the note's folder is known from the
   `list_notes` result. This is always the preferred path; prefer it
   whenever the list result carries a folder field.
2. **If folder is unknown or omitted by the connector**, call
   `get_note_content({ note_name: <title> })` without `folder`. If
   the connector returns a single unambiguous match, use it.
3. **If the connector returns multiple matches** (or the result's
   content does not correspond to the expected note's `modification_date`),
   prefer the match whose `modification_date` most closely equals the
   value returned by `list_notes` for that id.
4. **If the ambiguity cannot be resolved**, log an
   `apple-notes-title-collision` entry to `sync.md → errors`
   (kind: `source`) with the note id and title, skip the note for this
   run, and continue. Do NOT write an entity or action from an
   ambiguous body fetch.

**Checklist notes.** Apple Notes supports checklist notes; their body
text carries inline checklist markers. Preserve the raw body verbatim
— do not strip or reformat checklist syntax. Entity extraction and
triage (Steps 6–8) operate on the preserved body.

**Body size.** Note bodies have no fixed cap from the connector. If the
host's MCP layer truncates an oversized response (returns a "use
offset/limit" marker), log `apple-notes-tool-result-truncated`
(kind: `source`) and skip that note for this run. Step 11's
transactional rule keeps the cursor at its pre-run value so the next
run retries.

### Step 5c — Map note bodies to entities and actions

These rules are source-level and apply to **any** user's notes — never
hard-code one user's folders, titles, or topics.

**Actionability is determined by pending-work language, not list
markup.** Apple Notes content arrives as HTML: true checklists carry
checkbox markers, but many task-bearing notes are plain `<ul>`/`<ol>`
bullet lists or prose. Do NOT gate action-raising on checkbox markers
alone. Treat a recently-modified note as a candidate action source when
its body contains pending-work signals, regardless of markup:

- imperative / request phrasing ("please add", "remove", "should be",
  "let's", "need to", "rephrase", "replace X with Y");
- unchecked checklist items (`☐` / `- [ ]` / unticked markers);
- an explicit open question awaiting a decision.

A note with none of these — a reference how-to, a finished log, a
recipe, a clipping — is informational. Create the `note` entity but do
**not** raise an action for it. (Worked example from build-time
testing: a multi-item "edits to apply to the landing page" bullet list
is actionable; a numbered "how to clear the workspace cache"
troubleshooting guide is not, despite both being HTML lists.)

**Entity slug derivation.** Apple Notes titles are derived from the
note's first line and can be a full sentence. When slugifying for the
`note` entity, take the first ~6 meaningful words (drop filler words),
lowercase, hyphen-separate, and cap slug length at ~60 chars. Keep the
full first line available as the entity's display title. This keeps
entity ids stable and readable for any title length.

### Step 5 summary — on fetch failure

On any failure from `list_notes` or `get_note_content`:

- Log to `data/learnings/agntux-apple-notes/sync.md → errors` with
  kind `network | auth | parse | source | internal` (or the
  apple-notes-specific extension from the permitted-error-kinds list).
- Slice the errors list to the last 10 entries (newest-first) before
  writing.
- Update `last_run`, release the lock, exit.
- Step 11's transactional rule keeps `cursor` at its pre-run value; the
  next scheduled run retries the same window.

## Cursor shape for Apple Notes

The cursor is a single ISO-8601 UTC timestamp scalar on the
`sync.md → cursor` line (not a per-note JSON map). Apple Notes has no
per-note incremental feed beyond `modification_date`; a single
low-water-mark is sufficient.

```yaml
# sync.md frontmatter — example after a successful run
cursor: "2026-06-15T11:53:22Z"
```

Advance to `max(normalised modification_date)` across all notes
successfully processed this run, per Step 11's transactional rule (only
when every action write succeeded).

There is no per-note cursor key and no discovery low-water-mark
separate from `cursor`. Eviction does not apply to the cursor scalar
itself, but when a note that previously had a cursor-era
`modification_date` is deleted or becomes inaccessible, log
`apple-notes-cursor-evicted` (kind: `source`) with the note id and
title on the third consecutive access failure for that note, and
exclude it from future runs by not re-fetching content for it. (Because
the cursor is a time scalar rather than a per-note map, there is no
key to drop; the eviction log is the signal for the next run.)

## Since-parameter contract

`list_notes` does not expose a server-side `since` filter — the full
note list is returned and the agent applies the `modification_date >
cursor` filter client-side. This means:

- Every run fetches the full list (subject to `limit` paging) and
  filters locally. Volume is manageable for personal note libraries
  (typically hundreds of notes).
- There is no server-side inclusivity or precision-loss ambiguity to
  document; the cursor value is the agent's own normalised ISO-8601
  timestamp and comparison is strict-greater-than.

## Failure modes

| Symptom | kind | Action |
|---|---|---|
| `list_notes` auth error | `auth` | exit, retry next run |
| `list_notes` returns empty unexpectedly | `source` | log, exit — could be permission revoked |
| `get_note_content` returns empty body | `source` | skip note, continue |
| `modification_date` string unparseable | `parse` + `apple-notes-date-parse-failed` | skip note, continue |
| Title ambiguous, cannot resolve | `source` + `apple-notes-title-collision` | skip note, continue |
| Host MCP truncates oversized body | `source` | log `apple-notes-tool-result-truncated`, skip note, continue |
| Any network-level failure | `network` | exit, retry next run |
