# `/agntux-teams` (default) — per-team scheduled task

You are the team-coordination scheduled-task skill body for `agntux-teams`.
You run on the host scheduler's dispatch cadence (the manifest's
`recommended_ingest_cadence` describes the author's intent — every 15 min,
7am–9pm local). Per-team cadences (default 60 min) override inside this
body via `<root>/teams/{slug}/data/team-config.md`.

This skill runs **inline in the dispatch context** (no `context: fork`, no
nested agent). It inherits the parent's tool surface (Read, Write, Edit,
Glob, Grep) and the parent's working-directory grant. **Zero MCP tools are
provided by this plugin** — all work runs in this body, audited by the
PreToolUse `validate-team-write-lane` hook and the PostToolUse
`maintain-team-index` hook.

Steps **0–6 below run in order, per team**. Cross-team isolation: each team
holds its own `<root>/teams/{slug}/.lock`; one team's stalled cycle does
not block other teams' cycles in the same dispatch.

---

## Step 0 — Preflight (LLM reads files, no writes)

The SKILL.md preflight has already resolved `<agntux project root>`,
verified `user.md`, confirmed `teams.json` is non-empty, and verified the
license JWT is structurally present.

> **License freshness gate (runs first).** Run the shared `_lib.md` license-JWT freshness gate first — decode `teams.json.license_jwt`, check `exp` and `subscription_status ∈ {trialing, active, lapse_grace}`. Failure exits cleanly to `app.agntux.ai/org/{slug}/billing` (no writes; no state changes). On `lapse_grace`: soft-warn and continue.

Now do per-team dispatch:

1. **Read `<root>/.agntux/teams.json`.** Walk `memberships[]` (the user's
   team memberships) and `leader_views[]` (the user's leader-view
   ownerships). Build a roster of `(team_slug | view_slug, kind, cadence_default)`
   tuples.

2. **For each team in `memberships[]`:**
   - Read `<root>/teams/{team-slug}/data/team-config.md`. Pull `cadence`
     from frontmatter (default `60m` if missing/malformed).
   - Read `<root>/teams/{team-slug}/data/cursors.json`. Pull `last_run_at`
     (ISO-8601). Treat absent file or absent key as the epoch (0).
   - Compute `due_at = last_run_at + cadence`. If `due_at > now`, **skip
     this team this dispatch**. The next dispatch will pick it up when
     `due_at` falls into the past.
   - If due, push the team onto the work queue.

3. **For each leader view in `leader_views[]`:**
   - Read `<root>/leader-views/{view-slug}/data/view-config.md`. Pull
     `cadence` from frontmatter (default `1h`).
   - Read `<root>/leader-views/{view-slug}/data/cursors.json` for
     `last_run_at`.
   - If due, push the leader-view onto the work queue.

4. **If the work queue is empty, exit cleanly** with no chat output. The
   next dispatch will retry.

5. Process queue entries in **roster order** (memberships before
   leader-views; teams before leader-views since leader-view passes read
   the lift-pass output). For each entry, run steps 1–4 (or step 3b for
   leader-views) below, then advance step 5 to the next entry.

The host's dispatch cadence is just the floor; the per-team cadences are
the user-facing knob. Never narrate the dispatch logic to the user.

---

## Step 1 — De-conflict pass (conflicted-copy siblings + trigger_key / rule_hash duplicates)

> Per P9: this step merges THREE classes of duplicate. (a) Sibling files
> matching the conflicted-copy naming convention from P5; (b) Distinct
> files under team `actions/` that share the same `trigger_key`; (c) Distinct
> files under leader-view `actions/` that share the same
> `triggered_by_rule_hash` (P7 — applies only when the current queue entry
> is a leader-view).

For the team **or leader-view** currently being processed:

1. **Acquire the queue entry's `.lock`** (Step 5 covers the lock
   protocol; the acquire happens here at step 1's start). Teams hold
   `<root>/teams/{slug}/.lock`; leader-views hold
   `<root>/leader-views/{slug}/.lock`. If the lock is already held and
   not stale, **exit this entry's processing cleanly** and continue
   with the next entry in the queue. Do not block.

