# Changelog

All notable changes to slack-ingest are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-02

### Added
- Initial release. First production source-specific ingest plugin.
- `agents/ingest.md` — read-only 12-step ingest subagent. Discovery sweep
  (user-authored, user-mentioned, DM activity) seeds a per-channel cursor
  map. Per-channel polling fetches new messages; threads are fanned out
  via `slack_read_thread`. A separate tracked-threads registry catches new
  replies on parents older than the channel cursor. Hourly cadence.
- `agents/draft.md` — on-demand drafting subagent triggered by suggested
  actions (`Draft a reply`, `Schedule a reply`, `Summarise to canvas`).
  Drafts text in chat, shows the exact payload, asks for explicit yes/no,
  and only on `yes` calls `slack_send_message`, `slack_schedule_message`,
  or `slack_create_canvas`. No write tool fires without confirmation.
- `skills/sync/SKILL.md` — `/slack-ingest:sync` routing skill. Also
  dispatches inbound suggested-action prompts to `agents/draft.md`.
- `proposed_schema` declaring `person`, `company`, `project`, `topic`
  entity subtypes and the canonical six action classes — `deadline`,
  `response-needed`, `knowledge-update`, `risk`, `opportunity`, `other` —
  for `data-architect` Mode B review. (`decision-needed` is folded into
  `response-needed` per the architect's lock-file invariants.)
- Thread association invariant: every action item, entity-source row,
  and Recent Activity bullet keys on the parent's
  `(channel_id, thread_ts)`, never on a reply's own `ts`. Lesson learned
  from the previous Slack-ingestion attempt.
- Unified cursor map under `sync.md → cursor` carrying both
  channel-shaped (`<channel_id>`) and thread-shaped
  (`<channel_id>#<thread_ts>`) keys in a single JSON object — no
  separate `threads:` field, no schema divergence from the canonical
  sync.md shape. Thread-shaped entries evict at 30 days; channel-shaped
  entries never evict.
- Onboarding-mode cap: when `last_success` is null and the cursor map
  has zero channel-shaped entries (first run ever), process at most 5
  channels and queue the rest with `null` cursors. Keeps
  `/agntux-onboard`'s synchronous wrap-up snappy.
- `agents/draft.md` Step 8 calls `mcp__agntux-core__set_status` after a
  successful Slack write rather than direct-editing the action's
  frontmatter. The MCP server is the canonical surface for action
  mutations.
- Hooks bundle copied byte-for-byte from `canonical/hooks/` with the two
  documented placeholder substitutions (`public-key.mjs`,
  `agntux-plugins.mjs`).
