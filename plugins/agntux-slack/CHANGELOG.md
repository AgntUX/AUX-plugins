# Changelog

All notable changes to agntux-slack are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] — 2026-05-04

### Added
- **Step 5e — Thread coverage check.** A self-check after fetching: every parent message processed in this run must either (a) lack any thread evidence, (b) be in the `fanned_out` set or have a non-null thread cursor, or (c) have been covered by Step 5d. Anything else logs `slack-thread-orphaned` to `sync.md → errors` so the gap is observable. No new MCP calls.
- **Step 8a — Reply-state scan.** Before raising a `response-needed` action, scan the in-memory fetch buffer for a user reply to the candidate trigger. If the user already replied and no follow-up question / mention / deadline / escalation appeared after that reply, skip the action and log `slack-user-already-replied`. If a follow-up did appear, raise the action and cite the follow-up in `## Why this matters`.
- **Step 8.5 — Reconcile open response-needed items.** After per-item triage and before dedup, walk `actions/_index.md` for `status: open`, `source: slack`, `reason_class: response-needed` items whose source thread/channel was touched this run. Apply the same Step 8a scan against the latest data; if the user has handled it in Slack, transition the action to `status: done`, set `completed_at`, and append an `## Auto-resolved` body section. Documented in "Honesty rules" as a new bounded automated authority.
- **Two new `suggested_actions` buttons** on every Slack action item:
  - `Mark done — already handled in Slack` routes to `agntux-core`'s `set_status` MCP tool with `outcome: "completed-externally"`. Captures the *positive* signal that an item was correctly raised — distinct from a bare dismissal.
  - `Stop raising items like this` engages `agntux-core`'s `user-feedback` subagent so the user can capture an explicit `# Never raise` rule. Captures the *negative* signal that this kind of item is genuinely noise.
- The Step 10 `## Why this matters` body now requires citing both the parent ts AND the most-recent / most-action-relevant reply ts when the source is a thread, so the action is reviewable without re-fetching.
- New `sync.md → errors` kinds: `slack-thread-orphaned`, `slack-bootstrap-interrupted`, `slack-user-already-replied`, `slack-reconcile-failed`.

### Changed
- **Step 5c thread fanout — pull every thread, always.** The previous rule gated thread fetching on `reply_count > 0`. Slack frequently omits `reply_count` on `slack_read_channel` payloads (especially in DMs and private channels), so threads were silently skipped. The new rule treats `reply_count > 0`, `reply_users_count > 0`, `latest_reply` set, `thread_ts` present, OR appearing as a `thread_ts` parent of any other fetched message ALL as evidence of thread activity — any one triggers a full `slack_read_thread` fetch. Failed thread fetches log `kind: source` and the dependent action item is suppressed for that run.
- **Step 6 / Step 8 triage prefix.** Before extracting entities or deciding action-worthiness on a thread-rooted message, the skill MUST construct an in-memory merged view (parent + replies, chronologically). Citing only the parent text when replies exist is a correctness bug — this rule makes the merged-thread requirement explicit. The Step 10 `## Why this matters` rule above is the readable side of the same requirement.
- **Step 4 onboarding mode — drop the 5-channel cap, add a heads-up message.** The bootstrap run now processes every channel surfaced by discovery (no per-channel cap; coverage > snappiness for a one-time post-setup run). Before per-channel polling begins, the skill prints a single user-facing chat message announcing the channel count and stop-to-redirect option. Cancellation mid-bootstrap leaves unprocessed channels with `null` cursors for the next scheduled run; that condition logs `slack-bootstrap-interrupted` (renamed from `slack-onboarding-deferred`).

### Migration
- No user action required. Step 8.5's auto-resolution only fires for thread/channel data fetched in the current run, so existing open actions are unaffected unless their source is touched. Existing dismiss / snooze flows are unchanged. The two new `suggested_actions` buttons appear on freshly-raised actions; existing action files are not rewritten.

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