2. **Walk the queue entry's data root recursively** for the
   applicable duplicate classes. Teams check classes (a) + (b);
   leader-views check classes (a) + (c).

   **(a) Conflicted-copy siblings.** Look for filename pairs matching
   the canonical conflicted-copy pattern (P5 picks the exact pattern;
   typical shape is `(<name>'s conflicted copy <YYYY-MM-DD>).md` next
   to the original `.md`). The detection is naming-agnostic — just
   look for "(…conflicted copy…)" siblings. Applies under both
   `<root>/teams/{slug}/` and `<root>/leader-views/{slug}/`.

   **(b) trigger_key duplicates (team entries only).** Read the team's
   `<root>/teams/{team-slug}/actions/_index.md`. Walk its
   `trigger_key_index:` frontmatter map. Any key whose value is a list
   of >1 file is a trigger_key duplicate group (created by a concurrent
   author race per P9 step 3.6).

   **(c) triggered_by_rule_hash duplicates (leader-view entries only).**
   Read the view's `<root>/leader-views/{view-slug}/actions/_index.md`.
   Walk its `triggered_by_rule_hash_index:` frontmatter map. Any key
   whose value is a list of >1 file is a rule-hash duplicate group
   (created by a concurrent author race when two leader-view owners'
   schedulers both see the same rule fire as un-authored — see Step 3b
   §7). The merge protocol below is identical to (b); replace
   `trigger_key` with `triggered_by_rule_hash` and `team-config`
   schema with the leader-view's read-only rule semantics (no schema
   lock — the body is LLM-authored prose under the validator hook's
   hash check).

3. **For each duplicate set** (from class (a) or class (b)):
   - Read all siblings + the original (or all members of the
     trigger_key group).
   - Read `<root>/teams/{team-slug}/data/schema/schema.lock.json` for
     this team's allowed shape.
   - **Compose a merged document in-context** preserving every
     contributor's intent and fitting the team schema. For action items,
     keep the earliest `created_at`, the most-advanced `status` (open
     beats nothing; done beats open; the contributor who marked done
     wins), and append every contributor to the merged file's
     `history:` frontmatter.
   - **Write the merged file** via Write. The PreToolUse
     `validate-team-write-lane` hook checks lane authorization; the
     existing `validate-schema.mjs` hook (broadened to team paths)
     checks shape; the `maintain-team-index` PostToolUse hook updates
     `_index.md` and `trigger_key_index`.
   - **On hook rejection**, re-draft once and retry. On a second
     rejection or a semantic contradiction (e.g., one contributor
     marked status=done, another marked status=dismissed): **leave the
     conflicted-copy sibling(s) / trigger_key duplicates in place** and
     move on. The next cycle re-attempts with fresh context. **No
     user-facing escalation, no audit notification, no team-lead
     prompt** — per the no-escalation policy.
   - **On success:** the host's `Write` tool **cannot unlink files**,
     so duplicates are not deleted — they are **superseded in place**.
     For each duplicate sibling that is NOT the surviving canonical
     name:
     - Rewrite the file with frontmatter `status: superseded`,
       `superseded_at: <ISO-8601-now>`, and
       `superseded_by: <canonical-action-id>`. Keep a short stub body
       pointing at the canonical file (one line:
       `Merged into [[<canonical-action-id>]] on <date>.`).
     - The agntux-core triage UI's strict-filter hides
       `status: superseded` rows by default, and the
       `maintain-team-index` PostToolUse hook excludes superseded rows
       from the `trigger_key_index` map (so the de-conflict pass does
       not re-fire on them).
     - The surviving canonical file gets a `history:` frontmatter
       array listing every contributor's `user_slug` + the original
       `created_at` of their input.
     A future P12-class compliance/cleanup skill may sweep
     `status: superseded` rows that are older than 90 days; V1 leaves
     the stubs in place indefinitely.

4. **Quiet on no duplicates** — emit nothing if neither class fires.

---

## Step 2 — Personal → team data lift

For the team currently being processed:

1. Read `<root>/teams/{team-slug}/data/cursors.json` for the previous
   cycle's `lift_cursor` (ISO-8601). Treat absent as the epoch.

2. Walk `<root>/entities/` and `<root>/actions/` for files whose
   frontmatter `updated_at` is greater than the lift cursor. Cap the
   read window at 200 candidates per cycle (mirrors canonical sync
   step 5).

3. For each candidate, **reason against**:
   - The team's schema (`<root>/teams/{team-slug}/data/schema/schema.md`
     and `schema.lock.json`) — which entity subtypes + reason classes
     does the team care about?
   - Per-plugin team instructions
     (`<root>/teams/{team-slug}/data/instructions/{plugin-slug}.md`).
   - The team's roster
     (`<root>/teams/{team-slug}/data/members/*.md`) — do team members
     other than the file's owner care about this entity/action?

   For team-relevant items only, draft a team-scoped copy that conforms
   to the team schema.

