# Changelog

All notable changes to agntux-teams are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
