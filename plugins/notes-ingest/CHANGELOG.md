# Changelog

All notable changes to notes-ingest are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `bin/notes-fs.mjs` — wrapper around the MCP filesystem server that
  resolves the AgntUX project root at startup and forwards
  `<root>/notes` to `@modelcontextprotocol/server-filesystem`. Replaces
  the brittle `${HOME}/agntux/notes` arg in `.mcp.json` (would not
  expand on Windows hosts).

### Changed
- Hook libraries (`scope.mjs`) routed through the new shared
  `resolveAgntuxRoot()` resolver — hooks reach the user's data
  regardless of which `agntux/` directory they cwd from.
- Prompt/doc references swept from literal `~/agntux/` to the
  `<agntux project root>/` placeholder.

## [2.1.0] — 2026-05-02

### Changed
- Pre-flight error messages and user-facing prompts updated to use
  the new bare `/agntux-*` slash-command form (per `agntux-core` 4.0.0):
  `/agntux-onboard`, `/agntux-schema review notes-ingest`,
  `/agntux-schema edit`, `/agntux-profile`. The previous
  `/agntux-core:*` form still resolves on hosts that auto-prefix by
  plugin slug, but the bare form works on every host. Existing users
  with old scheduled tasks should migrate per `agntux-core` 4.0.0's
  migration table.

## [2.0.0] — 2026-04-30

### Changed (BREAKING)
- The flat `skills/orchestrator.md` is **removed** and replaced with `skills/sync/SKILL.md`. The previous file shape (`skills/{name}.md`) is silently dropped by the Claude Code plugin spec — only `skills/{name}/SKILL.md` directories register. The plugin's scheduled-task dispatch path was therefore broken in 1.0.0.
- The cross-plugin routing layer (Lane B for UI rendering) is gone — this plugin ships no UI components, so the lane was unused. The orchestrator collapsed to a single dispatch: run an ingest pass.
- The scheduled-task prompt body must be migrated:
  - `ux:notes-ingest` → `/notes-ingest:sync`

### Added
- `/notes-ingest:sync` — manual or scheduled ingest. Preserves project-root and
  `user.md` gates from the prior orchestrator and dispatches to the `ingest`
  subagent. Also reachable as `/agntux-sync notes-ingest`.

## [1.0.0] — 2026-04-28

### Added
- Initial release.
