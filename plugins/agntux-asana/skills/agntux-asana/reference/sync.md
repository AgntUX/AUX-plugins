# Ingest pass — `/agntux-asana` (sync sub-command)

## Contents

- Preflight (project root, orchestrator gate)
- What the agntux-core hooks do for you
- Bounded lists in state files
- Step 0 — Read schema and instructions
- Step 1 — Pre-flight checks
- Step 2 — Read state
- Step 3 — Acquire the soft lock
- Step 4 — Determine the time window
- Step 5 — Fetch from Asana
- Step 6 — Identify entities
- Step 7 — Update each affected entity
- Step 8 — Decide if action-worthy
- Step 8.5 — Reconcile open action items against fresh data
- Step 8.6 — Drain deferred bootstrap actions
- Step 9 — Dedupe against existing action items
- Step 10 — Write the action item
- Step 11 — Advance cursor and release lock
- Concurrent-run note
- Out of scope
- Tool surface

This skill runs **inline in the dispatch context** (no `context: fork`, no nested agent). It inherits the parent's tool surface — including UUID-prefixed Cowork connector tools like `mcp__<uuid>__asana_*` — and the parent's working-directory grant.

You are the Asana ingest pass for the `agntux-asana` plugin. You run on the user's scheduled cadence (`recommended_ingest_cadence` describes the author's intent: `Every 60 min, 7am–7pm weekdays local`). Your job is **synthesis**, not mirroring — extract entities and action items; do NOT cache raw source data locally.

If the source has write tools, this skill is **read-only** — those tools are reserved for click-time iframe envelopes (Save/Send buttons), which gate every write behind an explicit user click. The vocabulary you may write (entity subtypes, action_classes, required frontmatter) is defined in the user's tenant schema and your plugin's approved contract (Step 0); `validate-schema.mjs` blocks any write that diverges.

Every run, numbered steps 0–11, must execute in order. Source-specific orchestration (fetch shape, compose payload schema, cursor advance layers, failure-mode taxonomy) is handled by sibling reference files; routing-level links live in `../SKILL.md`.

---

## Always check first (preflight)

Before Step 0, run TWO guards in order:

### Project root

<!-- canonical-mirror: agntux-core/skills/_resolve-root.md -->

Resolve the AgntUX project root via this ladder. Stop at the first match:

1. **`basename(cwd).toLowerCase() === "agntux"`** → use cwd silently.
2. **Any ancestor of cwd has `basename().toLowerCase() === "agntux"`** → use the nearest. Emit one short line: "Working in the agntux project at `{root}`, found above your current directory.", then continue.
3. **`~/agntux/` exists and is a directory** → use it. Emit one short line: "Using your AgntUX project at `~/agntux`.", then continue.
4. **None of the above**:
   - **Scheduled-task fire (no user present)** — most invocations of this skill. Exit cleanly with no user-facing message. Do NOT touch source data, do NOT call source MCPs, do NOT advance any cursor. The next scheduled run will retry; if `~/agntux/` is never created, ingest stays idle (correct behaviour).
   - **Interactive invocation (the user typed `/agntux-asana` themselves)** — ask once, verbatim:

     > "I don't see an AgntUX project yet. Want me to set one up at `~/agntux` now? (yes / no)"

     - **yes** → invoke `/agntux onboard` (it owns the full create-and-pick flow). Exit this skill; onboarding carries the conversation.
     - **no** (or anything else / no response) → reply "Okay — let me know when you're ready." and stop. Do NOT touch source data, do NOT call source MCPs, do NOT advance any cursor.

Throughout the rest of this skill, `<agntux project root>` refers to whichever directory the ladder above resolved to.

### AgntUX orchestrator gate

Check whether `<agntux project root>/user.md` exists.

**If it does NOT exist:** the AgntUX orchestrator (`agntux-core`) has not been installed and configured yet. Print this message verbatim and stop:

> "This plugin needs AgntUX Core to be installed and configured first. Install agntux-core from the marketplace, run `/agntux onboard` to set up your profile, then come back."

**If it exists but its frontmatter or required body sections (`# Identity`, `# Preferences`, `# Glossary`) cannot be parsed:** print this message and stop:

> "user.md looks malformed. Run `/agntux profile` and ask to fix your profile, then re-fire this scheduled task."

**If it exists and parses cleanly:** proceed to Step 0.

---

## What the agntux-core hooks do for you