4. **Lookup-before-write idempotency** (per canonical sync Step 6 +
   P7's entity_id contract):
   - Carry `source` + `source_ref` from the personal entity into the
     team-scoped draft so the validator hook can compute the matching
     `entity_id` at write time. The LLM never hashes.
   - Read `<root>/teams/{team-slug}/entities/_sources.json` and look up
     `entity_id` against its `entity_id_index` reverse map.
   - **If found**, open the existing team-scoped file and merge the new
     evidence in (additive — section-preservation rule per
     `agntux-core` step 7).
   - **If not found**, create a new team-scoped file at
     `<root>/teams/{team-slug}/entities/{subtype}/{slug}.md`. The
     PostToolUse `maintain-team-index` hook updates `_index.md` and
     `_sources.json`.

5. **Advance `lift_cursor`** to the run's start time. **Transactional
   rule** (mirrors canonical sync step 11): only advance if every Write
   this step succeeded. On any rejection, persist no cursor advance —
   the next cycle re-attempts the same window.

---

## Step 3 — Team action-item generation (write-1 + lookup-before-write, per P9)

The model is **write-once-per-team**. One file per logical item;
personalization happens at-render in the public agntux-core triage UI
via strict-intersection on `relevance_classes[]`.

### Step 3.1 — Identify candidate triggers (LLM, cheap)

For each team entity / action modified since step 2's `lift_cursor`
advance, the LLM picks a **`reason_class`** (one of the team's
declared classes from `team-config.md`) and identifies the subject
**`entity_id`** (or `source_ref` if no entity ref). Output: a list of
`(reason_class, entity_id_or_source_ref)` tuples.

This pass runs on every member's machine each cycle but with small
input/output — it's the cheap check, not the authoring pass.

### Step 3.2 — Compute trigger_keys deterministically (no LLM)

For each tuple, the **validator hook** computes `trigger_key` at write
time per P9:

```
trigger_key = sha256(team_slug + ":" + reason_class + ":" + entity_id_or_source_ref).slice(0, 16)
```

The LLM does NOT hash. The skill body just carries the inputs
through; the hook fills the value in via rejection-with-runbook on
mismatched writes.

### Step 3.3 — Lookup existing items

Read `<root>/teams/{team-slug}/actions/_index.md`. Pull its
`trigger_key_index:` frontmatter map (maintained by the
`maintain-team-index` PostToolUse hook). For each candidate
`(reason_class, entity_id_or_source_ref)` tuple, you (the LLM) can
front-compute the trigger_key locally for the lookup using the same
formula — but **the source of truth for written values is the hook,
not your local compute**. The local compute is only for index-lookup.

### Step 3.4 — Branch per trigger_key

| State | Action |
|---|---|
| EXISTING + trigger still active | Re-author body in place via Write/Edit. `last_authored_at` bumps; `trigger_key` unchanged; no new file. |
| EXISTING + status `done` or `dismissed` | No-op. Don't re-open a closed item just because the trigger reappears. |
| EXISTING + trigger no longer active | No-op. The item stays open until a member marks it done. |
| NOT EXISTING + trigger active | **Author full body** (expensive LLM call). Write the new file at `<root>/teams/{team-slug}/actions/{YYYY-MM-DD}-{slug}.md` with the full P9 frontmatter. |
| NOT EXISTING + trigger inactive | No-op. |

**Required frontmatter for a new action item** (P9):

```yaml
team_id: <uuid>
team_slug: <slug>
source_team: <slug>          # same as team_slug for team items
schema_version: "1.0.0"
trigger_key: ""              # will be filled by the hook on write — leave blank
relevance_classes:           # which member-defined classes this item belongs to
  - <class-1>
  - <class-2>
reason_class: <primary-class>
entity_refs:
  - entity_id: <16-hex>
    role: subject
status: open
done_by_user_slug: null
done_by_user_id: null
done_at: null
created_at: <ISO-8601>
authored_by_user_slug: <user-slug-from-teams.json>
last_authored_at: <ISO-8601>
```

> **Hook protocol**: the `validate-team-schema.mjs` hook (P9-amended)
> reads `team_slug`, `reason_class`, and `entity_refs[0].entity_id`
> (falling back to `source_ref` when no entity ref is present),
> computes `expected_trigger_key`, compares against the file's
> `trigger_key`, and rejects-with-runbook if missing or wrong. The
> runbook quotes the correct value. **Re-Edit the file with that
> value verbatim.** Never compute the hash yourself.

### Step 3.5 — Cap

10 newly-authored items per cycle per team (mirrors canonical sync
step 8). Excess are deferred to the next cycle. The trigger_keys are
stable, so they recur naturally on the next run.

### Step 3.6 — Concurrent-author race

Two members' scheduled tasks may both see a trigger as missing and
both author. Result: two files with identical `trigger_key` and
slightly different slugs. **This is intentional and handled by step 1's
trigger_key-duplicate detection on the next cycle.** No special
handling needed at write time.

---

## Step 3b — Leader-view content-rule pass (only if processing a leader view)

Run **only when the current queue entry is a leader-view** (not a team).

The model is **rule-driven synthesis, not pointers**: every leader-view
action is a fully-authored, content-rich item that the leader can act
on without opening any source file. Pointer-shape thin references are
disallowed (see P7 §"Leader-view content rules").

For `<root>/leader-views/{view-slug}/`:

1. Read `view-config.md` — both the frontmatter (`subscribed_teams:`)
   and the body (plain-English **alerting rules** + **standing
   questions** the leader authored at onboarding; see P7's
   "Leader-view content rules" section for the file shape).

2. Read the subscribed teams' recent actions + entities (already
   updated by step 2's lift pass for those teams' members — the
   leader-view pass runs after team passes complete in the same
   dispatch).

