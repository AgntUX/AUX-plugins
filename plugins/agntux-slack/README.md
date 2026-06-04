# AgntUX Slack

Bring your Slack into AgntUX. It spots the messages that need a reply and drafts
responses for you — but never posts anything until you confirm.

## What it does

- Reads every channel and DM you have access to, every 30 minutes
  during weekday work hours (7am–7pm, your local timezone). DMs,
  @mentions, and active threads are time-sensitive while you're working
  but don't need overnight or weekend polling — quiet hours conserve
  tokens.
- Recognizes the people, companies, projects, and topics that come up across
  your Slack, so AgntUX can connect related items for you.
- Triages action items: response-needed (DMs, @mentions), deadlines,
  decisions buried in long threads, knowledge updates from pinned
  messages and canvases.
- Keeps each task tied to its channel and thread, so you can always open the
  full conversation. New replies on older threads are picked up automatically
  — nothing slips through.
- Drafts replies on demand. Click a `Draft a reply` button on an action
  item; the plugin fetches the thread, drafts a reply in chat, and shows
  an inline compose card. The actual `slack_send_message` call only fires
  after you confirm via the Send button.
- Summarises threads to Slack canvases. Click `Summarise to canvas` on an
  action item; the plugin renders an editable canvas card with TL;DR,
  decisions, open questions, and participants. The Create button triggers
  the canvas post back to the thread.

## Install

1. Make sure the **Slack Connector** is connected to your host (e.g., via
   the Anthropic Connectors marketplace at `https://mcp.slack.com/mcp`).
   agntux-slack does not authenticate with Slack itself — it talks to
   the host-installed Slack MCP server.
2. Install **AgntUX Core** if you haven't already.
3. Install **AgntUX Slack** from the marketplace.
4. Run `/agntux onboard` (or re-run it if your tenant is already
   onboarded). The flow handles agntux-slack's schema review
   automatically: personalization dispatches the data-architect's
   Mode B during the per-plugin interview, and the architect reads
   our schema proposal directly from
   `plugins/agntux-slack/marketplace/listing.yaml → proposed_schema`,
   walks you through it in plain language, and writes the approved
   contract at `<agntux project root>/data/schema/contracts/agntux-slack.md`.
   **Zero manual schema-review steps.**
5. Onboarding's State A wrap-up auto-fires `/agntux sync agntux-slack`
   for the first synchronous bootstrap; the ongoing schedule
   (every 30 min during weekday work hours) takes over after.
6. To trigger a sync manually any time, run `/agntux-slack` (or
   `/agntux-slack sync`, or `/agntux sync agntux-slack` from the core
   namespace). Or ask a live question:
   `/agntux-slack what's been happening in #implementations`. To revisit
   the architect's contract decisions later, run
   `/agntux schema review agntux-slack` (only needed if you want to
   change the approved contract — it is NOT a required install step).

## Configuration

**Bootstrap window:** on the first run the plugin ingests Slack messages
from the last **7 days** — overrides the P3 §6.1 default of 30 because
Slack volume is much higher than notes/email. To override, add
`bootstrap_window_days: N` to the frontmatter of
`<agntux project root>/user.md` (range 1–365).

**Channel coverage:** the plugin discovers channels three ways on every
run — channels you've authored in, channels you've been @mentioned in,
and DMs/MPIMs. Once a channel surfaces, it stays in the per-channel
cursor map and is polled on every run.

**First-run consent:** the discovery sweep uses
`slack_search_public_and_private`, which the host requires you to
approve on first call. If you see a `kind: auth` entry in
`data/learnings/agntux-slack/sync.md → errors`, grant the connector's
search permission in your host and re-run `/agntux-slack` (or
`/agntux-slack sync`).

**Triage preferences:** edit `<agntux project root>/user.md` →
`# Preferences` to control which Slack messages generate action items.
Add patterns to `## Always action-worthy` or `## Usually noise`. To
allow specific bot messages (the default skips all bot traffic), add a
per-plugin instruction in
`<agntux project root>/data/instructions/agntux-slack.md` under
`# Always raise` — e.g., `bot_id:B01ABC` to allow a GitHub PR bot.

## Suggested-action flow

Action items raised by the sync sub-command (`skills/agntux-slack/SKILL.md`
+ `reference/sync.md`) ship three buttons by default (`Draft a reply`,
`Schedule a reply`, `Open in Slack`) plus an optional fourth
(`Summarise to canvas`) for thread-summary-worthy items. Snooze, "Stop raising items like this", and "Mark done —
already handled in Slack" are intentionally NOT plugin-authored —
all three are redundant with built-in agntux-core triage chrome
(Snooze button with 24h preset; Stop-raising in the Details modal;
primary Done button on every card; Dismiss → "Completed externally"
outcome). Plugin-side duplicates were retired in 3.0.0 for Snooze /
Stop-raising and in 4.0.0 for "Mark done".

When you click `Draft a reply`, the host routes a `ux: Use the
agntux-slack plugin to open the reply composer for action {id}.` prompt
back to this plugin. The host's description-based auto-routing matches
the prompt against the `compose_view` MCP tool directly — no skill
round-trip — and the iframe renders inline with the pre-composed draft
already loaded.

