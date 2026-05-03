# Slack Ingest

Turn your Slack workspace into an AgntUX knowledge store, and let Claude draft
replies on demand — but only ever send them after you confirm.

## What it does

- Reads every channel and DM you have access to, hourly. DMs, @mentions,
  and active threads are time-sensitive — that's why the cadence is
  Hourly, not Daily.
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
  item; the plugin fetches the thread, drafts a reply in chat, and asks
  you to confirm before sending. The actual `slack_send_message` call
  only fires after you say `yes`.
- Ships no UI components yet. The text-mediated draft flow is the
  present-day stand-in for a future card-with-Send-button UI.

## Install

1. Make sure the **Slack Connector** is connected to your host (e.g., via
   the Anthropic Connectors marketplace at `https://mcp.slack.com/mcp`).
   Slack-ingest does not authenticate with Slack itself — it talks to
   the host-installed Slack MCP server.
2. Install **AgntUX Core** if you haven't already.
3. Install **Slack Ingest** from the marketplace.
4. Run `/agntux-onboard` (or re-run it if your tenant is already
   onboarded). The flow handles slack-ingest's schema review automatically:
   the host's plugin install hook drops a `.proposed` file under
   `<agntux project root>/data/schema/contracts/`, and personalization
   dispatches the data-architect's Mode B during the per-plugin
   interview. The architect writes the approved contract at
   `<agntux project root>/data/schema/contracts/slack-ingest.md` and
   deletes the `.proposed` file. **Zero manual schema-review steps.**
5. Onboarding's State A wrap-up auto-fires `/agntux-sync slack-ingest`
   for the first synchronous bootstrap; the ongoing schedule (Hourly)
   takes over after.
6. To trigger a sync manually any time, run `/slack-ingest:sync` (or
   `/agntux-sync slack-ingest` from the core namespace). To revisit the
   architect's contract decisions later, run
   `/agntux-schema review slack-ingest` (only needed if you want to
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
`data/learnings/slack-ingest/sync.md → errors`, grant the connector's
search permission in your host and re-run `/slack-ingest:sync`.

**Triage preferences:** edit `<agntux project root>/user.md` →
`# Preferences` to control which Slack messages generate action items.
Add patterns to `## Always action-worthy` or `## Usually noise`. To
allow specific bot messages (the default skips all bot traffic), add a
per-plugin instruction in
`<agntux project root>/data/instructions/slack-ingest.md` under
`# Always raise` — e.g., `bot_id:B01ABC` to allow a GitHub PR bot.

## Suggested-action flow

Action items raised by `agents/ingest.md` ship four buttons by default
(`Draft a reply`, `Schedule a reply`, `Open in Slack`, `Snooze 24h`)
plus a fifth (`Summarise to canvas`) for thread-summary-worthy items.

When you click `Draft a reply`, the host routes a `ux:` prompt back to
this plugin. `agents/draft.md` then:

1. Reads the action item to recover `source_ref` (always the parent
   `<channel_id>#<thread_ts>`) and related entities.
2. Calls `slack_read_thread` to fetch full thread context.
3. Reads `<agntux project root>/user.md → # Preferences` for tone.
4. Drafts a body, shows it in chat with the channel name and the message
   it's replying to, and asks `Send this now? (yes / no / edit)`.
5. On `yes`, calls `slack_send_message` with the exact body shown and
   marks the action item `done`.

No write tool is ever called without an explicit `yes` in the
immediately preceding turn. There is no implicit "you said draft, here's
what I sent" path.

## Limitations

- Reads only. The ingest pass writes nothing back to Slack. The draft
  subagent is the only path that calls Slack write tools, and only after
  explicit user confirmation.
- DMs and group DMs are covered. Multi-party DMs (`mpim`) work the same
  way as channels via the per-channel cursor map.
- Bot messages are skipped by default. Add `bot_id:<id>` rules to
  `data/instructions/slack-ingest.md → # Always raise` to allow specific
  apps.
- Volume caps: 200 messages per channel per run, 10 action items per
  run. Hot threads update existing action items rather than spawning
  duplicates.
- Tracked-threads registry evicts threads with no activity for 30 days.
  New replies on long-dormant threads are caught via the discovery
  search (if you're @mentioned) or by re-discovery via the channel
  cursor (if the parent is touched).
- Ships no UI components. Suggested actions are text-mediated for now.

## Known canonical-hook diffs

Two files in `hooks/lib/` differ from `canonical/hooks/lib/` by design — every
diff is a documented placeholder substitution per P2 §8. Verifiers running
`shasum -c canonical/hooks/checksums.txt` from this plugin's `hooks/` directory
see these two diverge:

| File | Reason for divergence |
|---|---|
| `hooks/lib/public-key.mjs` | `{{PUBLIC_KEY_KID}}` → `agntux-license-v1`; `{{PUBLIC_KEY_SPKI_PEM}}` → real Ed25519 PEM from `canonical/kms-public-keys.json`. Substitution per P2 §8. |
| `hooks/lib/agntux-plugins.mjs` | `{{AGNTUX_PLUGIN_SLUGS}}` → `["agntux-core", "slack-ingest"]`. Substitution per P2 §8. |

All other hook files (`hooks.json`, `license-check.mjs`, `license-validate.mjs`,
`lib/{cache,device,jwt-verify,refresh,scope,ui,agntux-root}.mjs`) are byte-identical
to canonical and pass `shasum -c` cleanly.

Slack Ingest does NOT ship a local stdio MCP server (no UI components yet).
There is no `.mcp.json` either — the Slack connector is host-installed and
declared via `requires_source_mcp: { source: connector, connector_slug: slack }`
in `marketplace/listing.yaml`.

## License

Elastic License v2 (ELv2). See the `LICENSE` file for details.

## Support

- Bugs and proposals: https://github.com/AgntUX/AUX-plugins/issues?q=label%3Aslack-ingest
- Email: support@agntux.ai
