# AgntUX Slack

Turn your Slack workspace into an AgntUX knowledge store, and let Claude draft
replies on demand — but only ever send them after you confirm.

## What it does

- Reads every channel and DM you have access to, every 30 minutes
  during weekday work hours (7am–10pm). DMs, @mentions, and active
  threads are time-sensitive while you're working but don't need
  overnight or weekend polling — quiet hours conserve tokens.
- Extracts entities: Slack users (people), organisations referenced in
  shared links, workstreams from your `# Glossary`, and recurring topics.
- Triages action items: response-needed (DMs, @mentions), deadlines,
  decisions buried in long threads, knowledge updates from pinned
  messages and canvases.
- Handles threads correctly: every reply, every entity row, and every
  action item links back to the parent thread's
  `(channel_id, thread_ts)`. New replies on old threads are caught via
  a tracked-threads registry — no missed activity.
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
4. Run `/agntux-onboard` (or re-run it if your tenant is already
   onboarded). The flow handles agntux-slack's schema review
   automatically: personalization dispatches the data-architect's
   Mode B during the per-plugin interview, and the architect reads
   our schema proposal directly from
   `plugins/agntux-slack/marketplace/listing.yaml → proposed_schema`,
   walks you through it in plain language, and writes the approved
   contract at `<agntux project root>/data/schema/contracts/agntux-slack.md`.
   **Zero manual schema-review steps.**
5. Onboarding's State A wrap-up auto-fires `/agntux-sync agntux-slack`
   for the first synchronous bootstrap; the ongoing schedule
   (every 30 min during weekday work hours) takes over after.
6. To trigger a sync manually any time, run `/agntux-slack:sync` (or
   `/agntux-sync agntux-slack` from the core namespace). To revisit the
   architect's contract decisions later, run
   `/agntux-schema review agntux-slack` (only needed if you want to
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
search permission in your host and re-run `/agntux-slack:sync`.

**Triage preferences:** edit `<agntux project root>/user.md` →
`# Preferences` to control which Slack messages generate action items.
Add patterns to `## Always action-worthy` or `## Usually noise`. To
allow specific bot messages (the default skips all bot traffic), add a
per-plugin instruction in
`<agntux project root>/data/instructions/agntux-slack.md` under
`# Always raise` — e.g., `bot_id:B01ABC` to allow a GitHub PR bot.

## Suggested-action flow

Action items raised by `skills/sync/SKILL.md` ship four buttons by
default (`Draft a reply`, `Schedule a reply`, `Open in Slack`,
`Mark done — already handled in Slack`) plus an optional fifth
(`Summarise to canvas`) for thread-summary-worthy items. Snooze and
"Stop raising items like this" are intentionally NOT plugin-authored
— both are built-in agntux-core triage chrome (Snooze button with 24h
preset; Stop-raising in the Details modal), so plugin-side duplicates
were retired in 3.0.0.

When you click `Draft a reply`, the host routes a `ux: Use the
agntux-slack plugin to open the reply composer for action {id}.` prompt
back to this plugin. The host's description-based auto-routing matches
the prompt against the `compose_view` MCP tool directly — no draft skill
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
   envelope back to chat (`ux: ...commit the drafted reply for action
   {id} with body «…» (mode: send).`) which the draft skill matches and
   parses. On a well-formed envelope, the draft skill calls
   `slack_send_message` with the exact (possibly edited) body and marks
   the action item `done` via `mcp__agntux-core__set_status`.

No write tool is ever called without a committed envelope from the
iframe. The iframe Send button is the explicit authorisation gate.
Action files written by 2.x.x sync runs (without `## Compose payload`)
surface the graceful `compose_payload_missing` error inside the iframe.

Both skills run with `context: fork` and `agent: general-purpose` per
the [Claude Code skill docs](https://code.claude.com/docs/en/skills).
This pattern gives each dispatch a fresh context (important for
scheduled-task firings) without locking the skill to a frontmatter
`tools:` whitelist — the general-purpose agent inherits the host's
full tool surface, including the UUID-prefixed Cowork connector tools
(`mcp__<uuid>__slack_*`). The previous "router skill + sub-agent"
pattern is retired (it failed when Cowork blocked the dispatch-time
frontmatter edit).

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
emits a committed envelope (`ux: ...commit the drafted reply...`) back
to chat — the draft skill matches the envelope and calls
`slack_send_message` with your exact (possibly edited) body. The Send
button is your explicit confirmation; no Slack write happens before it.

**Slack canvas summariser** (`ui://slack-canvas`): When you click
`Summarise to canvas` on an action item, the host routes the click
directly to the canvas view tool, which lifts the pre-composed canvas
sections from the action file's `## Canvas payload` body section. Four
editable section blocks (TL;DR, Decisions, Open questions, Participants)
plus an editable title come pre-populated. A Preview tab shows the
assembled markdown. The Create button emits the committed canvas
envelope back to chat; the draft skill then calls `slack_create_canvas`,
posts the canvas to the thread, and surfaces the canvas link back in
the action item thread.

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

## Hooks and license enforcement

AgntUX Slack ships **no `hooks/` directory**. License enforcement lives
in this plugin's MCP server (`mcp-server/src/index.ts`) via the
`@agntux/mcp-license` gate, which wraps the `tools/call` handler.
`resources/read` for the UI bundle is intentionally ungated — see
`packages/mcp-license/README.md` §"Why only tools/call". The gate
prompts the user through a host-agnostic pairing flow when no valid
session exists.

The Slack data connector is host-installed (declared via
`requires_source_mcp: { source: connector, connector_slug: slack }` in
`marketplace/listing.yaml`); the MCP server in `mcp-server/` is the
plugin's own MCP App UI server (compose / canvas view tools), not the
data connector.

## License

Elastic License v2 (ELv2). See the `LICENSE` file for details.

## Support

- Bugs and proposals: https://github.com/AgntUX/AUX-plugins/issues?q=label%3Aagntux-slack
- Email: support@agntux.ai
