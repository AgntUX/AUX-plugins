# CLAUDE.md — AgntUX/AUX-plugins

This is the public AgntUX plugin marketplace. Every plugin in `plugins/` is a
host plugin distributed via `.claude-plugin/marketplace.json` at the repo root.

---

## AgntUX Project Root

User data lives in **any directory named `agntux`** (case-insensitive). At
runtime, hooks and MCP servers resolve the project root by:

1. Walking up from the host's `process.cwd()` for the nearest ancestor whose
   lowercased basename is `agntux`.
2. Falling back to `<home>/agntux` if no walk-up match.
3. Returning null (hooks passthrough) or a best-guess path (MCP guards) if
   neither exists.

The single resolver is `canonical/hooks/lib/agntux-root.mjs`
(`resolveAgntuxRoot()`); the orchestrator MCP server has a TS twin at
`canonical/mcp-server-templates/orchestrator/src/agntux-root.ts`. **Never
hardcode `~/agntux-code/` or `homedir() + "agntux"` in new code** — always
go through the resolver. Prompts and docs that need to reference the path
should write `<agntux project root>/...` (or `<root>/...` once defined in
the prompt).

---

## Repo Layout

```
AgntUX/AUX-plugins/
├── .claude-plugin/marketplace.json    # Plugin index for the host's marketplace mechanism (CI-regenerated)
├── .claude/                           # Maintainer slash commands and skills
├── canonical/                         # Byte-frozen hook bundle + prompt templates + mcp-server templates
├── marketplace/index.json             # CI-regenerated aggregate of every listing.yaml (READ-ONLY)
├── plugins/{plugin-slug}/             # One directory per plugin
├── scripts/                           # Lint + regeneration scripts
└── CLAUDE.md                          # This file
```

---

## ELv2 License — What It Means

All plugins are licensed under the **Elastic License 2.0** (ELv2). See `LICENSE`
for the canonical text.

Three explicit limitations apply to every file in this repo:

1. **No managed-service offering.** You may not provide the software (or a
   derivative) to third parties as a hosted, managed, or SaaS offering.
   A user running plugins locally inside their own host installation is fully
   permitted — that is the entire intended use case.

2. **No license-key circumvention.** The `license-check` and `license-validate`
   hooks constitute the license-key mechanism under ELv2. Bypassing them —
   patching out the JWT check, hard-coding a fake token, redistributing a
   stripped fork without the hooks — violates the license.

3. **No removal of notices.** The `LICENSE`, `NOTICE`, and attribution lines in
   source files must remain intact in any redistribution.

When authoring or reviewing a plugin PR, verify all three limitations are
respected. If unsure, contact `legal@agntux.ai` before merging.

---

## When You Edit a Plugin

Every plugin under `plugins/{plugin-slug}/` MUST ship the following files
(see P15 §2 for the full specification):

- `.claude-plugin/plugin.json` — the host's plugin manifest. Aligned with the
  host's spec, plus exactly one runtime-only custom field
  (`recommended_ingest_cadence`, §2.5.1). Do NOT add other custom fields.
- `LICENSE` — Elastic License v2 (ELv2). Per-plugin stub pointing to the root
  `LICENSE`. Do NOT replace or modify.
- `hooks/` — byte-frozen license bundle. Identical across plugins except
  `lib/public-key.mjs` and `lib/agntux-plugins.mjs`. Do NOT modify (CI
  hash-check will reject the PR).
- `marketplace/listing.yaml` — structured marketplace metadata. **Required.**
- `marketplace/icon.png` — 512×512 PNG, ≤ 512 KB.
- `marketplace/screenshots/NN-name.{png,jpg}` — 1–8 screenshots.
- `README.md` — one-screen explainer; doubles as the listing detail body
  rendered on agntux.ai/plugins/{slug}.
- `CHANGELOG.md` — Keep-a-Changelog v1.1.0 format. Most-recent version section
  MUST match `plugin.json`'s `version` field.

---

## Authoring Rules

- **Plugin manifest stays minimal.** Don't add fields to `plugin.json` beyond
  the host's documented spec, with one explicit exception:
  `recommended_ingest_cadence` (§2.5.1). Marketplace display metadata goes in
  `listing.yaml` only.
- **Contributor attribution by GitHub username.** `developer.github_handle` is
  the canonical identity in `listing.yaml`. The website renders `@{handle}`
  linking to `https://github.com/{handle}`.
- **`tagline` is plain text; `description` and `purpose` fields support
  markdown.** Don't author HTML tags — they get escaped.