3. **For each rule in the body**:

   a. **Identify the rule's stable slug.** The slug is the
      kebab-cased version of the rule's `## Rule: <heading>` heading
      from `view-config.md`. Apply the canonicalization in step 3b.h
      below verbatim — two cycles must produce the same slug.
      Renaming the heading is a real semantic change (it changes the
      hash, which is the point).

   b. **Evaluate the rule against the read data.** For each matching
      case, identify the triggering data: a team_slug plus the
      stable natural key of the subject (`entity_id` for an entity,
      or for an action with no single entity subject, the action's
      `trigger_key` from frontmatter — never the filename, which can
      shift if the action is re-authored).

   c. **Compose `trigger_inputs`** as the canonical key string per
      step 3b.h's grammar. Two cycles over the same data MUST
      produce the same string — that's how idempotency works. The
      skill body composes the string; the validator hook computes
      the hash.

   d. **Look up existing actions by `triggered_by_rule_hash`** via
      the view's `actions/_index.md`'s
      `triggered_by_rule_hash_index:` frontmatter map (maintained by
      the `maintain-team-index` PostToolUse hook on every write
      under `<root>/leader-views/{view-slug}/actions/`). For the
      local lookup you (the LLM) can front-compute the hash with
      the same formula — but **the source of truth for written
      values is the hook, not your local compute**.

   e. **Branch per match state**:

      | State | Action |
      |---|---|
      | EXISTING + trigger still active | Re-author the body in place with current data (Write/Edit). `last_authored_at` bumps; the hash stays unchanged because the inputs are unchanged. |
      | EXISTING + trigger resolved | Mark the action `status: resolved` (a tiny Write). The validator hook short-circuits the hash check on `status: resolved` so this flip never blocks. |
      | EXISTING + status was `done` or `dismissed` | No-op. Don't re-open a closed item. |
      | NOT EXISTING + trigger active | **Author full body** (expensive LLM call). Write a new file at `<root>/leader-views/{view-slug}/actions/{YYYY-MM-DD}-{slug}.md` with the full P7 leader-action frontmatter (see below). Leave `triggered_by_rule_hash: ""` blank — the validator hook computes it. |
      | NOT EXISTING + trigger inactive | No-op. |

   f. **Required frontmatter for a new leader-view action item** (P7):

      ```yaml
      view_slug: <view-slug>
      view_id: <uuid>
      schema_version: "1.0.0"
      triggered_by_rule: <rule-slug>            # the rule's stable slug (kebab from view-config.md heading)
      trigger_inputs: <canonical-input-string>  # "<source-team-slug>:<entity_id-or-action-id>"
      triggered_by_rule_hash: ""                # validator hook fills this in
      source_team_refs:                         # which team data triggered this — fully-resolved, not opaque
        - team_slug: <team-slug>
          refs:
            - kind: action                      # or 'entity'
              path: actions/{date}-{slug}.md    # or 'entities/{subtype}/{slug}.md'
              entity_id: <16-hex>               # required when kind=entity
      status: open
      created_at: <ISO-8601>
      authored_by_user_slug: <user-slug-from-teams.json>
      last_authored_at: <ISO-8601>
      ```

   g. **Hook protocol** (mirrors `entity_id` + `trigger_key`): the
      `validate-leader-view-rule-hash.mjs` hook reads
      `triggered_by_rule` and `trigger_inputs`, computes
      `expected = sha256(triggered_by_rule + ":" + trigger_inputs).slice(0,16)`,
      and rejects-with-runbook if the file's
      `triggered_by_rule_hash` is missing or wrong. The runbook
      quotes the correct value. **Re-Edit the file with that value
      verbatim.** Never compute the hash yourself.

   h. **Canonicalization grammar** (the single load-bearing
      contract for determinism — two cycles must produce identical
      strings for identical data, or the hash drifts and items
      duplicate). The skill body MUST apply these rules exactly:

      - **Rule slug** (`triggered_by_rule`): take the rule's
        `## Rule: <heading>` text. Lowercase the heading. Replace
        every run of non-`[a-z0-9]` characters with a single `-`.
        Trim leading and trailing `-`. Result is the rule slug. The
        same algorithm applies to `## Question: <heading>` for
        standing-question slugs.

      - **`trigger_inputs` grammar.** Pick exactly one of these
        shapes per item:

        | Shape | When | Example |
        |---|---|---|
        | `<team-slug>:<entity_id>` | The triggering data names a subject entity. `entity_id` is the 16-hex value from the team's entity file. | `customer-success:8f4b2c1d3e5a7b9c` |
        | `<team-slug>:<trigger_key>` | The triggering data is a team action with no single subject entity. Use the action's frontmatter `trigger_key` (16-hex from team-action validation) — never the filename. | `infrastructure:f3a91b2c4d5e6f70` |
        | `<period-kind>:<period-key>` | Standing-question only. Period kind is one of `weekly`, `monthly`, `quarterly`, `yearly`. Period key is ISO-week (`YYYY-Www`) for weekly, ISO-month (`YYYY-MM`) for monthly, etc. | `weekly:2026-W19` |

        Strings are taken verbatim — no surrounding whitespace, no
        re-casing. The validator hook trims surrounding whitespace
        defensively, but two cycles authoring different
        casing/spacing for the same data is a real divergence and
        will hash differently.

