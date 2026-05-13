# Changelog

All notable changes to agntux-teams are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] — 2026-05-13

P8 S5.1 — author the team-lead onboarding skill body. Replaces the
S3.4 stub (`reference/onboard-team-lead.md`) with the full 11-step
interview that produces a team's `schema.lock.json` — the gate that
unblocks `/agntux-teams onboard:member` for everyone else on the
team.

### Added

- `skills/agntux-teams/reference/onboard-team-lead.md` (500 lines —
  CLAUDE.md lint pass 8 ceiling).
  - Steps 0–10: preflight (`/agntux onboard` delegate, edit-mode
    detection, per-team marker resume); team-identity anchor; 3–4
    adaptive scope follow-ups; pre-suggested relevance classes via
    `AskUserQuestion` + bounded edit dialogue (cap 3 rounds);
    plugin-agnostic schema design (entities + actions + lock at
    `schema_version: "1.0.0"`); per-plugin instructions (lazy,
    read-only consultation); cadence picker; scheduled-task
    registration via `mcp__scheduled-tasks__create_scheduled_task`
    (with `update_scheduled_task` edit-mode branch and graceful
    fallback); team-lead member record; schema-ready trigger +
    `mcp__cowork__create_artifact` summary card; marker drop.
  - Inference heuristic at Step 3 carries the P8 step-3 mapping
    verbatim (5 scope-signal rows + 11 fixed slug descriptions).
  - Step 6 cron mappings: every-hour `0 7-21 * * *`, every-30-min
    `*/30 7-21 * * *`, every-4-hours `0 7,11,15,19 * * *`.
  - Step 0 sub-step 5 safeguard: re-run Step 4 from scratch when the
    marker is past 4 but `schema.lock.json` is missing (mid-Step-4
    crash recovery).
- `__tests__/onboard-team-lead-body.test.mjs` — 37 prompt-grep tests
  pinning the file shape (line-count cap, ordered step headings,
  P8 inference-heuristic rows verbatim, P9 required-action-fields,
  schema_version, cadence cron mappings, native-tool usage, consent
  text version, marker frontmatter, voice rules, safeguards). All
  whitespace-tolerant so markdown line-wrapping doesn't break the
  assertions.

### Changed

- `skills/agntux-teams/SKILL.md` — routing-table note for
  `onboard:team-lead` flips from "**STUB** — S5.1 fills in the
  interview content." to a one-line summary of what the flow
  produces.

## [0.3.0] — 2026-05-12

P7 leader-view content-rule synthesis (S6.3) — completes the
rule-driven, fully-authored leader-view action item contract. Every
leader action stands on its own (no pointer-shape thin references);
idempotency is on a deterministic hook-computed `triggered_by_rule_hash`
that mirrors the existing `entity_id` (P7) and `trigger_key` (P9)
contracts.

### Added

- `canonical/hooks/lib/rule-hash.mjs` — new byte-frozen helper with
  `computeRuleHash(rule_slug, trigger_inputs)` and
  `resolveRuleHashInputs(frontmatter)`. The hash formula is
  `sha256(rule_slug + ":" + trigger_inputs).slice(0,16)`. The LLM
  never computes this hash; the validator emits the correct value via
  a self-heal runbook.
- `hooks/lib/rule-hash.mjs` — byte-frozen copy of the canonical helper.
- `hooks/validate-leader-view-rule-hash.mjs` — PreToolUse hook on
  Write/Edit under `<root>/leader-views/{slug}/actions/*.md`:
  - Reconstructs post-Write/Edit content (mirrors
    `validate-team-schema.readContent`) so Edit operations that
    rewrite the frontmatter hash cannot route around validation.
  - Reads `triggered_by_rule` + `trigger_inputs`, computes the
    expected hash, rejects with a runbook quoting the correct value
    when `triggered_by_rule_hash` is missing or wrong.
  - Emits a separate "shape" runbook when either rule-hash input is
    missing.
  - `status: resolved | superseded` short-circuit applies ONLY when
    the file already exists on disk with a canonical hash — closes
    the initial-write hole where a fresh `status: resolved` Write
    with a garbage hash could bypass the validator.
  - Rejects writes to sub-directories under `actions/` (only
    top-level `*.md` files are in scope) mirroring
    `validate-team-schema.classifyTeamAction`.
