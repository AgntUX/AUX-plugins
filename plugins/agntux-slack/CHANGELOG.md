# Changelog

All notable changes to agntux-slack are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — 2026-05-03

### Changed (BREAKING)
- **Sub-agents converted to top-level skills with `context: fork` +
  `agent: general-purpose`.** `agents/ingest.md` is now
  `skills/sync/SKILL.md`; `agents/draft.md` is now
  `skills/draft/SKILL.md`. The `agents/` directory is removed.
  This is the load-bearing fix: Cowork prefixes connector tools with a
  per-instance UUID, sub-agents must declare every tool in frontmatter
  `tools:`, and Cowork blocked the previous router-skill's attempt to
  edit the ingest sub-agent's `tools:` line at dispatch time — so the
  sub-agent ran without the namespaced Slack tools and silently failed.
  With `context: fork` + `agent: general-purpose` per the official
  Claude Code skill docs, the forked context inherits the host's full
  tool surface (including `mcp__<uuid>__slack_*`), no frontmatter edit
  is needed, and the dispatch path is direct (host description-match
  → skill, no router in between).
- **Router pattern retired.** The previous `skills/sync/SKILL.md`
  classified Lane A (ingest) vs Lane B (draft) and dispatched to the
  matching sub-agent. With auto-routing, each skill matches its own
  inbound prompts via its `description:` frontmatter directly — same
  mechanism that picks between `/agntux-onboard` and `/agntux-schema`.
  Lane B's UUID-resolution + frontmatter-edit dance is gone (lines
  50–88 and 104–134 of the old SKILL.md).

### Changed
- `recommended_ingest_cadence` flipped from `"Hourly"` to
  `"Every 30 min, 7am–10pm weekdays — chat is time-sensitive during
  work hours, quiet otherwise"`. The field is now treated as free-form
  authoring intent: personalization reads it verbatim and hands it to
  the host's scheduled-task tool (which accepts cadence strings or
  cron expressions). Old behaviour was 24/7 polling — wasteful
  overnight and weekend runs for a chat source that only matters
  during work hours. README and `marketplace/listing.yaml` copy
  refreshed accordingly.
- README's "Install" step rewritten to drop the fictional
  "host-dropped `.proposed` file" claim. The architect's Mode B reads
  this plugin's schema proposal directly from `marketplace/listing.yaml
  → proposed_schema` during `/agntux-onboard`.
- Step 0 contract-missing exit message changed from
  "awaiting data-architect Mode B run" to "run `/agntux-onboard`;
  will retry on the next scheduled tick" — `/agntux-onboard` is the
  user-facing entry point that triggers Mode B.

### Removed
- `agents/ingest.md` (moved to `skills/sync/SKILL.md`).
- `agents/draft.md` (moved to `skills/draft/SKILL.md`).
- `agents/` directory.
- The Lane B pre-dispatch UUID-resolution block in the previous
  `skills/sync/SKILL.md` router (no longer needed).

## [0.2.0] — 2026-05-03

### Changed
- **BREAKING:** Renamed plugin slug `slack-ingest` → `agntux-slack`. The
  new convention is that every AgntUX plugin slug starts with `agntux-`;
  the `-ingest` suffix is retired. The slash command is now
  `/agntux-slack:sync` (previously `/slack-ingest:sync`); subagent
  namespaces are `agntux-slack:ingest` and `agntux-slack:draft`. Internal
  data paths moved from `data/learnings/slack-ingest/` and
  `data/instructions/slack-ingest.md` to `data/learnings/agntux-slack/`
  and `data/instructions/agntux-slack.md`.

### Added
- `skills/sync/SKILL.md` resolves UUID-prefixed Slack connector tool
  names via ToolSearch at dispatch time and injects them into the
  ingest/draft subagents' frontmatter `tools:` line. Cowork registers
  connector tools under a per-instance UUID, so the previous static
  `tools:` list silently dropped every Slack call. Lane A filters
  out write tools (read-only ingest); Lane B keeps them (the
  chat-confirm-then-write draft flow needs them). Both lanes fail loud
  if the post-filter set is empty.

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
- `skills/sync/SKILL.md` — `/agntux-slack:sync` routing skill. Also
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