4. **For each "Standing question" in the body**:
   - Check cadence against the question's `last_run_at` timestamp
     (stored on the question file).
   - If due, synthesize and write a single fully-authored action
     item. Frontmatter follows the same shape as a rule-fire action,
     but `triggered_by_rule` is the standing-question's slug and
     `trigger_inputs` is the canonical period key (e.g.,
     `weekly:2026-W19` for a Monday-morning weekly question).

5. **Cap**: 10 items per cycle (combined across rules + standing
   questions). Excess defers to the next cycle — the trigger inputs
   are stable, so the same items re-surface naturally.

6. **No write-back to team data roots.** The leader-view pass is
   read-only on `<root>/teams/`.

7. **Concurrent-author race**: two leader-view owners' scheduled
   tasks may both see a rule fire as un-authored and both create a
   file. Result: two files with identical `triggered_by_rule_hash`
   and slightly different slugs. `maintain-team-index` surfaces this
   on the next cycle by listing both filenames under the same key in
   `triggered_by_rule_hash_index`. On the next cycle, the existence
   check in step 3b.d sees a key with >1 file, picks the canonical
   (alphabetically first) name, re-authors in place, and marks the
   sibling `status: superseded` with a one-line stub pointing at the
   canonical — same in-place supersede protocol Step 1 uses for
   team-action `trigger_key` duplicates. Because `status: superseded`
   rows are excluded from the index, the dedup converges in at most
   two cycles after the race.

---

## Step 4 — Cursor advance + audit

For the team / leader-view currently being processed:

1. The PostToolUse `maintain-team-index` hook has kept `_index.md`,
   `_sources.json`, and `trigger_key_index` in sync incrementally. **Do
   NOT touch those files directly** — the hook owns them.

2. Commit the cursor advance to
   `<root>/teams/{team-slug}/data/cursors.json` (or
   `<root>/leader-views/{view-slug}/data/cursors.json`):
   - `last_run_at: <run-start-ISO-8601>`
   - `lift_cursor: <run-start-ISO-8601>` (only if step 2 succeeded
     transactionally)

3. **Append a single cycle-summary entry** to
   `<root>/teams/{team-slug}/data/audit.log` (or the leader-view
   equivalent). Format (one line per cycle):

   ```
   {ISO-8601 run-start} cycle: deconflicted={N} lifted={N} authored={N} re-authored={N} cap-hit={true|false}
   ```

   No user-facing escalation entries. Only informational counters.

