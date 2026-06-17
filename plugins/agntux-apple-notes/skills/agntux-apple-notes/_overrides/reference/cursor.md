# Cursor advance reference — agntux-apple-notes (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/cursor.md`.

Apple Notes uses the **single-scalar high-water-mark** strategy: one
ISO-8601 UTC timestamp stored on the `sync.md → cursor` line. There is
no per-note key and no per-folder key.

---

## Strategy name

**Single-scalar high-water-mark (modification timestamp)**

This is the same strategy used by the Filesystem / Notes source
documented in `canonical/prompts/ingest/cursor-strategies.md`. It
applies whenever:

- The source exposes a `modification_date` (or equivalent mtime) per
  item but no server-side `since` / incremental filter.
- Items have no parent-child relationship requiring a separate tracked
  registry.
- Volume is manageable for full-list fetch + client-side filter.

Apple Notes satisfies all three conditions.

---

## Cursor shape

```yaml
# data/learnings/agntux-apple-notes/sync.md — example after a successful run
cursor: "2026-06-15T11:53:22Z"
```

The cursor is a **scalar string**, not a JSON object. It holds the
newest `modification_date` (normalised to ISO-8601 UTC) across all
notes successfully processed during the most recent successful run. The
`validate-cursor.mjs` hook treats any string value as a
monotonically-advancing low-water-mark and will reject a write that
regresses it.

Bootstrap state:

```yaml
cursor: null
last_success: null
```

---

## Date normalisation (required before any cursor comparison)

`list_notes` returns `modification_date` as a human-readable locale
string such as `"Monday, June 15, 2026 at 11:53:22 AM"`. This format
is NOT lexicographically sortable across platform locales and MUST be
parsed to an ISO-8601 UTC timestamp before any comparison to the cursor
or to other notes' dates.

Normalisation procedure:

1. Parse the locale string using the system locale (typically `en_US`
   on macOS). The connector runs on the user's local machine; the
   locale is stable per installation.
2. Convert to UTC. Apple Notes stores times in the device's local
   timezone; treat the parsed time as local-to-device and convert.
3. Serialise to `YYYY-MM-DDTHH:MM:SSZ` (second-precision UTC, `Z`
   suffix). Sub-second components, if present, are truncated — the
   connector does not expose them and truncation is safe (strictly
   greater-than comparison is already conservative).
4. If parsing fails for any note: log an `apple-notes-date-parse-failed`
   entry to `sync.md → errors` (kind: `parse`) with the note id and the
   raw string, skip that note for this run, and do NOT advance the
   cursor on its behalf.

The cursor value itself is always written in this normalised form.
Never store the raw locale string as a cursor value.

---

## Advance rule

### Incremental run (cursor non-null)

1. After Step 5a, filter the full note list for notes where:
   `normalised_modification_date > cursor` (strict greater-than).
2. If the filtered set exceeds 200 notes, sort ascending by
   `normalised_modification_date` (oldest first) and process the first
   200 only. Advance the cursor to the newest of those 200 and exit.
   The next scheduled run picks up the remainder.
3. After all action writes for the run have succeeded (Step 11
   transactional rule), advance the cursor to:
   `max(normalised_modification_date across all notes successfully processed this run)`

**Why max-across-run and not start-of-run:** Apple Notes has no
server-side `since` filter; every run fetches the full list and filters
client-side. Using start-of-run as the cursor would skip notes modified
between Step 4's `now` capture and end-of-run on the next pass. Using
the max processed timestamp ensures the next run's filter threshold
exactly matches the last item seen.

**Why advance only on success:** the transactional rule (Step 11) gates
cursor advancement on every action write succeeding. A partial-failure
run that advances the cursor would permanently skip the failed notes on
the next run. If any action write failed, leave `cursor` at its pre-run
value; the next run retries from the same threshold.

### Bootstrap run (cursor null AND last_success null)

Filter for notes where `normalised_modification_date` falls within
`(now − bootstrap_window_days days, now]`. Default `bootstrap_window_days`
for Apple Notes is 30 (declared in `frontmatter.yaml`). Apply the same
200-note cap and ascending-sort-on-cap rule as incremental runs.

After all action writes succeed, advance cursor to
`max(normalised_modification_date)` across all notes processed.

### Cursor diff expression (Step 11)

Because the cursor is a scalar rather than a map, the diff log line is:

```
cursor advance — advanced: cursor {old_value} → {new_value}
```

Or on first-ever write from null:

```
cursor advance — added: cursor (null → {new_value})
```

There are no `added:` container keys, no `evicted:` keys, and no
tracked-parent registry entries to log. The `validate-cursor.mjs`
hook accepts the scalar form; only a regression (new value older than
old value) will be rejected.

---

## No tracked-parent registry

Apple Notes has no threading or parent-child relationships. Each note
is an atomic entity. The parent-registry question from the
source-semantics advisor:

> "When a new reply lands on an old parent, does the parent's
> `updatedAt` field bump?"

is not applicable — there are no replies, no parents. The tracked-parent
registry is **not needed** and MUST NOT be created.

---

## Edge cases

### Clock skew and backward-moving modification_date

Apple Notes syncs across iCloud. A note restored from a backup or
synced from a device with a slow clock may surface with a
`modification_date` in the past — at or before the current cursor.
This is correct behaviour: the client-side filter `modification_date > cursor`
will silently skip it, and it will NOT be re-processed.

This is intentional. A restored note whose modification_date is older
than the cursor was either already processed during an earlier run
(idempotent) or predates the bootstrap window (out of scope). Do NOT
lower the cursor to catch it — that would re-process all notes in the
gap. If the user wants the restored note ingested, they can advance
its modification_date by making a trivial edit.

