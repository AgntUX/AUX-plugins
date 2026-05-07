# Changelog

All notable changes to **agntux-gmail** are documented here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the version
in `.claude-plugin/plugin.json` MUST match the most-recent version section.

## [Unreleased]

## [1.0.4] — 2026-05-06

### Fixed

- **`tools/call` result `_meta` now emits BOTH the modern nested
  `_meta.ui.resourceUri` AND the legacy flat `_meta["ui/resourceUri"]`
  for `agntux_gmail_compose_view`.** The legacy flat key was already
  present on the tool descriptor, but the call result still only carried
  the nested form, so any host that reads the legacy key off the call
  result (rather than the descriptor) would not see it.

## [1.0.3] — 2026-05-06

### Fixed

- **`_meta.ui.csp.resourceDomains` now includes `"data:"` and `"blob:"`.**
  Empty `resourceDomains` caused Claude Cowork's strict iframe sandbox to
  block `data:` / `blob:` URIs that the bundled single-file Vite output
  relies on, leaving the compose-reply iframe blank. MCPJam doesn't enforce
  the CSP envelope, which is why the view rendered there but not in
  Cowork. Restoring the previously-working CSP defaults.

## [1.0.2] — 2026-05-06

The actual Cowork iframe-render fix matching agntux-core 6.2.3 and
agntux-slack 5.2.2. Prior 1.0.1 attempt was wrong-track.

### Fixed

- **MCP server now advertises the `io.modelcontextprotocol/ui` extension
  capability at initialize time.** Per SEP-1865 §"Client\<\>Server Capability
  Negotiation", MCP Apps is an opt-in extension that MUST be bidirectionally
  negotiated during `initialize`. Without the server-side advertisement,
  Claude Cowork silently disabled MCP Apps for this server's tools and fell
  back to text-rendering the `structuredContent`. MCPJam was lenient about
  this; Cowork follows the spec strictly. The server now declares
  `extensions: { "io.modelcontextprotocol/ui": {} }` alongside the existing
  `resources` and `tools` capabilities, so the reply composer iframe renders
  in Cowork as well as in MCPJam.

## [1.0.1] — 2026-05-06

Render-fix patch matching agntux-core 6.2.2 and agntux-slack 5.2.1: the
reply composer now opens its iframe in Claude Cowork desktop, not just
MCPJam. (1.0.0 shipped with the same bug the slack and core plugins had.)

### Fixed

- **`agntux_gmail_compose_view` descriptor now declares `outputSchema`.**
  When a tool returns both `content[text]` and `structuredContent`, hosts
  diverge on which channel to surface; the deciding factor is whether the
  descriptor declares `outputSchema`. Without it, Cowork silently
  text-renders the structuredContent and never opens the iframe. The
  schema lists every top-level success-shape key plus `error`, with no
  `required` fields so the structured-error envelope also validates.
  Mirrors the official `scenario-modeler-server` example in
  `modelcontextprotocol/ext-apps`.
- **Descriptor `_meta` now emits both `ui.resourceUri` (modern, nested)
  and `"ui/resourceUri"` (legacy, flat) keys.** Defensive against hosts
  that only read one of the two synonymous keys.
- **Removed bogus `visibility: ["model","app"]` from result `_meta.ui`.**
  Per spec, `visibility` belongs on the descriptor; the default — both
  surfaces can call — needs no annotation. (Inherited from the slack
  template the plugin was scaffolded from.)

## [1.0.0] — 2026-05-06

### Added

- Initial release.
- Hourly Gmail ingest: discovery sweep + per-thread cursor map; bootstrap
  window default of 14 days.
- Triage rules: `to:me` / `cc:me` from real humans, threads where someone
  replied after the user's last message, sent items awaiting reply for ≥3
  days, IMPORTANT-label boost. Skips `category:promotions` /
  `category:social` / `category:forums` and `noreply@` / `notifications@`
  senders by default.
- Step 10.2 — pre-ingest reply-context gathering: searches up to 3 prior
  threads with each related person and synthesises a ≤500-char preamble into
  the action's `## Email context` body section. Token-guarded (≤3 prior
  threads, single MINIMAL `get_thread` call per action, per-person 7-day
  cache, gated on `response-needed` only).
- Cross-source merge protocol: when an open `agntux-slack` action overlaps
  semantically (LLM-judged topic match within a 48h window), the gmail run
  appends a `Draft an email reply` row to the existing action's
  `suggested_actions` plus a `## Cross-source links` body section instead of
  creating a duplicate. Auto-resolution honours sibling sources — replying in
  Slack closes the linked Gmail action.
- Compose UI handler (`ui://gmail-compose`) with editable to/cc/bcc/subject/
  body, "Why this draft?" personalization disclosure, and an "Email context"
  disclosure surfacing prior conversation history. Save button emits a
  two-step Gmail Connector envelope: `create_draft` followed by an "Open in
  Gmail Drafts" link the user clicks to review and Send from Gmail itself.
- License enforcement via `@agntux/mcp-license` gate on the MCP server's
  `tools/call` handler (per `packages/mcp-license/README.md`).
- Tests: cold-start, cursor-map, thread-association, draft-flow, idempotent.