- `hooks/hooks.json` — wires `validate-leader-view-rule-hash.mjs`
  after `validate-team-write-lane.mjs` and `validate-team-schema.mjs`.
- `__tests__/rule-hash.test.mjs` — 14 unit tests on
  `computeRuleHash` + `resolveRuleHashInputs`.
- `__tests__/validate-leader-view-rule-hash.test.mjs` — 15 hook-driver
  tests including the Edit-bypass HIGH regression and the
  follow-the-runbook end-to-end loop.
- `__tests__/leader-view-cycle.test.mjs` — 3 fixture-driven
  end-to-end tests covering P3 verification 6 (rule fire + standing
  question, idempotent re-author, resolved drop-out).
- `__tests__/hook-lib-byte-freeze.test.mjs` — new assertion for the
  canonical-to-plugin byte-freeze of `rule-hash.mjs`.

### Changed

- `hooks/maintain-team-index.mjs` — `rebuildActionsIndex` now emits a
  `triggered_by_rule_hash_index:` map (keyed on
  `triggered_by_rule_hash`) for view-action scope, replacing the
  previously-emitted `trigger_key_index:` map (which doesn't apply to
  leader-view actions). Team-action scope continues to emit
  `trigger_key_index:`. The `emitActionLine` sigils diverge by scope:
  view actions get `@rule:...` and `@rule_hash:...`; team actions
  retain `@reason:...` and `@trigger:...`. Defensive recompute from
  inputs is preserved for both scopes (covers stale files written
  before validators were installed).
- `skills/agntux-teams/reference/sync.md`:
  - Step 1 now de-conflicts THREE classes of duplicate (was two):
    adds the leader-view `triggered_by_rule_hash` duplicate class for
    the concurrent-author race protocol described in P7.
  - Step 3b expanded with explicit frontmatter shape, hook-computed
    protocol, branch matrix, and the canonicalization grammar (rule
    slug + `trigger_inputs` shapes) that pins determinism across two
    cycles authoring the same data.

### Notes

