# Changelog

All notable changes to agntux-core are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- (next-version changes go here)

## [2.0.0] — 2026-04-29

### Added
- `agents/data-architect.md` — owns `~/agntux/data/schema/`. Modes A (bootstrap from `user.md`), B (plugin install review of `.proposed` contracts), C (schema edit). (P3a §1.1)
- `agents/user-feedback.md` — owns `~/agntux/data/instructions/`. Modes A (capture imperatives), B (teach interview), C (structural escalation to `state/schema-requests.md`). (P3a §1.2)
- `hooks/validate-schema.mjs` — PreToolUse blocking validator for entity/action writes against the tenant `schema.lock.json`. Helper at `hooks/lib/schema-lock.mjs`. (P3a §3)
- `data/schema-template/` — seed master contract + four default subtypes (person, company, project, topic) + actions index. (P3a §4)
- `data/role-presets/{pm,swe,sales,default}.md` — baseline schema proposals for the architect's Mode A. (P3a §4)
- Three new prompts in `marketplace/listing.yaml`: `/ux schema review`, `/ux schema edit`, `/ux teach`.
- Personalization Mode A interview adds Stage 2.5 (Day-to-Day, Aspirations, Goals with horizon tags) and Stage 4.5 (Sources). (P3a §2)

### Changed
- `agents/feedback.md` renamed to `agents/pattern-feedback.md`. Behaviour unchanged; rename disambiguates from the new `user-feedback` subagent. (P3a §1.3)
- `skills/orchestrator.md` adds Pre-classification stage (schema-bootstrap, `.proposed` review, schema-requests queue) and Lanes E (schema-review), F (schema-edit), G (teach).
- `agents/retrieval.md` gains read-only access to `data/schema/`, `data/instructions/`, `state/`. State paths shift `.state/sync.md` → `state/{plugin-slug}/sync.md`.

### Schema
- Reverses P3 D6 ("plugins own contracts"). Vocabulary authority is now central (architect owns `~/agntux/data/schema/`); plugins read their permits from `data/schema/contracts/{plugin-slug}.md` at run-start. (P3.AMEND.4 / P4.AMEND.3 / P5.AMEND.1)
- Migration is **deferred** to P3b. The architect logs one-line warnings to `state/schema-warnings.md` for any change that would require a backfill.

## [1.0.0] — 2026-04-01

### Added
- Initial release.