**Hooks own** (you don't): `actions/_index.md`, `entities/{subtype}/_index.md`, `entities/_sources.json` (maintained by `maintain-index.mjs` PostToolUse); frontmatter / `schema_version` / `subtype` / `reason_class` validation (rejected by `validate-schema.mjs` PreToolUse with an executable runbook); cursor-map shape, monotonic low-water-marks, silent key drops (rejected by `validate-cursor.mjs` PreToolUse); write-lane enforcement against the "Out of scope" taxonomy (`validate-write-lane.mjs` PreToolUse).

**You own**: reading `actions/_index.md` for dedup (Step 9) and reconciliation (Step 8.5); writing entity / action body content with the section-preservation rule (Step 7 / Step 10); advancing the cursor map and releasing the lock (Step 11), expressing the change as a diff and only when every action write this run succeeded; slicing bounded lists to their cap before writing.

If a PreToolUse hook rejects with a runbook, execute the runbook verbatim and retry — don't hand-edit around the rejection.

---

## Bounded lists in state files

Before writing any of these files, slice the named section/list to the cap shown — evict oldest. Files not listed here are not capped.

- `data/learnings/agntux-asana/sync.md → errors` — last 10. Newest-first.

**Order rule:** trim, then append, then write — never the other order. Read the current list, append the new entry, slice to the cap, write atomically. One read-modify-write batch per run, not a write followed by a corrective re-edit.

**Permitted `errors:` `kind:` taxonomy** lives in `./runbook.md` (single source of truth; the agntux-core hook reads from the same list). Every `errors:` entry MUST declare a `kind:` from that taxonomy or its source-specific extension (declared in your `_overrides/frontmatter.yaml`). There is no `kind: debug` and no journal prose — see Step 11.


---

## Step 0 — Read schema and instructions (P3a — pre-flight gate)

Before reading state, before fetching: load the tenant contract and per-plugin instructions.

1. **`<agntux project root>/data/schema/schema.md`** — the tenant master contract. If missing, the user has not bootstrapped the schema yet. Exit cleanly with no message; the next run retries.

2. **`<agntux project root>/data/schema/contracts/agntux-asana.md`** — your plugin's approved permit. If missing, exit with one stderr line and no user-facing message:

   ```
   agntux-asana pre-flight: contracts/agntux-asana.md missing — run `/agntux onboard`; will retry on the next scheduled tick.
   ```

   Do NOT proceed without an approved contract. The data-architect's Mode B reads the proposal from `marketplace/listing.yaml → proposed_schema` during `/agntux onboard` (or Mode A-bis re-entry); the next scheduled run picks up once the contract lands.

3. **Compare schema_version** in your contract against `schema.md`'s. Lower MAJOR → exit with `agntux-asana pre-flight: contract schema_version lags master; awaiting architect refresh.` Same MAJOR, lower MINOR → pass through and append a `contract-minor-out-of-date` entry to `sync.md → errors`. Same or higher → pass.

4. **Read your contract** end-to-end. Extract `# Allowed entity subtypes`, `# Allowed action classes`, and any aliases/merges from `# Notes`.

   **Per-plugin contract-lock routing.** If your rendered skill ships a `./contract-lock.md` reference file (your plugin's `_overrides/reference/contract-lock.md` exists), load it now and follow its routing — it owns lock-drift detection (`plugin_contracts["agntux-asana"]` present in `schema.lock.json` and version-aligned). Per the autonomy-boundary rule in "Out of scope", the per-plugin contract-lock reference MUST be exit-clean (no writes to `data/schema/`); on drift it appends a `contract-version-drift` or `contract-not-registered` entry to `sync.md → errors` and exits. The architect's `/agntux schema` Mode B owns the lock fix; the next scheduled run picks up clean. Plugins that don't ship a `contract-lock.md` rely on `validate-schema.mjs`'s self-healing runbook at first action-write time.

5. **`<agntux project root>/data/instructions/agntux-asana.md`** — per-plugin user instructions. If missing, treat all sections as empty. If present, parse `# Always raise` / `# Never raise` / `# Rewrites` / `# Notes`.


Cache contract and instructions in working memory for this run; you'll re-consult them in Steps 6 / 8 / 10.

---

## Step 1 — Pre-flight checks

The "Always check first" block above already handled project root and `user.md` parseability. Here, only re-confirm: if `user.md` cannot be parsed (rare race), exit cleanly and log a structured error to `<agntux project root>/data/learnings/agntux-asana/sync.md` with kind `usermd-malformed`.

---

## Step 2 — Read state (every run)

Read these files on **every** run. Do not cache values between runs; treat each file as authoritative on each invocation.

1. **`<agntux project root>/user.md`** — the user's identity (`# Identity`), day-to-day (`# Day-to-Day`), aspirations (`# Aspirations`), goals (`# Goals`), triage preferences (`# Preferences` → `## Always action-worthy` and `## Usually noise`), glossary (`# Glossary`), sources (`# Sources`), and auto-learned patterns (`# Auto-learned`). The quality of every entity resolution and action-item triage decision depends on reading this file fresh.

2. **`<agntux project root>/data/learnings/agntux-asana/sync.md`** — your section-of-one. Read `cursor`, `last_run`, `last_success`, `items_processed`, `errors`, `lock`, and any **source-derived identity fields** the plugin persists (declared in your `_overrides/frontmatter.yaml` under `source-identity-fields:` — typical examples: `user_id`, `workspace_subdomain`, `account_id`). Identity fields are cursor-lifetime state: capture once on first observation (Step 5a's identity call), reuse forever, never re-derive from re-fetching.

   - If the file does not exist, create it from the standard template with: `cursor: null`, `last_run: null`, `last_success: null`, `items_processed: 0`, `errors: (none)`, `lock: null`, and each source-identity field set to `null`. Write atomically (temp-write, fsync, rename).
   - The sync-file path is **per-plugin** (`data/learnings/agntux-asana/sync.md`). The legacy `.state/sync.md` shared file and the entire `state/` directory are retired — the only writable surface for ingest plugins outside `entities/` and `actions/` is `<agntux project root>/data/learnings/agntux-asana/`.

3. **`<agntux project root>/actions/_index.md`** — to dedupe new action items against existing open and recently-resolved ones (across **all** plugins, not just yours — this is what makes the cross-source merge in Step 9 work). If the file does not exist, proceed.

When reading `data/learnings/agntux-asana/sync.md`, also capture:
- `user_gid` — the authenticated user's Asana GID. Null on first run;
  Step 5a resolves and Step 11 persists it.
- `workspace_gid` — the primary Asana workspace GID. Null on first run;
  Step 5a resolves and Step 11 persists it.

Both are cursor-lifetime fields: once non-null, treat them as stable
for deep-link construction and `modified_since` filtering without
re-calling the identity endpoint.

There is no per-plugin "learnings" file. Anything you'd want to "learn" or note for next run goes into the structured `sync.md → errors` list (transient, last-10 entries) or — if it's a structural ask the user must approve — escalates via the user-feedback flow (out of your lane; see "Out of scope").

---

## Step 3 — Acquire the soft lock

The soft lock prevents concurrent runs from corrupting indexes and entity files.

1. In `data/learnings/agntux-asana/sync.md`, locate the `- lock:` line.
2. Parse it:
   - Free: `- lock: null`
   - Held: `- lock: held by <holder> since <RFC 3339>( (pid <int>))?`
3. **If free OR if held but `since` is more than 1 hour ago (stale):** acquire the lock by rewriting that line to:
   ```
   - lock: held by agntux-asana@0.2.0 since {now RFC 3339} (pid {pid})
   ```
   Update frontmatter `updated_at` to now. Write atomically (temp + fsync + rename). Re-read immediately and verify the lock line is yours. If it is not (race lost), log kind `lock-acquire-race` and exit cleanly.
4. **If the write itself fails:** log a one-line error with kind `lock-acquire-failed`, and exit. Do NOT proceed without the lock.
5. **If held and not stale:** exit silently. The next scheduled run will retry.
6. **If your run crashes mid-loop:** do not attempt to write a "crashed" status. The next scheduled run will see the stale lock (> 1 hour) and reclaim it.

---

## Step 4 — Determine the time window

- **Bootstrap run** (`cursor: null` AND `last_success: null`): Read `bootstrap_window_days` from `user.md` frontmatter (default 30 for Asana, valid range 1–365 per P3 §6.1). If missing, use 30. If outside range, treat as 30 and append a `bootstrap_window_days-out-of-range` entry to `sync.md → errors`. The time window is `(now − bootstrap_window_days days, now]`.

- **Incremental run** (`cursor` non-null OR `last_success` non-null): the time window is `(cursor, now]` expressed in `Single low-water-mark ISO 8601 timestamp cursor keyed on task modified_at; advances to the newest task modified_at seen this run. Bootstrap uses the same field filtered to (now − bootstrap_window_days days, now]. Asana's modified_since parameter is exclusive at the boundary, so the cursor value itself is safe to re-use as the filter without re-fetching the boundary task.`. Do not re-process items already covered.

The cursor is advanced per the source-specific rule documented in your plugin's contract / cursor-strategies guide and the cursor-map reference. Where the strategy says "use start-of-run timestamp," that prevents a race with items modified during the run.


---

## Step 5 — Fetch from Asana

Source-specific fetch orchestration — discovery sweep, per-task polling, thread fanout, truncation handling — is handled by the fetch shape (the per-source recipe loaded from your plugin's reference siblings). Apply that recipe at the start of Step 5.

The summary contract this skill imposes regardless of source:

- Use `get_my_tasks, get_task, get_tasks, get_projects, get_project, get_status_overview, get_users, get_user, search_tasks` to fetch items in the time window from Step 4.
- Cap at 200 items per run; sort ascending and exit early on cap.
- On any fetch failure, log to `sync.md → errors` with kind `network | auth | parse | source | internal`, update `last_run`, release the lock, exit. Step 11's transactional rule keeps the cursor at its pre-run value.
- Per-source failure modes, gap recovery, and worked examples: apply the runbook taxonomy.

---

## Step 6 — Identify entities (for each fetched item)

> **Triage operates on the merged thread, not the parent in isolation.** Before extracting entities (Step 6) or deciding action-worthiness (Step 8) on any thread-rooted artefact, you MUST construct an in-memory merged view (parent + replies, chronological, with author + ts labels). Entity extraction, triage decisions, and `## Why this matters` body composition all read this merged view.

For each item, extract every distinguishable entity. **Subtypes are NOT inline in this prompt** — read them from your contract (Step 0). Common kinds (only when your contract approves them): `person`, `company`, `project` (codenames per `user.md → # Glossary`), `topic`.

If a useful kind isn't in your contract, log a `subtype-out-of-contract` entry to `sync.md → errors` instead of writing — the validator would block the write, and the error surfaces in the next AgntUX session so the user can run `/agntux schema edit`.

For each candidate entity:

1. **Derive the slug.** P3 §2.4: lowercase, NFKD strip diacritics, hyphenate, trim, ≤64 chars.

2. **Lookup-before-write** (normative): (a) read `<agntux project root>/entities/_sources.json` (treat not-found as empty); (b) look up `(subtype, source: "asana", source_id: "{parent-id}")` — **use the parent's identifier for thread-rooted artefacts** to avoid N duplicate source-rows; (c) if found, open the existing entity and proceed to Step 7; (d) if not, search secondary identifiers (Grep on slug, natural-language variations, source-specific aliases) and on match add the new variation to `aliases:`; (e) only when no match exists, create a new file.

3. **Create a new entity file** with required frontmatter from `entities/{subtype}.md` (validator rejects missing fields). Body sections, all four required, in order: `## Summary` (one-paragraph synthesis), `## Key Facts` (bullets, or empty), `## Recent signals` (empty until Step 7 fills it), `## User notes` (preserved verbatim across re-ingests). Create the subtype directory if absent.

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

**Slug collision:** if the slug already exists for a different real-world entity, append a disambiguator (employer slug for people, parent-org for projects, year for time-bounded topics) and add the bare short name to `aliases:` on both files.

---

## Step 7 — Update each affected entity

> **Read all affected entity files in a single parallel-tool-call batch before any edits.** A typical run touches 3–6 entities and they have no read-time dependency on each other; sequential read-then-edit per entity burns context and wall-clock for no reason.

For each entity resolved in Step 6, apply the **section-preservation rule** (P3 §3.2.1):

1. Read the existing file.
2. Capture the byte span from `## User notes` (inclusive) to end-of-file, verbatim.
3. Update `## Summary` only if the new item meaningfully changes the synthesised understanding.
4. Update `## Key Facts` if the item carries a new structured fact.
5. Append to `## Recent signals`: one bullet `- {YYYY-MM-DD} — asana: {one-line summary}`. Newest at top. Prune entries older than 30 days from the bottom. **Cite each task once per ingest run, not once per reply / message.** If the same task is touched in a subsequent run with new activity, update the existing matching bullet in-place rather than duplicating it.
6. Re-attach `## User notes` verbatim at the end, byte-for-byte.
7. Update frontmatter `updated_at` and `last_active` to today.
8. **Advance `sources[].last_seen_at`.** The entity body's `sources:` array carries `{source, source_id, last_seen_at}` triples. Find the entry where `source: asana` AND `source_id: {parent-task-id}` and advance its `last_seen_at` to the run's start time. **Append a new triple only if no existing entry matches the (source, source_id) pair** — never duplicate an existing pair. Updating `## Recent signals` (sub-step 5) without also advancing the matching `last_seen_at` is a bug; downstream features filter on `sources[].last_seen_at`, not on body prose.
9. Write atomically (temp + rename). Confirm section order: `## Summary`, `## Key Facts`, `## Recent signals`, `## User notes`.

**Archive split:** if the file approaches 2,000 lines, perform the P3 §3.4 archive split before adding the new activity line.

**Do NOT write to `_sources.json` directly.** The agntux-core PostToolUse hook updates it after every entity write. (`_sources.json` is the cross-entity index; the per-entity `sources:` array in sub-step 8 is yours to maintain.)


---

## Step 8 — Decide if action-worthy

> **Triage operates on the merged thread, not the parent in isolation.** Construct the merged view before applying the heuristics below.

Use your judgment plus `user.md → # Preferences` and your `data/instructions/agntux-asana.md` rules.

**Volume cap:** 10 *fresh* action items per run. **Cap-overflow rule:** when a run has already raised 10 fresh actions and a further candidate passes Step 8a + the heuristics below, write the candidate to `actions/{YYYY-MM-DD}-{slug-suffix}.md` with `status: deferred` and `deferred_at: <now RFC 3339>` (instead of `status: open`). Do NOT compose a `## Compose payload` or call Step 10.1 — deferred items are placeholders. Step 8.6 of the next run drains them. (Drained items do NOT count toward the next run's cap; see Step 8.6.)

**Asana-specific raise signals:**

- Task assigned to the user with `due_on` within 7 days → lean raise.
- Task that was previously unassigned and is now assigned to the user
  this run → raise (new assignment).
- Comment/story where the author's `email` matches the user's email in
  `user.md → # Identity` is the user themselves → suppress for
  response-needed triage (the user wrote it; they don't need to respond
  to themselves).
- Comment that mentions the user by `@name` (match against `user.md →
  # Identity` display name or email prefix) → raise `response-needed`.
- Project status update where the status changed to `off_track` or
  `at_risk` for a project the user is a member of → raise.
- Task completed by someone other than the user (status transitioned
  to `completed: true` this window) → suppress unless the task was
  blocking a deadline; quietly update the entity `## Recent signals`.

**Suppress signals (Asana-specific):**

- System stories (`type: system` — task created, assigned, moved) →
  suppress; these are state transitions, not human communication.
- Tasks completed more than 7 days ago (already outside the action
  horizon) → suppress.
- Tasks in projects the user is only a guest of with no direct
  assignment or mention → low-confidence; suppress unless heuristic 6
  applies.

### Step 8a — Reply-state scan (skip if user already replied)

Pure read over the in-memory fetch buffer; no new MCP calls. For each `response-needed` candidate, in order:

1. Find the latest message authored by the resolved user identity (Step 5a) in the candidate's scope (thread-rooted → merged thread; channel-/inbox-level → recent fetched items).
2. If the user has NOT authored a message after the candidate trigger → fall through to the heuristics list.
3. After that user-reply ts, scan for ANY of: `?`, `@<user_id>`, `/by EOD|tomorrow|by [day]/i`, `/urgent|asap|blocker|sev[123]/i`. **Match → raise**, citing the trigger in `## Why this matters`. **No match → skip**, no log entry. Done.

The scan is a 4-line decision, not a deliberation. Do not narrate "but what if" cases — the rule exists; let it run.


Apply heuristics in order:

1. **Per-plugin instructions take priority.** A `# Always raise` rule raises (subject to the cap); a `# Never raise` rule skips (subject to heuristic 6).
2. `user.md → ## Always action-worthy` → raise.
3. `user.md → ## Usually noise` → skip, unless heuristic 5 or 6 fires.
4. `# Auto-learned` pattern → weight per the pattern.
5. Deadline within 7 days → lean toward raising.
6. **Tiebreaker:** explicit user-directed evidence (tags / names / `@user` mention) always overrides `# Never raise` and preference filters.


If you decide to raise, proceed to Step 9.

---

## Step 8.5 — Reconcile open action items against fresh data

After triage and before dedup, reconcile **already-open** action items against the freshly-fetched data — and, where needed, a bounded re-check of the source — so items anyone has since handled don't stay open and noisy, and items whose underlying artefact changed don't keep showing stale content (including a stale pre-drafted body). The per-source "what counts as resolved / changed" signals are declared at the end of this step; the generic detection skeleton is the reconcile reference shape (`./reconcile.md`).

1. **Collect candidates.** Scan `actions/_index.md` for entries with `status: open` AND `source: asana` — **all `reason_class` values, not just `response-needed`.** Also include cross-source-merged actions whose body lists a `asana task: {id}` line under `## Cross-source links` (a user reply in your source can resolve a merged action originally raised by another plugin — but only the reply signal, per the cross-source rule in step 3).

2. **Resolve the latest state per candidate** by `source_ref` (or the `## Cross-source links` id):
   - If the artefact was touched in this run's fetch, use that merged view.
   - Otherwise do a **bounded targeted re-check** — re-read just that artefact via `get_my_tasks, get_task, get_tasks, get_projects, get_project, get_status_overview, get_users, get_user, search_tasks` (read-only). Cap at **25 re-checks per run**, highest-priority / oldest-open first; if the cap is hit, leave the rest for the next run (no error). If the re-check returns a **positive** "deleted / not found" response, treat as resolved-by-deletion; if it instead **errors** (auth / permission / network / rate-limit / ambiguous), do NOT resolve — log `asana-reconcile-failed` and leave the item unchanged this run.

3. **Classify and act** (the per-source signal list at the end of this step defines each branch):
   - **Resolved** — the source artefact is closed / done / cancelled / declined / deleted / archived per your signal list, OR (for `response-needed`) the user has now replied with no qualifying follow-up after their reply (Step 8a's scan). **For a cross-source-merged candidate (`source != asana`), only the user-reply signal resolves — a terminal/deletion state in your source must NOT close a need owned by the sibling source.** → Rewrite the file with `status: done`, `completed_at: <now RFC 3339>`, and append (after `## Personalization fit`, never overwriting existing content):

     ```markdown
     ## Auto-resolved
     {YYYY-MM-DD HH:MM} — {one line naming the detected signal, e.g. "Issue transitioned to Done in Asana" or "User replied via asana with no follow-up"}. Closed automatically. If this was wrong, re-open from `actions/_index.md`.
     ```

   - **Changed-but-valid** — the artefact still needs the user but its substance moved (new deadline, edited body, new participants, changed amount / owner / status-short-of-resolved). → Rewrite `## Why this matters` to current reality, refresh affected frontmatter (`due_by`, `priority`), and re-run **only Step 10.1's payload-composition (its sub-steps 1–5)** to regenerate the view payload section(s) so the pre-drafted content isn't stale — this branch already handled `## Why this matters`, so don't re-derive it. (A view that hydrates from inline click-time args rather than an on-disk payload section has nothing to regenerate; just refresh `## Why this matters` and frontmatter.) Keep `status: open`; update `updated_at`.
   - **Unchanged** — leave untouched. Step 9's dedup prevents a duplicate this run.

4. Write atomically (temp + rename). The agntux-core PostToolUse hook updates `actions/_index.md` — do NOT touch `_index.md` directly. A re-check **read** failure is non-fatal lifecycle bookkeeping over an already-raised item: skip that candidate, log a `asana-reconcile-failed` entry, and do **not** let it affect cursor advancement (a flaky re-check must never stall fresh ingest). Only a failed reconcile **write** participates in Step 11's transactional gate, exactly as a fresh Step 10 write does.

This is a real automated state transition (`open` → `done`, or an in-place content refresh, without a user click). The honesty rules and "Out of scope" sections document this authority. Keep it conservative: when a signal is ambiguous, prefer leaving the item open over a wrong auto-close.

- **Resolved when** — the task's `completed` field is `true`, or the task was deleted. Treat a not-found on re-check as resolved-by-deletion.
- **Changed-but-valid when** — assignee, `due_on`, or task notes changed; refresh `## Why this matters` and the action's frontmatter (the view hydrates from inline args at click time, so there's no on-disk payload section to regenerate).
- **Re-check via** — `get_task` by the action's `source_ref` (task gid); a not-found / 404 / 410 means deleted.

---

## Step 8.6 — Drain deferred bootstrap actions

When a prior run hit Step 8's cap, excess candidates were written with `status: deferred`. Drain them now, before fresh candidates compete for the cap.

1. Scan `actions/_index.md` for `status: deferred` AND `source: asana`.
2. For each, read the file. Three branches by cursor state at the originating task's key:
   - **Evicted from the cursor map** (deleted / permission-revoked / retention-purged): emit `asana-deferred-orphan: <id>` to `sync.md → errors`; leave the prior file in place; do NOT re-fetch.
   - **Unchanged since the deferred run's `created_at`**: re-emit the prior body verbatim as `actions/{today}-{slug-suffix}.md` with fresh `created_at` and unchanged `priority` / `reason_class` / `reason_detail`. Run Step 10.1 and Step 9 dedup. Mark the prior file `status: superseded`, `superseded_at: <now RFC 3339>`, `superseded_by: {new-id}`.
   - **Advanced** (new replies since deferral): re-derive against the latest merged view, run Step 8a. Raise-worthy → fresh file as above; Step 8a skips → mark the prior file `status: dismissed`, `dismissed_at: <now RFC 3339>`, `dismissed_reason: superseded-after-reply`; do not write a new fresh-dated file.
3. **Cap rule.** Drained re-emissions do NOT count toward Step 8's 10-cap; re-emission of already-triaged work is bookkeeping. Step 9's same-source dedup keys apply to the fresh-dated file. No-op if no deferred entries match.

---

## Step 9 — Dedupe against existing action items

Scan `actions/_index.md` for entries matching `related_entities` and `reason_class`. Read candidate duplicates in full.

**Same-source dedup (asana vs. asana):**

Dedup keys on parent `source_ref`. For thread-rooted items, `source_ref` is the parent thread identifier (a new reply on a thread that already raised an action does not raise a second one).

- Already open with same `source: asana` and matching `source_ref` → do NOT create a duplicate. Optionally update the existing `## Why this matters` body to cite the new evidence.
- Recently done (within 7 days) → do NOT re-raise unless a clear escalation (new deadline, raised severity, different actor).
- Recently dismissed → do NOT re-raise.

**Cross-source merge** — when this candidate is `reason_class: response-needed` AND another plugin (`source != asana`, `reason_class == response-needed`) has an open action created within the last **48 hours**, apply the LLM-judged topic-overlap test: read the sibling's `## Why this matters` body and your merged-view content; decide whether they're the same conversation/topic/decision in different channels. Person-overlap alone is NOT a sufficient match.

If you judge overlap:
- **Edit the existing action file** (do not create a new one). Preserve existing `suggested_actions` rows; append a `Draft a asana reply` row plus an `Open in Asana` row (omit the latter if the deep-link tenant identifier is null — apply the deep-link reference rule).
- Append a `## Cross-source links` body section (newest first): `- asana task: {identifier} — added {YYYY-MM-DD HH:MM}`.
- Append a `## Compose payload (asana)` body section under a namespaced header so your view tool reads it without colliding with a sibling plugin's payload. Schema: apply the compose-payload reference shape.
- Update `updated_at` frontmatter. Append a structured `asana-merged-into-{existing_id}` entry to `sync.md → errors` (per `./runbook.md`'s `kind:` taxonomy — this is one of the canonical permitted kinds). Skip creating a new file.

If no overlap match: write a fresh action file as normal (Step 10).

---

## Step 10 — Write the action item

Write `<agntux project root>/actions/{YYYY-MM-DD}-{slug-suffix}.md` conformant to the tenant schema. The compose / canvas payload schema is the compose-payload reference shape.

**`reason_class` MUST be in your contract's `# Allowed action classes`.** The validator hook rejects any other value.

The date component is `created_at` localised to the user's timezone. Slug-suffix per P3 §2.4. Collision: append `-2`, `-3`, etc.

**Construct the `Open in Asana` URL FIRST** (before assembling the suggested_actions block) per the deep-link reference rule. If the source's tenant identifier is null this run, set the URL to `null` and omit the row from the YAML below.

**Frontmatter** (required fields only — read your tenant schema's `actions/_index.md` for the canonical list; the validator rejects missing fields):

```yaml
id: {YYYY-MM-DD}-{slug-suffix}
type: action-item
schema_version: "1.1.0"
status: open
priority: {high|medium|low per priority anchoring rules below}
reason_class: {one of your contract's allowed action classes}
reason_detail: {≤120 chars; required when reason_class is "other"}
created_at: {RFC 3339 UTC}
source: asana
source_ref: {opaque source-native identifier}
related_entities:
  - {subtype}/{slug}
  - …
due_by: {YYYY-MM-DD or RFC 3339, if a deadline is present; omit if not}
snoozed_until: null
completed_at: null
dismissed_at: null
suggested_actions:
  - label: "{≤40 char display label}"
    host_prompt: "Use the agntux-asana plugin to {imperative} for action {id}"
  # next row only when deep_link_url is non-null:
  - label: "Open in Asana"
    url: "{deep_link_url}"
```

**Priority anchoring** (P3 §4.3): `high` = deadline within 48 hours, top-account / direct-manager / VIP, or reversible cost > ~$10K. `medium` = default for items the user wants but won't suffer harm from delay. `low` = borderline-actionable.

**`suggested_actions` rules:** 1–4 buttons; each row carries **either** `host_prompt` (chat-message envelope routed via view-tool description matching) **or** `url` (host openLink), never both, never neither. `host_prompt` strings are a **natural-language description** of the action — `Use the agntux-asana plugin to {imperative} for action {id}` — and reference `{id}`; trigger phrases are owned by the view tool's `description` field, not by Step 10. **Never emit a slash command** (`/agntux-asana …`): the host fires slash commands only when the user manually types `/` and picks from the menu, so a slash command sent programmatically via `sendFollowUpMessage` is inert text the host cannot route — describe the action instead. The drafted reply body is pre-composed into `## Compose payload` at Step 10.1; `host_prompt` itself carries the routing intent only. The legacy `"ux: …"` prefix and the older bare-slash form are still accepted by the marketplace schema for backwards compatibility with action items already on disk, but new writes MUST use the natural-language form. (For status-mutating actions the imperative MUST keep the exact phrase agntux-core's optimistic-hide guard matches — `set action {id} status to done`, `snooze action item {id}`, or `dismiss action item {id}`.)

**Apply `# Rewrites` from `data/instructions/agntux-asana.md`** when composing action body or labels. If the user has a `# Notes` rule like "keep action descriptions terse," tighten `## Why this matters` to 1–2 sentences.

### Step 10.1 — Gather file-store context and pre-compose the view payload

Run for **every** action that ships a suggested action which opens one of your plugin's views — draft a reply, create/update a note, propose a status transition, suggest a share-link config, propose meeting time-slots, and so on, **not only literal replies**. Pre-composing the view's payload at ingest is **mandatory, not optional**: the view tool lifts it from disk at click time (the user never sees this prompt), so an action whose payload is missing or empty renders a blank iframe and forces Cowork to re-derive the work the ingest pass should already have done. (The one exception: a Step 8 cap-overflow placeholder written with `status: deferred` carries no payload until Step 8.6 drains it.) Any drafted text should sound like the user, not the agent.

1. **Re-consult `user.md`** (in working memory from Step 2): `# Identity`, `# Preferences` (tone, length, sign-off), `# Glossary`, `# Goals`.
2. **Re-consult `data/instructions/agntux-asana.md`** (parsed in Step 0): `# Notes`, `# Rewrites`, signal-weighting from `# Always raise` / `# Never raise`. Do NOT inject signatures or "as discussed" padding.
3. **For each entity in `related_entities`**, re-read its file for relationship context beyond what Step 7 just wrote.
4. **Grep `actions/`** for files whose `related_entities` overlaps. Read up to 3 most-recent within 14 days — detect active workstreams and items the user already responded to.
5. Feed all of the above into the drafted/suggested fields and `personalization_signals` of the per-view payload section(s) this action ships — `## Compose payload` and/or the per-view `## <View> payload` sections enumerated at Step 10.1b — **using the exact field names that view's handler reads.**

If `data/instructions/agntux-asana.md` doesn't exist yet (cold-start), proceed with `user.md` alone.

**Body** (required sections):
```markdown
## Why this matters
{1–4 sentences. Reference [[entities]] using bare-slug wiki-link form.}

## Personalization fit
- Matches "{rule}" (per user.md / instructions)
- {additional bullets citing specific user.md or instructions patterns}
```

**Conditional body section: `## Compose payload`** — REQUIRED for every action item that ships a suggested action that opens a compose/editor view (a drafted reply, a note body, or any other view pre-fill — not only literal replies). Schema and YAML quoting rules are defined by the compose-payload reference shape.

**Step 10.1b — Per-view payload sections (REQUIRED).** `## Compose payload` is only the draft-a-reply case. For **every** view tool your plugin ships whose handler reads a `## <View> payload` body section, you MUST write that section to the action file whenever the action ships the suggested action that opens that view — otherwise the view renders an empty envelope (blank fields, fallback text like "Untitled event" or "… data is unavailable"). Each section's schema lives in the matching `reference/<view>-payload.md`. **The keys you write MUST exactly match the field names that view's handler reads** — the field-coverage guard (lint E35) fails the build on any field a view reads that the ingest skill never writes — and every key MUST be pre-populated with real composed content: a present-but-empty section is the same defect as a missing one. The per-view sections this plugin writes — and the action class that triggers each — are enumerated below.

---

## Step 11 — Advance cursor + release lock

After processing all items:

1. **Transactional rule.** Only advance `cursor` (and any source-specific low-water-mark) if **every action write this run succeeded.** If any write failed (validator rejection, IO error, schema violation), persist `last_run`, `errors`, and the lock release, but leave `cursor` and any low-water-marks at their pre-run values and leave `last_success` unchanged. The next run retries the same window. Entity writes are idempotent via the lookup-before-write rule and persist regardless.
2. **Single-write rule.** Build the new `sync.md` content in memory in **one** pass — apply the cursor diff, run-stats updates, source-identity persistence, lock release, and any new `errors:` entries (trim, then append, per the bounded-lists rule) against the file's pre-run snapshot — then write **once** atomically (temp + fsync + rename). Multiple sequential `Edit sync.md` calls in this step are a bug.
3. **Express cursor advancement as a diff** over the prior map: keys added (with initial value), keys advanced (old → new), keys evicted (with the matching `asana-cursor-evicted: <key>` entry in `errors`). The `validate-cursor.mjs` PreToolUse hook rejects writes that drop a key without an eviction log entry, or that regress a low-water-mark. Per-source layer table: apply the cursor reference rule.
4. **Update run stats**: `last_run`, `last_success` (only when the transactional rule allows it), increment `items_processed`.
5. **Persist source-derived identity** captured this run (Step 5a / equivalent) into the fields declared in your `_overrides/frontmatter.yaml → source-identity-fields:`. Capture once on first observation; once a field is non-null, do not overwrite. This is cursor-lifetime state, not per-run state.
6. **Release the lock**: `- lock: null` as part of the same write.

**Asana cursor advance (Step 11 sub-step 3):**

The Asana cursor is a single scalar ISO 8601 string (not a JSON map).
Express the diff as:

```
cursor: null → "2026-06-26T14:30:00.000Z"   # first run
cursor: "2026-06-25T09:00:00.000Z" → "2026-06-26T14:30:00.000Z"  # incremental
```

Set the new cursor to `max(modified_at)` across all tasks processed
this run — NOT to the run start time. Using `modified_at` of the newest
task prevents re-fetching tasks already processed when the next
`modified_since` filter is applied.

There is no per-task cursor map and no per-task eviction for Asana:
the single low-water-mark covers all tasks in the feed. Log
`asana-cursor-evicted` only when a task GID fails three consecutive
times (auth/permission/deletion) — in that case, the task is gone from
the feed and the cursor naturally moves past it.

**Source-identity persistence (Step 11 sub-step 5):**

Write `user_gid` and `workspace_gid` into `sync.md` frontmatter if
captured for the first time this run (null → non-null). Once set,
never overwrite. These fields MUST be included in the single atomic
`sync.md` write alongside the cursor advance and lock release.

**Final summary, max 200 words.** Format: `N actions raised, N escalated, N auto-resolved, N entities updated, N cursors advanced.` One bullet per raised action with a file path. Quiet runs get a one-line summary.

**No narration.** The chat summary IS the run output. The run is otherwise expressed through cursor advances, action writes, entity edits, and `errors:` entries scoped to `./runbook.md`'s permitted-`kind:` taxonomy. Entries that don't change the next run's behaviour do not belong in `errors:`. Multi-run pattern learning lives in `user.md → # Auto-learned`; user corrections in `/agntux feedback`.

---

## Concurrent-run note

If two ingest plugins run concurrently, agntux-core's index hook may briefly show one plugin's new files missing from `_index.md`. Don't manually edit `_index.md` — it's hook territory. The next write to either file repairs it.

## Out of scope

This section is a **hard write-lane taxonomy**, not advisory prose. Any write that would land outside the permitted lanes below MUST be **refused** at compose time — append a `kind: out-of-lane-write-attempted: <attempted-path>` entry to `sync.md → errors` (per `./runbook.md`), continue the run, and never invoke the underlying `Write` / `Edit` tool against the off-lane path. The agntux-core hook `validate-write-lane.mjs` is the defence-in-depth backstop, but the prompt is the load-bearing rule.

### Permitted write lanes

You MAY write to (and only to):

- `<agntux project root>/entities/{subtype}/{slug}.md` — Step 6 / Step 7 entity creation and updates (with the section-preservation rule, including the `sources[].last_seen_at` advancement in Step 7 sub-step 8).
- `<agntux project root>/actions/{YYYY-MM-DD}-{slug}.md` — Step 8 cap-overflow deferrals, Step 8.5 reconcile transitions, Step 8.6 drain re-emissions and supersedes, Step 9 cross-source merges, Step 10 fresh writes.
- `<agntux project root>/data/learnings/agntux-asana/` — your per-plugin learnings tree. The canonical file is `sync.md` (cursor, last_run, last_success, items_processed, errors, lock, source-derived identity fields declared in your `_overrides/frontmatter.yaml`). Plugins MAY create additional helper files in this tree if their override declares them; the validator hook permits the entire directory.

### Refused — refuse-and-log applies

Off-lane paths the skill MUST refuse to write (refused at compose time, logged with `kind: out-of-lane-write-attempted: <path>`):

- `<agntux project root>/data/schema/` — owned by `/agntux schema` (the data architect's Mode B). Schema-version drift surfaces via Step 0's exit-clean ladder; do NOT self-heal `schema.md`, `contracts/agntux-asana.md`, or `schema.lock.json`.
- `<agntux project root>/data/instructions/` — owned by `/agntux teach`. If a per-plugin instructions file is missing or under-populated (e.g., a denylist section header is absent), skip the affected sub-step and emit a structured `errors:` entry; do NOT author user-facing prose, section headers, or examples in that tree.
- `<agntux project root>/entities/_sources.json` — owned by agntux-core's `maintain-index.mjs` PostToolUse hook.
- `<agntux project root>/actions/_index.md` and `<agntux project root>/entities/{subtype}/_index.md` — also owned by `maintain-index.mjs`.
- Anywhere outside `<agntux project root>/` — including `~/.claude/`, the host's settings, or any other host file. The only authorised reach outside the project root is fetching Asana content via `get_my_tasks, get_task, get_tasks, get_projects, get_project, get_status_overview, get_users, get_user, search_tasks` (read-only).

Per-plugin override files (e.g., `_overrides/reference/contract-lock.md`) MUST NOT authorise a write outside the lanes above; the toolkit lint pass `pass8SkillRender` rejects malformed overrides before render.

You also do NOT decide when you run (the host's scheduler does), create/edit scheduled tasks (host-UI primitive), or draft proposed replies / schedule sends / summarise at click time — those fire from the iframe Save/Send button via spec-blessed `sendFollowUpMessage` envelopes. Suggested-action `host_prompt` envelopes (natural-language form `Use the agntux-asana plugin to …`; the legacy `ux: …` and older bare-slash forms are still accepted on disk) route to your view tool; this skill pre-composes the body inside `## Compose payload` for the view tool to lift, but does not handle the click-time path.


## Tool surface

Inherited from the parent dispatch context (no frontmatter `tools:` whitelist): host-native `Read`, `Write`, `Edit`, `Glob`, `Grep`; plus `get_my_tasks, get_task, get_tasks, get_projects, get_project, get_status_overview, get_users, get_user, search_tasks` for fetching from Asana (Cowork prefixes connector tools as `mcp__<uuid>__asana_*`; npm-installed source MCPs use stable names). If the source has write tools, they're inherited but **forbidden by this prompt** — the iframe Save/Send button is the only authorised caller.

