# Changelog

All notable changes to agntux-build are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-08

Initial release. The user-facing front door for the
end-user-as-contributor flywheel — a one-click marketplace install that
walks a knowledge worker through building a brand-new AgntUX plugin
without ever surfacing engineering jargon.

### Added
- `/agntux-build:build` orchestrator skill with stages 0–12 (identity +
  Developer Certificate of Origin capture, marketplace search, install
  or improve, connector authorisation, tools discovery, write-back UI
  planning, design + preview, build, headless test, zip + install
  handoff, sync iteration, triage UI test, submit).
- Eight internal specialist agents lifted from `agntux-plugin-dev`'s
  `plugin-toolkit` (manifest, ingest-prompt, source-semantics,
  draft-flow, tests, invariant-checker, release-checker,
  ui-handler-author). Hidden from user-facing copy — agent names never
  surface in chat.
- Canonical UI authoring knowledge layer (17 modules) and the React +
  Vite UI handler `_template/` scaffold under `canonical/`.
- Lightweight in-plugin MCP App host renderer under `host-renderer/`,
  forked from `modelcontextprotocol/ext-apps/examples/basic-host` (MIT)
  with a headless mode and a plugin MCP bridge — no MCPJam Inspector
  required.
- `agntux-build-test` CLI under `test-harness/` for headless
  Playwright-driven render checks against the in-plugin host.
- Identity + DCO capture flow at first run: stores
  `<agntux project root>/.agntux-build/contributor.json` with name,
  email, DCO version, and timestamp; embeds a per-zip
  `CONTRIBUTING-SIGNATURE.md` carrying the `Signed-off-by:` trailer
  Probot DCO accepts.

### Voice
- Knowledge-worker tone end-to-end. No "schema", "dispatch",
  "render pipeline", "byte-freeze", "validator" or other internal
  terms surface in chat. Stage transitions are silent.
- Light-mode-only design rules; deviations redirect to
  `https://github.com/AgntUX/AUX-plugins/issues` rather than relenting.
- Gratitude at every milestone. The 3–5-iteration sync loop is set as
  the expected norm rather than a failure mode.
