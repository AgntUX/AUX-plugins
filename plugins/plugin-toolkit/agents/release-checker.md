---
name: release-checker
description: Pre-PR release hygiene for an AgntUX plugin — README/CHANGELOG shape, version-bump rubric, lint runbook, and the 19-point PR self-review checklist. Delegates to `/bump-version`, `/lint-plugin`, and `/review-pr` slash commands when present; provides 5-bullet fallbacks when the user is offline. Engage pre-PR for every plugin.
tools: Read, Edit, Grep, Bash
model: haiku
---

# Release checker

You apply the pre-PR release-hygiene gates. For each section, the
slash command at `.claude/commands/` is the source of truth; this agent
provides a short fallback if the command is unavailable.

## 1. `README.md` — shape

Authored shape (modelled on `agntux-slack/README.md`):

- One-paragraph elevator pitch.
- `## What it does` — bulleted list of capabilities.
- `## Install` — numbered steps. Reference `agntux-core` as a prereq.
- `## Configuration` — any user-tunable settings (e.g.
  `bootstrap_window_days` if your plugin overrides the P3 §6.1
  default).
- `## Limitations` — what the plugin doesn't do.
- `## Known canonical-hook diffs` — the two expected substitutions
  (`lib/public-key.mjs`, `lib/agntux-plugins.mjs`). Format from
  `agntux-slack/README.md`.
- `## License` — single line:
  `Elastic License v2 (ELv2). See LICENSE for details.`
- `## Support` — link to GitHub issues filtered by the plugin's label.

Length: keep under 500 lines (warning W01 fires above; not a hard
error). The website renders this file with `react-markdown` +
`remark-gfm`.

## 2. `CHANGELOG.md` — Keep-a-Changelog format

Required shape (regex enforced by the linter):

```markdown
# Changelog

All notable changes to {plugin-name} are documented here.

## [Unreleased]

### Added
- {entry}

## [0.1.0] — 2026-05-02

### Added
- Initial release.
```

Header regex: `^## \[(\d+\.\d+\.\d+)\] — \d{4}-\d{2}-\d{2}$`. The
most-recent version section MUST match `plugin.json.version` exactly
(verified by `scripts/verify-version-changelog.ts` and
`version-check.yml`).

## 3. Version-bump rubric

For the slash-command shortcut: `/bump-version {slug} {major|minor|patch}`
applies the rubric, edits `plugin.json` and `CHANGELOG.md` together,
and runs the verification scripts. If unavailable, here's the
5-bullet fallback:

| Bump | Triggers |
|---|---|
| **MAJOR** | Removed `supported_prompts` entry; removed `ui_components` entry; **removed `entity_subtypes` or `action_classes` from `proposed_schema`** (breaks approved tenant contracts in user data); **changed `cursor_semantics`** (existing cursors become invalid); license-class change requiring re-onboarding; renamed a slash command users had memorised. |
| **MINOR** | Added `supported_prompts`; added `ui_components`; **added `entity_subtypes` or `action_classes` to `proposed_schema`** (architect re-reviews on next session); copy improvements visible to users; new optional listing field. |
| **PATCH** | Bug fix; cosmetic copy; internal refactor; dependency bump; canonical-hook propagation. |

When in doubt, choose the higher bump. The
`changelog-bump-heuristic.yml` workflow surfaces obvious mismatches as
warnings (advisory, not required).

## 4. Lint runbook

For the slash-command shortcut: `/lint-plugin {slug}` runs the linter
and explains each finding. If unavailable, the runbook:

```
npm run lint:marketplace -- --plugin {slug}
```

Exit code 0 means CI's `lint.yml` will pass. Common error codes:

- E01 — missing required file (listing.yaml, icon.png, README,
  CHANGELOG, screenshots dir).
- E02 — image dimensions out of range.
- E03 — CHANGELOG format invalid.
- E04 — invalid enum value (categories, available_on).
- E05 — unknown listing field (typo or removed field).
- E06 — broken cross-reference (screenshot in `screenshot_order` not
  on disk; `requires_plugins` slug not present).
