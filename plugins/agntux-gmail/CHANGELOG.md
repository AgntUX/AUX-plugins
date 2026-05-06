# Changelog

All notable changes to **agntux-gmail** are documented here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the version
in `.claude-plugin/plugin.json` MUST match the most-recent version section.

## [Unreleased]

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
