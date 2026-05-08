# Slack-specific triage details

Companion to `../SKILL.md` Steps 6 / 8 / 8a. The canonical body covers
the source-agnostic shape; this file collects every Slack-specific
detail the agent needs at triage time.

## Step 6 — Slack entity guidance

Common kinds you'll see in Slack (only when your contract approves
them): `person` (Slack users — DM partners, channel co-authors,
mentioned colleagues; identified by user_id `U…`; resolve email +
real_name on first encounter via `slack_read_user_profile(user_id)`),
`company` (organizations referenced in shared links — email domains,
Linkedin URLs — or named in messages), `project` (codenames per
`user.md → # Glossary`), `topic` (recurring themes surfaced across
multiple Slack threads).

**Channels are NOT entities.** They surface via `source_ref` on action
items (`<channel_id>#<thread_ts>`) and via channel-name annotations in
`## Recent signals` bullets.

**Slack-specific lookup-before-write key.** For thread-rooted artefacts,
the source-id key is `<channel_id>#<thread_ts>` — the parent thread's
identifier, never the reply's own ts. This is the rule that prevents N
duplicate source-rows when one person is mentioned across N replies in
one thread. For Slack users, secondary-identifier search Greps on the
`email:` value (the canonical cross-source alias).

**Slug derivation for Slack users.** Prefer `<first-name>-<last-name>`
derived from `real_name`; fall back to `display_name` if the profile
lookup is restricted.

**Optional Slack-deep-link frontmatter** (additive — pre-positions data
for future "Open in Slack" links from entity chips). When the subtype
is `person` and the source artefact carries the relevant identifiers,
also include `slack_user_id` (the Slack `U…` user id) and, when this
person is a DM partner, `slack_dm_channel_id` (the Slack `D…` DM
channel id). Both fields are **optional** — they are not part of the
contract's required_frontmatter and the validator does not gate on
them. Set on creation; updated only if missing.

## Step 8 — Slack signal layer

Action classes you may use are limited to the canonical six per your contract: `deadline`, `response-needed`, `knowledge-update`, `risk`, `opportunity`, `other`. There is no `decision-needed` — vote/poll/"thoughts?" patterns map to `response-needed` (folded into `response-needed`).

**Default Slack action-worthy signals** (folded into "user.md → ##
Always action-worthy" matching):

- DM to user from a real person (not a bot) → `response-needed`, priority `high`.
- @mention of user in a channel → `response-needed`, priority `medium-to-high` (high if mention includes "?" or imperative; medium otherwise).
- Thread reply where user is OP and has not replied since → `response-needed`, `medium`.
- Vote/poll/"thoughts?"/"approve?" in a thread the user has stake in → `response-needed`, `medium` (folded from the previous `decision-needed`).
- Pinned message in any monitored channel → `knowledge-update`, `low` (unless `user.md` flags the channel as VIP).
- Keywords `outage|incident|sev[123]|breach|down`, or `@here` / `@channel` in a monitored ops/security channel → `risk`, `high`.
- Keywords `competitor|launched|raised|acquired|funding` in a marketing/sales channel → `opportunity`, `medium`.

**Default Slack noise** (folded into "## Usually noise"):

- Bot messages (`bot_id` set) — skipped unless `# Always raise` opts in (e.g., `bot_id:B01ABC` for a GitHub PR bot).
- Channel join/leave/topic-change system messages.
- Reactions-only updates (no text content).

## Step 8a — Slack follow-up signals + colleague-already-answered

When evaluating Step 8a's reply-state scan, the follow-up signals
expand to: a follow-up question (`?`), an `@user_id` mention, a
deadline phrase, or an escalation keyword (`urgent|asap|blocker|sev[123]`).

**Colleague-already-answered downgrade** (only when the user has NOT
yet replied). If an `## Always-flag senders` colleague (per
`data/instructions/agntux-slack.md`) authored a substantive message in
the same scope after the trigger:

- Heuristic for "substantive": non-trivial length (≥ ~30 chars), no `?` (it's an answer, not a question back), posted within ~30 min of the trigger, addresses the same topic.
- Raise the action at `priority: low` (not `medium`/`high`).
- In `## Why this matters`, lead with `Answered in scope by [[colleague-slug]] — pending [user] acknowledgment only.` then summarise.
- **Do NOT add an emoji-react suggested action.** The Slack MCP has no `reactions.add` tool.
- The compose payload still drafts a brief acknowledgment for the case where the user wants to reply in-thread instead of just reacting.
