# Changelog

All notable changes to plugin-toolkit are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-03

### Added
- Initial release. Bundles the previously-standalone `plugin-author` and
  `marketplace-maintainer` skills into a single Claude Code plugin under
  one ELv2 footprint, distributed through the AgntUX marketplace.
- `skills/author/SKILL.md` — slim ~200-line orchestrator that auto-triggers
  on plugin-author globs (`plugins/*/marketplace/listing.yaml`,
  `plugins/*/.claude-plugin/plugin.json`, `plugins/*/CHANGELOG.md`,
  `plugins/*/README.md`, `plugins/*/agents/*.md`,
  `plugins/*/skills/**/SKILL.md`). Carries the load-bearing authority
  table, schema-as-runtime rule, and chat-confirm-then-write rule inline;
  delegates section-specific work to 7 specialist agents.
- `skills/author/references/` — extracted reference material:
  `anti-patterns.md` (formerly §20), `quickstart.md` (formerly §3),
  `examples.md` (formerly §21).
- `skills/author/templates/draft-subagent.md` — the 168-line drafting
  subagent skeleton (formerly §11.3.1) as a copy-paste artefact.
- `skills/maintain/SKILL.md` — copied verbatim from
  `marketplace-maintainer`, with the cross-reference updated to point at
  the sibling `/plugin-toolkit:author` skill.
- `agents/manifest-author.md` — listing.yaml schema, proposed_schema,
  plugin.json minimum, icon/screenshots/categories.
- `agents/ingest-prompt-author.md` — `agents/ingest.md` template
  substitution and `skills/{name}/SKILL.md` directory-shape trap.
- `agents/source-semantics-advisor.md` — cursor strategies, threads /
  parent-child handling, volume caps, `_sources.json` lookup-before-write.
- `agents/draft-flow-author.md` — chat-confirm-then-write contract,
  drafting subagent (reads `templates/draft-subagent.md`), action-mutation
  MCP tools, `data/instructions/{slug}.md` contract.
- `agents/tests-author.md` — vitest skeletons (cold-start, cursor-map,
  thread-association, draft-flow, idempotent).
- `agents/invariant-checker.md` — hooks byte-freeze (`shasum` against
  `canonical/hooks/`) and agntux-core coordination
  (plugin-suggestions.json, AGNTUX_PLUGIN_SLUGS, agntux-core CHANGELOG).
- `agents/release-checker.md` — README/CHANGELOG, version-bump rubric,
  lint runbook, 19-point PR self-review checklist. Delegates to
  `/bump-version`, `/lint-plugin`, `/review-pr` slash commands.
- Hooks bundle copied byte-for-byte from `canonical/hooks/` with the
  two documented placeholder substitutions: `lib/public-key.mjs` and
  `lib/agntux-plugins.mjs` (`AGNTUX_PLUGIN_SLUGS = ["agntux-core",
  "plugin-toolkit"]`, matching the agntux-slack convention of
  core+self).
