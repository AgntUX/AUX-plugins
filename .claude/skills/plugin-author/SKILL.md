---
name: plugin-author
description: Authoring guide for AgntUX plugins — listing.yaml schema, README/CHANGELOG conventions, version-bump rubric. Use when working inside plugins/{slug}/ or when authoring new plugin metadata.
triggers:
  - file:plugins/*/marketplace/listing.yaml
  - file:plugins/*/plugin.json
  - file:plugins/*/CHANGELOG.md
  - file:plugins/*/README.md
---

# Plugin Author Skill

You are working inside a single plugin under `plugins/{slug}/`. This skill exists to keep your authoring decisions consistent with P15 (marketplace metadata) and P7 (publish + versioning rubric). Treat this as a **teach-then-do reference**, not an automation — every mutating action still confirms with the user first.

## Listing schema (`marketplace/listing.yaml`)

Every plugin's `marketplace/listing.yaml` is validated by `lib/marketplace-schema.ts`. The schema is the single source of truth — do not duplicate or paraphrase fields. Required top-level fields:

- `slug` — plugin directory name; must match the directory containing this file.
- `name` — human-readable display name.
- `tagline` — one-sentence pitch.
- `category` — one of the closed enum (`orchestrator`, `ingest`, `automation`).
- `description` — long-form prose; renders on the website detail page.
- `version` — must match `plugin.json.version` and the most-recent `CHANGELOG.md` section header.
- `supported_prompts` — list of slash-command-style invocations users can reference.
- `ui_components` — list of UI widgets the plugin renders.
- `kms_kid` — render-token kid (always `agntux-render-v1` for now).
- `assets.icon` — `marketplace/icon.png`; must be 512×512 PNG, ≤512 KB.
- `assets.screenshots` — list of PNGs under `marketplace/screenshots/`; ≥1 entry.

Reserved (rejected by E11): `featured`, `download_count`, `i18n`. The marketplace is intentionally minimalist; if you need a new field, file a P15 amendment first.

## README + CHANGELOG conventions

`README.md` (≤500 lines): elevator pitch, install snippet, prompt reference, screenshots, support link. No marketing fluff; users read this to decide whether to install.

`CHANGELOG.md`: Keep a Changelog format. Section header per version: `## X.Y.Z — YYYY-MM-DD`. Subsections: `Added`, `Changed`, `Fixed`, `Removed`. The most-recent header must match `plugin.json.version` and `listing.yaml.version` exactly.

## Version-bump rubric (P7 §5.1)

- **MAJOR** — removed prompts, removed UI components, breaking schema change in `listing.yaml`, license-class change requiring re-onboarding.
- **MINOR** — new prompts, new UI components, additive schema fields, copy improvements visible to users.
- **PATCH** — bug fix or cosmetic change with no surface impact.

When in doubt, choose the higher bump. The `changelog-bump-heuristic.yml` workflow surfaces obvious mismatches as warnings (non-blocking).

## Worked example — adding a new prompt

You added an entry to `supported_prompts` in `listing.yaml`. This is a **MINOR** bump (new surface, additive). Steps:

1. Bump `plugin.json.version` and `listing.yaml.version` to the new minor (e.g., `1.2.3` → `1.3.0`).
2. Prepend a new `CHANGELOG.md` section: `## 1.3.0 — <today>` with an `### Added` line describing the prompt.
3. Run `npm run lint:marketplace -- --plugin <slug>` and confirm no errors.
4. Run `npx tsx scripts/verify-version-changelog.ts --plugin <slug>` to confirm the version match.
5. Commit, push, open a PR using `.github/PULL_REQUEST_TEMPLATE.md`. Don't tag — `regenerate-indexes.yml` does that post-merge.

## What NOT to do

- Don't edit `canonical/`. That's owned by `@agntux/security` and `@agntux/marketplace-maintainers`.
- Don't edit `plugins/<other-slug>/`. One PR = one plugin (rare exceptions per P7 §11.3).
- Don't replace `LICENSE`. The ELv2 stub is intentional.
- Don't add fields to `plugin.json` beyond the host spec (one permitted exception: `recommended_ingest_cadence`).
- Don't manually regenerate `.claude-plugin/marketplace.json` or `marketplace/index.json` — `regenerate-indexes.yml` owns those post-merge.

These conveniences are optional. You can author and ship a PR by hand without ever invoking this skill.
