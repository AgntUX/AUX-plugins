# Changelog

All notable changes to agntux-build are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-05-10

Tightens the build skill's voice, scopes the marketplace search,
biases toward comprehensive in-host action coverage, and lets the
build/test stages self-fix without pausing for the contributor.
Also lifts a static-route gate that blocked headless mode and adds
a content-rubric and prepare-scratch path to the test harness.

### Changed
- **Search scopes to AgntUX only.** Stage 1 reads
  `marketplace/index.json` (local clone if present, otherwise the
  CI-published GitHub raw URL via `WebFetch`) and never touches the
  host's full plugin universe. Earlier behaviour returned false
  negatives ("no AgntUX plugin") when a non-AgntUX plugin with the
  same name existed in another marketplace.
- **Stage 4 / 5 default to comprehensive write-verb coverage.** A
  Jira-class connector now ships 4–5 in-host action handlers
  (comment, transition, assign, edit, set priority) by default; the
  prior "one primary write verb" cap is gone. Two verbs collapse to
  tabs only when their *inputs* collapse.
- **"Open in {connector}" is always secondary.** Re-stated as the
  iframe-header `Open ↗` link, never a top-level suggested-action
  button. AgntUX's suggested-action UX stays one-button-per-action;
  no "more" / overflow menus.
- **Stage 7 specialist failures self-fix silently.** The user no
  longer sees "want me to retry?" prompts. On second failure, an
  Opus-tier executor takes a third pass; only after a third miss
  does the user see a one-line save-the-session message.
- **Stage 7 → 8 transition is automatic.** No "ready to install?"
  confirmation gate before the render check.
- **Stage 8 self-fixes silently.** Console errors and render-state
  drift dispatch the executor (sonnet → opus) up to three times
  before surfacing anything; no inline screenshot until stage 11.
- **Stage 9 explicitly names the first user pause.** A header
  sentence makes the contract clear: stages 1–8 ran without
  pausing, this is the install step.
- **Stage 10 sync-iterate copy drops "Show more".** AgntUX action
  items don't have a "show more" affordance under the
  one-button-per-action rule.
- **Stage 12 wrap-up is non-technical.** The closing message no
  longer enumerates files in the zip, specialists that ran, or
  schema keys; full detail lives in the session JSON for
  maintainers.
- Field renamed: `primary_write_verb` (scalar) →
  `primary_write_verbs` (array). Read-only sources save `[]`.

### Added
- **`probe-chromium` subcommand** on
  `test-harness/bin/cli.mjs`. Resolves Playwright via the
  host-renderer workspace and stat-checks
  `chromium.executablePath()`. Prints
  `{installed, executablePath?, reason?}` and exits 0 (installed)
  or 1 (not installed / import failed). Used by the stage 8
  Chromium-auto-install flow. Module
  (`test-harness/src/probe-chromium.mjs`) ships with vitest
  coverage matching the rest of `test-harness/__tests__/`.
- **Content-rubric checks** in `playwright-driver.mjs`. After
  `state=tool-result`, the harness now runs per-tool DOM
  assertions (`CONTENT_RULES`) verifying the rendered iframe
  contains the source-side context (issue key, draft body,
  verb-labelled button). Failures surface as
  `contentChecks.failed[]` in the harness JSON output and
  fail the render.

### Skill-prompt instructions (no code yet)
- **Stage 7.5 invariant gates** before the render run: tsc
  compile, no-boilerplate, embed-pass, `_meta.ui.resourceUri`
  shape. The orchestrator dispatches `executor` on miss with the
  same self-fix cadence as stage 7.
- **Chromium auto-install** in stage 8. The orchestrator runs
  `probe-chromium` first; on miss, runs
  `playwright install chromium` and surfaces a single one-time
  setup status line, then continues.
- **Read-only-host fallback** in stage 8. The orchestrator copies
  `host-renderer/` and `test-harness/` to a writable scratch dir
  on read-only mounts (Cowork sandbox, Claude Desktop plugin
  mount) and points the harness at it via `--host-bin`. Internal
  prepare-scratch in the harness itself is a follow-up.

### Fixed
- `host-renderer/src/server.mjs` served `host.html` and
  `host-bridge.mjs` only outside `--headless` mode, so every
  Playwright run 404'd on the host page. Both routes are now
  unconditional.

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
