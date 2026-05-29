# {{source-display-name}} fetch — Step 5 orchestration

Companion to `../SKILL.md` Step 5. Source-specific fetch logic lives
here so the SKILL body stays generic; per-plugin overrides replace this
file wholesale (see `_overrides/resources/fetch.md`).

This is the **canonical baseline** — a generic skeleton that an ingest
plugin can use unchanged when the source has a single read tool with
straightforward pagination. Plugins with multi-pass discovery
(per-channel + per-thread, search-then-thread, etc.) ship a wholesale
override at `_overrides/resources/fetch.md`.

## Step 5 — Fetch from {{source-display-name}}

Use `{{source-mcp-tools}}` to fetch items in the time window determined
in Step 4. The inline-running skill inherits whichever names the host
exposes (Cowork UUID-prefixes connector tools at the per-instance
level; npm-installed source MCPs use stable names) — call them by their
host-resolved names.

If the source's pagination/throttling behaviour is non-obvious, surface
it via `sync.md → errors` rather than silently retrying — there's no
separate "learnings" log to consult.

**Cap at 200 items per run.** If the source returns more than 200
items, process the oldest 200 first (sort ascending by the cursor
field), advance the cursor accordingly, and exit. The next scheduled
run picks up.

**On fetch failure:** log to `data/learnings/{{plugin-slug}}/sync.md →
errors` with kind `network | auth | parse | source | internal`, update
`last_run`, release the lock, exit. The errors list is bounded to the
last 10 entries per the "Bounded lists in state files" block in the
SKILL — slice before writing; do not narrate a count or trim step.

**Gap recovery:**

- Source-specific symptoms and recovery steps are documented in the
  per-source recipe in `cursor-strategies.md` (Gmail historyId expiry,
  Slack stale-ts, Jira backlog, GDrive deleted folder, HubSpot 429,
  etc.). Apply the recipe matching `{{source-slug}}`.
- Bootstrap with null cursor: filter for items created/modified within
  the bootstrap window.
- Many items in one batch (bulk import / catch-up): sort ascending,
  process oldest 200, advance cursor, exit.

For sources with a unified "discovery sweep + per-{{thread-unit-name}}
poll" shape, structure your fetch as:

1. **Step 5a — Resolve current user.** One identity call (e.g.
   `{{source-slug}}_read_user_profile`) so triage can match `to:user` /
   `@user` predicates. Persist the resolved identity into the
   source-identity fields declared in your `_overrides/frontmatter.yaml`
   (Step 11 sub-step 5 handles the write); subsequent runs skip this
   call when the field is already non-null.
2. **Step 5b — Discovery sweep.** Time-windowed search to seed the
   per-{{thread-unit-name}} cursor map. Upsert missing keys only —
   never overwrite existing cursor values; that's Step 5c's job. When
   the discovery sweep fans out across multiple queries (e.g.,
   `from:`, `to:me`, `mention`), advance any low-water-mark to
   `max(...)` of every query's newest result, not any single query's
   max. Otherwise the next run's filter under-counts.
3. **Step 5c — Per-{{thread-unit-name}} polling.** Walk every key in
   the cursor map in **cursor-stale order**: sort `Object.entries(cursor)`
   ascending by value before iterating, so the oldest cursor is fetched
   first. (Map insertion order is irrelevant; explicit sort.) For each:
   bootstrap-read using `bootstrap_window_days` if `cursor[key] ===
   null`; incremental-read using `cursor[key]` otherwise. Cap per
   {{thread-unit-name}} per run. The most-stale {{thread-unit-name}}
   must be reachable within the cap.

Plugins with deeper structure (Slack's per-thread fanout, Gmail's
two-stage discovery query) ship a fully replacement
`_overrides/resources/fetch.md`.

## Since-parameter contract (inclusivity OR precision-loss)

Source since-parameters (`oldest:`, `after:`, `updatedAfter`, etc.)
fall into two ambiguity classes:

1. **Inclusivity-ambiguity** — the boundary record may or may not be
   returned. Slack's `oldest:` is inclusive, so the cursor-boundary
   message reappears as result 1 every run.
2. **Precision-loss** — the cursor stores higher-resolution time than
   the filter accepts. Gmail's `after:` is day-granular in user-TZ
   and inclusive at the day boundary, so every run on the same
   calendar day re-fetches every message after midnight local-time.

Both classes are real; both manifest as boundary records re-appearing
in the next run's results. **Do not deliberate inclusivity at runtime.**
Each plugin's `_overrides/reference/fetch.md` documents the source's
actual behaviour (which class, exact semantics) and treats boundary
records as already-processed in the dedup step. The cursor itself
advances to the newest record in the run, not to the filter value.

## Failure modes (generic taxonomy)

For the per-source failure-mode runbook (rate limits, deletions, stale
cursors, retention purges) and the permitted `errors:` `kind:`
taxonomy, see `./runbook.md`.