- **`recommended_ingest_cadence` lives in `plugin.json` only** — never in
  `listing.yaml`. P4's personalization subagent reads it from there at runtime.
- **CHANGELOG version MUST match `plugin.json` version.** The linter rejects
  mismatches.
- **Screenshots are listing collateral, NOT functional UI.** Real UI bundles are
  served from S3 with signed URLs (P2 §11).
- **Hook files are byte-frozen.** CI hash-checks every plugin's `hooks/` against
  `canonical/hooks/`. Only `lib/public-key.mjs` and `lib/agntux-plugins.mjs`
  may differ (substituted by the generator at plugin-build time).

---

## How to Validate Locally

```bash
npm install
npm run lint:marketplace                             # Lint every plugin
npm run lint:marketplace -- --plugin agntux-slack    # Lint one plugin
```

The linter is the same script CI runs. Local-passing means CI-passing.

---

## How to Update a Listing

1. Edit `plugins/{plugin-slug}/marketplace/listing.yaml` (or any other
   `marketplace/`, `README.md`, or `CHANGELOG.md` file).
2. Push to a branch; open a PR.
3. CI runs the linter. Read the error output and fix any failures.
4. On merge, the aggregate-index regeneration workflow fires; agntux.ai/plugins
   picks up the change within ~5 minutes.

---

## Repo Automation

The `.claude/commands/` directory contains slash commands for common operations:

| Command | Purpose |
|---|---|
| `/add-plugin {slug}` | Manually add a plugin entry to `marketplace.json` |
| `/lint-plugin {slug}` | Lint a plugin's marketplace metadata |
| `/bump-version {slug} {major\|minor\|patch}` | Apply the versioning rubric |
| `/rollback {slug}` | Step through the rollback runbook |
| `/update-canonical-hooks` | Walk through the canonical-hook update runbook |
| `/review-pr [PR#]` | Apply the PR review checklist |

The `plugins/plugin-toolkit/` plugin bundles two namespaced skills under
one ELv2 footprint:

- `/plugin-toolkit:author` — authoring orchestrator that delegates to 7
  specialist agents (manifest, ingest prompt, source semantics, draft
  flow, tests, invariants, release). Auto-triggers on
  `plugins/*/marketplace/listing.yaml`,
  `plugins/*/.claude-plugin/plugin.json`, `plugins/*/CHANGELOG.md`,
  `plugins/*/README.md`, `plugins/*/agents/*.md`, and
  `plugins/*/skills/**/SKILL.md`.
- `/plugin-toolkit:maintain` — maintainer runbooks (PR review,
  rollback, kill-switch, canonical-hook update, secret rotation, CI
  workflow map). Auto-triggers on `.github/**`, root `CHANGELOG.md`,
  root `README.md`, and on issues labelled `regression`,
  `kill-switch`, or `canonical-hook-rollout`.

---

## PR Review Checklist

Apply this checklist on every plugin PR (also available via `/review-pr`):

- [ ] `marketplace/listing.yaml` passes `npm run lint:marketplace`
- [ ] `CHANGELOG.md` version matches `plugin.json` version
- [ ] Hook files are byte-identical to `canonical/hooks/` (`hook-hash-check` CI green)
- [ ] Screenshots present, ≥1, correct dimensions (per P15 §4.2)
- [ ] `icon.png` is 512×512, ≤ 512 KB
- [ ] `README.md` ≤ 500 lines, renders cleanly via `react-markdown` + `remark-gfm`
- [ ] No custom fields added to `plugin.json` beyond host spec (one permitted
  exception: `recommended_ingest_cadence`)
- [ ] ELv2 `LICENSE` stub present and unmodified
- [ ] Version bump follows the semver rubric:
  - MAJOR: breaking change to public surface (prompts users rely on, `ux:` prompts, `requires_source_mcp.connector_slug`, removing a category or `ux_components` entry)
  - MINOR: additive non-breaking (new `ux_components`, new `supported_prompts`, new optional field, new screenshot, new category)
  - PATCH: no-surface change (copy fix, README typo, screenshot replacement, lint compliance, dependency bump)
- [ ] ELv2 limitations respected (no managed-service offering, no hook bypass, no notice removal)

---

## What's Out of Scope for This Repo

- The agent skill prompts (P4 / P5 specify those; this repo ships them as part of each plugin tree).
- The build-orchestrator infra (P2 / P6 territory).
- The user-build product UI (a separate repo, agntux/app).
- The marketplace listing UI (a separate repo, agntux/website).