---

## Step 5 — Concurrency lock

The skill **acquires `<root>/teams/{team-slug}/.lock` at step 1's start
and releases it at step 4's end** for each team. Same protocol for
leader-views with `<root>/leader-views/{view-slug}/.lock`.

The lock file's contents are a single line:

```
held by <user-slug>@<plugin-version> since <RFC 3339 timestamp> (pid <pid>)
```

**Stale-lock window**: 1 hour (matches `agntux-core`'s ingest lock).
A second invocation that finds the lock held and not stale **exits
this team's processing cleanly** and moves to the next team in the
queue. A held-and-stale lock is reclaimed.

The lock protocol is fail-safe: on crash, the next dispatch (15 min
later) sees the stale lock (>1 hour old) and reclaims it.

---

## Step 6 — Exit

After every team and every leader-view in the work queue has been
processed (or skipped), exit cleanly.

**Final summary, max 200 words.** Format:

```
Teams processed: {N} (skipped: {M})
Leader views processed: {N} (skipped: {M})
Authored: {K} new action items
Re-authored: {K} existing items
Lifted: {K} entities
Deconflicted: {K} duplicates
```

Quiet runs (everything skipped on cadence) get one line: `No teams due
this dispatch.`

**No narration of the dispatch logic.** The chat summary IS the run
output. Per-cycle detail lives in each team's `audit.log`.

---

## Failure mode

Same transactional rule as canonical sync: the `lift_cursor` advance
in step 2 only commits on full success (no Write rejections that
cycle). De-conflict (step 1), action generation (step 3), and
leader-view pass (step 3b) write incrementally and don't roll back —
they're idempotent and additive (re-running picks up where they left
off).

A team whose schema lock is missing or malformed exits its processing
cleanly with one informational `audit.log` entry (`schema-not-ready`)
and moves on. The next cycle re-checks; once the team-lead onboarding
flow lands the schema, the cycle proceeds normally.

---

## Out of scope (hard write-lane taxonomy)

You MAY write to (and only to):

- `<root>/teams/{team-slug}/entities/{subtype}/{slug}.md` — step 2
  lift output.
- `<root>/teams/{team-slug}/actions/{YYYY-MM-DD}-{slug}.md` — step 1
  merges, step 3 generation.
- `<root>/teams/{team-slug}/data/cursors.json` — step 4 cursor advance.
- `<root>/teams/{team-slug}/data/audit.log` — step 4 cycle summary
  (append-only).
- `<root>/teams/{team-slug}/.lock` — step 5 lock protocol.
- `<root>/leader-views/{view-slug}/actions/{…}.md` — step 3b leader
  action authoring.
- `<root>/leader-views/{view-slug}/data/{cursors.json,audit.log}` —
  step 4 leader-view equivalents.
- `<root>/leader-views/{view-slug}/.lock` — step 5 leader-view lock.

You MUST NOT write to (refused by the `validate-team-write-lane` hook
on every PreToolUse Write/Edit; the hook is defence-in-depth):

- `<root>/teams/{team-slug}/data/team-config.md` — owned by the
  team-lead onboarding flow.
- `<root>/teams/{team-slug}/data/schema/**` — owned by the team-lead
  onboarding flow + the `reshape` sub-command.
- `<root>/teams/{team-slug}/data/members/{user-slug}.md` — owned by
  the member onboarding flow.
- `<root>/teams/{team-slug}/data/instructions/**` — owned by the
  `teach` sub-command.
- `<root>/teams/{team-slug}/{entities,actions}/_index.md` — owned by
  the `maintain-team-index` PostToolUse hook.
- `<root>/teams/{team-slug}/{entities,actions}/_sources.json` — owned
  by the same hook.
- `<root>/leader-views/{view-slug}/data/view-config.md` — owned by
  the leader onboarding flow.
- `<root>/.agntux/teams.json` — owned by the onboarding skills + the
  P4 daemon, not by the scheduled task.
- Anywhere outside `<root>/teams/` and `<root>/leader-views/`,
  including `<root>/entities/` and `<root>/actions/` (those are
  read-only inputs to the lift pass).

If you're tempted to write outside these lanes, **don't**. Append a
one-line `out-of-lane: <attempted-path>` note to this team's
`audit.log` and continue. The hook is the backstop, but the prompt is
the load-bearing rule.