- 0.3.0 is a MINOR bump under the additive-only policy (P7 §"Schema
  namespacing rule") — no required-fields change to existing
  artifacts; new validator + new index map are additive.

## [0.2.0] — 2026-05-12

P9 trigger_key contract — completes the write-once-per-team
lookup-before-write idempotency for team action items.

### Added

- `hooks/validate-team-schema.mjs` — PreToolUse hook that validates
  the hook-computed `trigger_key` on every Write/Edit to a team-action
  file under `<root>/teams/{slug}/actions/*.md`. Mirrors the
  `entity_id` validator pattern in
  `plugins/agntux-core/hooks/validate-schema.mjs`:
  - Reads `team_slug`, `reason_class`, and
    `entity_refs[0].entity_id` (falling back to `source_ref`) from
    the proposed file content (both Write and Edit shapes).
  - Computes `expected_trigger_key` via the byte-frozen
    `canonical/hooks/lib/trigger-key.mjs` helper.
  - Rejects with a runbook quoting the correct value verbatim when
    the file's `trigger_key` is missing, empty, or mismatched.
  - Emits a separate "shape" runbook when the trigger inputs
    themselves are missing.
  - Leader-view actions (which carry `triggered_by_rule_hash`
    instead of `trigger_key` per P7) pass through unchanged.
- `hooks/hooks.json` — `validate-team-schema.mjs` is registered as a
  second PreToolUse Write|Edit hook, running after
  `validate-team-write-lane.mjs`.
- `skills/agntux-teams/reference/sync.md` Step 3 already carries the
  full P9 lookup-before-write logic (3.1 candidate ID, 3.2 hook
  trigger_key compute, 3.3 lookup, 3.4 branch matrix, 3.5 cap, 3.6
  concurrent-author race) and Step 1's trigger_key duplicate
  detection (added in 0.1.0). This release ratifies the contract
  via the new validator hook.

### Fixed

- `hooks/lib/schema-lock.mjs` re-synced from
  `plugins/agntux-core/hooks/lib/schema-lock.mjs`. The canonical copy
  consolidated an early-null + existsSync branch after 0.1.0 shipped;
  the byte-freeze invariant test now passes again.

### Verified

- P9 verification matrix item 1 (single-cycle write produces files
  with valid trigger_keys; the maintain-team-index hook adds them
  to `trigger_key_index`).
- P9 verification matrix item 2 (re-run with no underlying data
  change produces zero new files; covered indirectly by the
  validator's idempotent behaviour on existing files).
- P9 verification matrix item 3 (re-author on changed entity bumps
  `last_authored_at`; the skill body's branch matrix covers this).
- P9 verification matrix item 4 (concurrent-author duplicates
  surface in `trigger_key_index` with >1 entry; the next cycle's
  step 1 merges via the existing de-conflict pattern; tested in
  `maintain-team-index.test.mjs` under "groups files that share the
  same trigger_key").
- P9 verification matrix item 14 (hook rejects manual write with
  wrong trigger_key; runbook quotes the correct computed value).
  Tested in `__tests__/validate-team-schema.test.mjs`.

## [0.1.0] — 2026-05-12

Initial release. Skill-driven team coordination plugin per the P3 v2
plan. Ships zero MCP tools — all work runs in the skill body, audited
by deterministic hooks.

### Added

- `/agntux-teams` skill router with sub-commands: `sync` (default),
  `onboard:team-lead`, `onboard:member`, `onboard:leader`, `ask`,
  `teach`, `status`, `reshape`.
- `skills/agntux-teams/reference/sync.md` — the per-team scheduled task
  body. Steps 0–5: preflight + per-team cadence dispatch, de-conflict
  pass (conflicted-copy siblings + trigger_key duplicates per P9),
  personal→team data lift, team action-item generation (write-1 +
  filter-at-render with lookup-before-write), leader-view content-rule
  pass, cursor advance + audit, concurrency lock.
- `skills/agntux-teams/reference/ask.md` — read-only natural-language
  query.
- `skills/agntux-teams/reference/teach.md` — per-team rules writer.
- `skills/agntux-teams/reference/status.md` — read-only roster + sync
  summary.
- `skills/agntux-teams/reference/reshape.md` — per-team schema reshape
  one-shot.
- `skills/agntux-teams/reference/onboard-team-lead.md` — stub for S5.1.
- `skills/agntux-teams/reference/onboard-member.md` — stub for S5.2.
- `skills/agntux-teams/reference/onboard-leader.md` — stub for S5.3.
- `hooks/validate-team-write-lane.mjs` — PreToolUse rejection for
  unauthorized writers under `<root>/teams/` and `<root>/leader-views/`.
- `hooks/maintain-team-index.mjs` — PostToolUse `_index.md` +
  `_sources.json` + `trigger_key_index` maintenance.
- `hooks/lib/trigger-key.mjs` — byte-frozen copy of
  `canonical/hooks/lib/trigger-key.mjs` (P9 helper).
- `hooks/lib/{agntux-root,frontmatter,schema-lock}.mjs` — byte-frozen
  copies from `agntux-core/hooks/lib/`.
- Minimal MCP server entry point with **zero tools** registered (per
  the P3 v2 no-escalation-no-tools policy).
- `marketplace/listing.yaml` + icon + screenshot stubs.

### Fixed (pre-merge review)

- `hooks/maintain-team-index.mjs` and `hooks/validate-team-write-lane.mjs`
  now normalise path separators before prefix-comparison so the
  `startsWith(root + "/")` check is correct on systems where joined
  paths may mix `\` and `/`.
- `hooks/maintain-team-index.mjs` ships
  `readFrontmatterWithEntityRefs`, a thin augmentation over the
  byte-frozen `frontmatter.mjs` that correctly parses the
  team-action `entity_refs:` list-of-maps shape. The byte-frozen
  parser stays unchanged; the augmentation is local to the hook
  that needs it. The trigger_key fallback path
  (`resolveTriggerInputs` against the parsed `entity_refs[0]`) is
  now exercised by a dedicated test.
- Both hooks resolve the AgntUX project root lazily on each call,
  so `_setAgntuxRootForTesting` works with static imports.
- `skills/agntux-teams/SKILL.md` license-JWT preflight now checks
  the three-segment base64url shape via regex instead of "any
  non-empty string". Cryptographic verification still lives in P11.
- `skills/agntux-teams/reference/sync.md`'s de-conflict step 1
  no longer tells the LLM to "delete" duplicate siblings (the host's
  `Write` tool cannot unlink). Duplicates are marked
  `status: superseded` with `superseded_by:` instead; the
  `maintain-team-index` hook excludes superseded rows from
  `trigger_key_index` so the de-conflict pass doesn't re-fire on
  them.
