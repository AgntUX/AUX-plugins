---
name: marketplace-maintainer
description: Maintainer runbooks for the AgntUX plugin marketplace — PR review checklist, rollback runbook, kill-switch, canonical-hook updates, secret rotation, CI workflow map. Use when reviewing marketplace PRs or operating the repo at the root level.
triggers:
  - file:.github/**
  - file:CHANGELOG.md
  - file:README.md
  - issue:label:regression
  - issue:label:kill-switch
  - issue:label:canonical-hook-rollout
---

# Marketplace Maintainer Skill

You are operating `AgntUX/AUX-plugins` as a maintainer. This skill inlines the runbooks that are otherwise spread across P7 (`please-study-these-plans-fuzzy-valley.md`) and P15 (`p15-marketplace-metadata.md`) so you don't have to context-switch into plan documents during an incident.

## PR review checklist (P7 §7.3)

Three load-bearing checks every reviewer applies, in addition to the diff itself:

1. **Bump rule fit (§5.1)**: Does the version bump match the rubric? (`MAJOR` for removed surface, `MINOR` for additive surface, `PATCH` for bug fix or cosmetic.) If the `changelog-bump-heuristic.yml` warning fired, is it addressed in the PR description?
2. **Surface stability**: If `supported_prompts` or `ui_components` (in `listing.yaml`) changed, does the change maintain backward-compat for users on the previous version? If not, is the bump MAJOR?
3. **Canonical-hook untouched**: Did the PR somehow drift `plugins/{slug}/hooks/` from `canonical/hooks/`? `hook-hash-check.yml` catches this; reject if it surfaces.

External-contributor PRs (post-P14): also confirm the contributor has a current CLA on file.

The wrapper command `/review-pr [PR#]` automates the linter + verifier runs and produces a structured comment the reviewer pastes.

## Runbooks

### Rollback (§11.1)

1. Identify the bad merge commit via `git log --oneline plugins/<slug>/ -10`.
2. `git revert <sha>` on a `revert/<slug>-<reason>` branch.
3. Run `npm run lint:marketplace -- --plugin <slug>`, `verify-version-changelog.ts`, `verify-canonical-hooks.ts`. All must exit 0.
4. Open the revert PR; merge after CI green and one CODEOWNERS approval.
5. Post-merge: `regenerate-indexes.yml` re-emits indexes; tag the revert per P7 §5.4.

The `/rollback <slug>` command walks through this step-by-step.

### Kill-switch

For an emergency removal of a plugin (security incident, license breach, malicious payload):

1. Open a PR titled `kill-switch(<slug>): remove from marketplace`.
2. Delete `plugins/<slug>/` entirely.
3. Run regenerators; confirm `.claude-plugin/marketplace.json` and `marketplace/index.json` no longer list the slug.
4. Merge with `@agntux/security` approval (no normal CODEOWNERS routing — security override).
5. Tag `kill-switch-<slug>-<date>` and announce in the maintainer Slack.
6. Users on the affected plugin keep their installed version until SessionStart re-fetches; consider whether a backend kill-list (P2 §11) is also warranted.

### Canonical-hook update (§11.3)

Every plugin's `hooks/` is byte-pinned to `canonical/hooks/`. To update:

1. Update `canonical/hooks/` (security team owns the signed prose).
2. Recompute `canonical/hooks/checksums.txt`.
3. For every plugin under `plugins/*/`, copy `canonical/hooks/` over `plugins/<slug>/hooks/` and bump `plugin.json.version` (PATCH minimum).
4. Append a CHANGELOG entry per plugin citing the canonical-hook update.
5. Open one consolidated PR; both `@agntux/security` and `@agntux/marketplace-maintainers` must approve.
6. After merge, open one tracking issue per plugin under the `canonical-hook-rollout` label.

The `/update-canonical-hooks` command walks through this.

### Secret rotation

KMS keys live in AWS, not this repo. The public PEMs in `canonical/kms-public-keys.json` rotate via:

1. Rotate the KMS key per `~/.claude/plans/p2-keys.md`.
2. Update `canonical/kms-public-keys.json` to include the new `kid`.
3. Bump every plugin's version (PATCH) and re-publish.
4. The plugin-side hook (`license-validate.mjs`) accepts both `kid`s for the overlap window per P2 §3.1.

Never commit private key bytes. Never hand-edit a public-key entry's `kms_key_id` field — fetch fresh from AWS.

## CI workflow map (P7 §6)

- `lint.yml` — runs `npm run lint:marketplace -- --plugin <slug>` on every PR that touches `plugins/`. Required for merge.
- `hook-hash-check.yml` — verifies every `plugins/*/hooks/` file matches `canonical/hooks/checksums.txt`. Required for merge.
- `version-check.yml` — confirms `plugin.json.version` ↔ `CHANGELOG.md` most-recent header. Required for merge.
- `changelog-bump-heuristic.yml` — surfaces bump-kind mismatches as warnings. NOT required (advisory).
- `regenerate-indexes.yml` — fires post-merge to `main`; regenerates `.claude-plugin/marketplace.json` and `marketplace/index.json`; pushes back with `[skip ci]`.
- `ci.yml` — umbrella that wraps the above; this is the single check listed in branch protection.

## Pointers

- `/add-plugin <slug>` — manual scaffolding (rare; most plugins arrive via P6 generator).
- `/lint-plugin <slug>` — run linter and explain results.
- `/bump-version <slug> <kind>` — apply the rubric.
- `/rollback <slug>` — runbook walkthrough.
- `/update-canonical-hooks` — runbook walkthrough.
- `/review-pr [PR#]` — composed review comment.

These conveniences are optional. Maintainers can perform every operation by hand.