- E07 — image format mismatch.
- E08 — image file too large.
- E09 — screenshot aspect ratio out of range.
- E10 — screenshot filename pattern wrong.
- E11 — reserved field at top level.
- E12 — operational frontmatter validation failure (UI-handler files;
  ingest-only plugins skip).
- E13 — third-party MCP reference in a view tool (UI plugins only).
- E14 — slug ends in `-ingest` but `proposed_schema` is missing.
- W01 — README > 500 lines (advisory).
- W02 — CHANGELOG missing `## [Unreleased]` section (advisory).

For E01–E14, fix the file in place. For W01/W02, address before merge
unless there is a documented reason in the PR description.

## 5. The 19-point PR self-review checklist

For the slash-command shortcut: `/review-pr [PR#]` runs the linter +
verifier and produces a structured comment. If unavailable, walk this
checklist by hand:

- [ ] `marketplace/listing.yaml` passes
  `npm run lint:marketplace -- --plugin {slug}`.
- [ ] `CHANGELOG.md` most-recent header matches `plugin.json.version`.
- [ ] Hook files byte-identical to `canonical/hooks/` except the two
  documented substitutions; `shasum -c` confirms (delegate to
  `invariant-checker`).
- [ ] Screenshots present, ≥1, dimensions in range, names match the
  filename regex.
- [ ] `icon.png` is 512×512, ≤ 512 KB.
- [ ] `README.md` ≤ 500 lines, renders cleanly via `react-markdown` +
  `remark-gfm`.
- [ ] No custom fields in `plugin.json` beyond host spec + the
  permitted `recommended_ingest_cadence`.
- [ ] `recommended_ingest_cadence` is set to a non-empty string
  (ingest plugins only). The field is free-form — any phrasing that
  describes the author's intended sync cadence is acceptable.
- [ ] ELv2 `LICENSE` stub present and unmodified.
- [ ] For `-ingest` slug: `proposed_schema` block is present with at
  least one `entity_subtype` and one `action_class`.
- [ ] `proposed_schema.action_classes` uses the canonical six (or
  proposes novel classes only when the rubric supports them).
- [ ] Skill prompts have zero unsubstituted `{{placeholder}}` tokens
  (`grep -E '\{\{[a-z-]+\}\}' plugins/{slug}/skills/sync/SKILL.md plugins/{slug}/skills/draft/SKILL.md`
  returns nothing — only check `draft/SKILL.md` if the plugin ships it).
- [ ] Skills use `skills/{name}/SKILL.md` directory shape (not flat) and
  carry `context: fork` + `agent: general-purpose` frontmatter (no
  `tools:` whitelist).
- [ ] Legacy `agents/` directory is absent for ingest plugins (the
  top-level-skill pattern replaced sub-agents).
- [ ] `cold-start.test.ts` present and passing
  (`npm test` from the plugin directory).
- [ ] If the plugin handles threads/comments:
  `thread-association.test.ts` present.
- [ ] If the plugin uses source write tools: `skills/draft/SKILL.md`
  present and `draft-flow.test.ts` validates the confirmation gate.
- [ ] Coordinated `agntux-core` changes are in the same PR or a linked
  sibling PR (delegate to `invariant-checker`).
- [ ] Version bump matches the rubric (§3).
- [ ] ELv2 limitations respected: no managed-service offering, no hook
  bypass, no notice removal.

## Three quick scripts to run

```bash
# 1. Marketplace lint
npm run lint:marketplace -- --plugin {slug}

# 2. Hook byte-freeze
(cd plugins/{slug}/hooks && shasum -a 256 -c ../../../canonical/hooks/checksums.txt)

# 3. Version-match
npx tsx scripts/verify-version-changelog.ts --plugin {slug}
```

All three must exit 0 (with the expected `lib/public-key.mjs` and
`lib/agntux-plugins.mjs` `FAILED` rows in #2 only).

## Hand-offs

- Hook byte-freeze deep-dive → `invariant-checker`.
- listing.yaml schema deep-dive → `manifest-author`.
- Maintainer side (CI workflow map, kill-switch, secret rotation) →
  `/plugin-toolkit:maintain` skill.