1. The sync skill runs at scheduled cadence and pre-composes the draft
   body for every `Draft a reply`-bearing action item, informed by
   `user.md → # Preferences`, `data/instructions/agntux-slack.md`,
   related-entity files, and the 3 most recent overlapping action items.
   The drafted body, thread context, and personalization signals are
   stored in the action file's `## Compose payload` body section.
2. At click time, `compose_view` reads the action file, lifts the
   `## Compose payload` YAML, and renders the iframe with the editable
   draft already shown.
3. You edit, then click Send. The compose iframe emits a committed
   envelope back to chat that targets the user's **Slack Connector**
   directly (`Use the Slack Connector to send a Slack message as a
   thread reply. channel_id: …, thread_ts: …. Body: «…».`). The host
   reads the envelope and dispatches to `slack_send_message` /
   `slack_schedule_message` / `slack_send_message_draft` with the
   channel_id + thread_ts inline in the envelope. No agntux-slack skill
   round-trip, no disk read.

No Slack write tool is ever called without a committed envelope from
the iframe. The iframe Send button is the explicit authorisation gate.
Action files written by 2.x.x sync runs (without `## Compose payload`)
surface the graceful `compose_payload_missing` error inside the iframe.

The sync skill runs **inline** in whatever context the host hands it
(interactive chat or the scheduled-task scaffold) — no `context: fork`,
no nested `general-purpose` agent, no frontmatter `tools:` whitelist.
The skill inherits the parent's full tool surface (including the
UUID-prefixed Cowork connector tools `mcp__<uuid>__slack_*`) and,
critically, the parent's working-directory grant. The previous
"router skill + sub-agent" and `context: fork + agent: general-purpose`
shapes are both retired: each added a context boundary that did NOT
inherit the host's "Allow for all scheduled runs" grant, so every
scheduled fire silently re-prompted and the skill exited clean
without advancing the cursor. See the
[Claude Code skill docs](https://code.claude.com/docs/en/skills) for
the inline-skill shape.

## UI handlers

**Slack reply composer** (`ui://slack-compose`): When you click `Draft a
reply` or `Schedule a reply` on an action item, the host routes the
click directly to the compose view tool, which lifts the pre-composed
draft + thread context from the action file's `## Compose payload` body
section and renders the iframe inline. You see the channel name, the
parent message, the last reply quote, and an editable textarea prefilled
with the draft. Mode tabs let you choose Send now / Schedule / Save
Slack draft. A "Why this draft?" disclosure surfaces personalization
signals from `user.md` and per-plugin instructions. The Send button
emits a self-contained envelope addressed at the user's Slack Connector
(`Use the Slack Connector to send a Slack message as a thread reply.
channel_id: …, thread_ts: …. Body: «…».`). The host dispatches directly
to `slack_send_message` / `slack_schedule_message` /
`slack_send_message_draft`. The Send button is your explicit
confirmation; no Slack write happens before it. **Discard** is a pure
local action — it shows a "Discarded" banner and emits nothing to chat.

**Slack canvas summariser** (`ui://slack-canvas`): When you click
`Summarise to canvas` on an action item, the host routes the click
directly to the canvas view tool, which lifts the pre-composed canvas
sections from the action file's `## Canvas payload` body section. Four
editable section blocks (TL;DR, Decisions, Open questions, Participants)
plus an editable title come pre-populated. A Preview tab shows the
assembled markdown. The Create button emits a Slack-Connector-targeted
envelope (`Use the Slack Connector in two steps: 1. Create a Slack
canvas titled «…» … 2. Post it as a thread reply in channel_id: …,
thread_ts: …`). The host runs `slack_create_canvas`, takes the
returned canvas URL, and posts it as a Slack mrkdwn link in the thread.
**Discard** is a pure local action — it shows a "Discarded" banner and
emits nothing to chat.

Both UIs ship as embedded component bundles (no external S3 fetch). Build
and bundle both after any UI component changes via the top-level builder:

```sh
node scripts/build-plugin.mjs agntux-slack
```

Or, when iterating locally with MCPJam Inspector:

```sh
node scripts/build-plugin.mjs agntux-slack --serve
```

## Limitations

- Reads only. The sync skill writes nothing back to Slack. The draft
  skill is the only path that calls Slack write tools, and only after
  explicit user confirmation.
- DMs and group DMs are covered. Multi-party DMs (`mpim`) work the same
  way as channels via the per-channel cursor map.
- Bot messages are skipped by default. Add `bot_id:<id>` rules to
  `data/instructions/agntux-slack.md → # Always raise` to allow specific
  apps.
- Volume caps: 200 messages per channel per run, 10 action items per
  run. Hot threads update existing action items rather than spawning
  duplicates.
- Tracked-threads registry evicts threads with no activity for 30 days.
  New replies on long-dormant threads are caught via the discovery
  search (if you're @mentioned) or by re-discovery via the channel
  cursor (if the parent is touched).

## Hooks and MCP server

AgntUX Slack ships **no `hooks/` directory**. The Slack data connector
is host-installed (declared via `requires_source_mcp: { source:
connector, connector_slug: slack }` in `marketplace/listing.yaml`);
the MCP server in `mcp-server/` is the plugin's own MCP App UI server
(compose / canvas view tools), not the data connector.

## License

Apache License 2.0. See the `LICENSE` and `NOTICE` files at the repo
root for full terms.

## Support

- Bugs and proposals: https://github.com/AgntUX/AUX-plugins/issues?q=label%3Aagntux-slack