A note can also appear to move backward during an active iCloud sync
race (local modification_date is later, then drops to the cloud value
after sync). The cursor's strict-greater-than filter handles this
correctly; the note will be caught on the run where its
modification_date exceeds the cursor.

### Deletions

When a note is deleted from Apple Notes, it disappears from
`list_notes` results. Because the cursor is a time scalar rather than a
per-note map, there is no cursor key to evict and no `validate-cursor.mjs`
key-drop check is triggered.

Deletions are a **log-only signal**. If a note id seen in a prior run
is absent from the current `list_notes` result AND that id is referenced
in an open action item or entity, log an `apple-notes-cursor-evicted`
entry to `sync.md → errors` (kind: `source`) with the note id and title.
Do NOT close the action item or alter the entity automatically — a
deletion may be a sync hiccup rather than a permanent removal. The user
remains in control.

Do not attempt to maintain a per-note id registry to detect deletions;
that would grow unbounded and recreate the per-note cursor map that
this strategy deliberately avoids.

### Title collisions during content fetch

`get_note_content` is keyed by note title, not by the `x-coredata://`
id returned by `list_notes`. When two notes share a title, the content
fetch may be ambiguous.

Resolution order (mirrors `fetch.md`):

1. Pass `folder` when the list result carries it — preferred path.
2. Without folder, call `get_note_content({ note_name })` and accept if
   unambiguous.
3. If multiple matches exist, prefer the match whose `modification_date`
   most closely equals the value from `list_notes` for that id.
4. If unresolvable: log `apple-notes-title-collision` (kind: `source`)
   with the note id and title; skip this note; continue. Do NOT advance
   the cursor past this note's timestamp if it is the max-candidate.

Cursor advance implication: if the highest-modification-date note this
run is a title-collision skip, the cursor advances only to the next
highest successfully processed note. The skipped note will surface again
on the next run and get another resolution attempt (e.g., if the user
has since renamed one of the colliding notes).

### Notes with identical modification_date as cursor

The filter is `strictly greater than` cursor. A note with
`modification_date == cursor` was already processed in the run that set
that cursor value and is intentionally excluded. This prevents
re-processing the boundary note on every subsequent run.

---

## `_sources.json` lookup-before-write protocol

The lookup-before-write protocol from Step 6 **fully applies** to Apple
Notes. Notes frequently mention people, companies, and projects. The
`source_id` used for lookup is the note's `x-coredata://` id — the
stable native identifier returned by `list_notes`.

Key points for this source:

- **Note entities** (if your contract permits a `note` subtype) use
  the `x-coredata://` id as `source_id`. Each note is its own atomic
  entity-source pair.
- **Person entities** extracted from note body text follow the standard
  protocol: look up by `(subtype: person, source: apple-notes, source_id: <name-slug>)`.
  If the contract permits, call any available profile tool to resolve
  an email alias and anchor cross-source dedup on email.
- **Do NOT write to `_sources.json` directly.** The agntux-core
  PostToolUse hook owns it.

There is no tracked-parent registry lookup to perform; every note is
its own top-level unit.

---

## Eviction

There are no per-note cursor keys to evict. The 30-day parent-eviction
rule from the source-semantics advisor does not apply.

The scalar cursor value is **never evicted** — it monotonically advances
or stays put. `validate-cursor.mjs` will reject any write that regresses
it.

---

## No workspace identifier capture

Apple Notes is a local-only / iCloud-personal source. There is no
tenant workspace subdomain, portal ID, or organisation URL key to
capture. The `source-identity-fields:` block in `frontmatter.yaml`
carries no workspace-scope token for this plugin.

Deep links to Apple Notes artefacts use local `notes://` URI scheme
(`notes://showNote?identifier=<x-coredata-id>`) rather than a web
permalink, so no tenant-scope identifier is needed to construct them.

---

## sync.md template (bootstrap state)

```yaml
---
plugin: agntux-apple-notes
version: 0.1.0
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

After the first successful incremental run:

```yaml
---
plugin: agntux-apple-notes
version: 0.1.0
cursor: "2026-06-15T11:53:22Z"
last_run: "2026-06-16T12:00:01Z"
last_success: "2026-06-16T12:00:01Z"
items_processed: 47
lock: null
errors: (none)
---
```

---

## Self-validation against fetch.md

| fetch.md claim | cursor.md alignment |
|---|---|
| Cursor is a single ISO-8601 UTC timestamp scalar | Confirmed — this file documents a scalar, not a map |
| Advance to max(normalised modification_date) across all notes processed this run | Confirmed — advance rule section above |
| Only when every action write succeeded (transactional rule) | Confirmed — Step 11 transactional rule section above |
| No server-side `since` filter; client applies modification_date > cursor | Confirmed — strategy rationale and advance rule both document this |
| Date normalisation required before any comparison | Confirmed — normalisation procedure section above matches fetch.md exactly |
| apple-notes-date-parse-failed on parse failure | Confirmed — edge cases and normalisation sections both reference this error kind |
| apple-notes-title-collision on ambiguous body fetch | Confirmed — edge case section documents cursor implication |
| apple-notes-cursor-evicted on deletion | Confirmed — deletions section documents this error kind |
| 200-note per-run cap with ascending sort on overflow | Confirmed — both bootstrap and incremental advance rules apply the cap |
| bootstrap_window_days default 30 | Confirmed — bootstrap rule cites the frontmatter.yaml default |
