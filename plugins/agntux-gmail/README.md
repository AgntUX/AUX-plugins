# AgntUX Gmail

Turn your Gmail inbox into an AgntUX knowledge store, and let Claude draft
replies on demand — but only ever save them to your Gmail Drafts. You review
and click Send in Gmail itself.

## What it does

- Reads your inbox every hour. Discovers threads via:
  - emails addressed to you (`to:me`, `cc:me`)
  - threads where you've replied and someone has responded since
  - your sent items that have been awaiting a reply for ≥3 days
  - threads with the `IMPORTANT` Gmail label
- Extracts entities: email correspondents (people), organisations resolved
  from sender domains, workstreams from your `# Glossary`, and recurring
  topics across threads.
- Triages action items: response-needed (you've been asked something),
  deadlines mentioned in subjects or bodies, knowledge updates from
  decision-summary or status-update emails.
- Handles threads correctly: every action item links back to the parent
  thread's `<thread_id>`. New messages on threads we've seen before are
  caught via a per-thread cursor map.
- **Drafts replies on demand.** Click `Draft a reply` on an action item; the
  plugin renders an inline compose card with a pre-composed body informed by
  your `user.md`, your per-plugin instructions, related entity files, prior
  email conversations with the same person, and overlapping action items in
  other plugins. The actual draft is created in Gmail when you click Save.
- **The Save button writes to Gmail Drafts and opens the draft in a new
  tab.** The Gmail MCP server has no send-email tool — only `create_draft`.
  This is a real constraint, and the plugin is honest about it: clicking
  Save creates a draft in your Gmail Drafts folder and opens that draft
  for review. You click Send inside Gmail to actually send the email.
- Cross-source aware. If you have agntux-slack installed and an active
  Slack thread is about the same topic as an incoming email (LLM-judged
  topic overlap, 48h window), the action item from Slack gets a `Draft an
  email reply` button added — both reply paths live on one card. Replying
  in either channel auto-resolves the whole item on the next sync.

## Install

1. Make sure the **Gmail Connector** is connected to your host (e.g., via
   the Anthropic Connectors marketplace at
   `https://gmailmcp.googleapis.com/mcp/v1`). agntux-gmail does not
   authenticate with Gmail itself — it talks to the host-installed Gmail
   MCP server.
2. Install **AgntUX Core** if you haven't already.
3. Install **AgntUX Gmail** from the marketplace.
4. Run `/agntux onboard` (or re-run it if your tenant is already
   onboarded). The flow handles agntux-gmail's schema review automatically:
   personalization dispatches the data-architect's Mode B during the
   per-plugin interview, and the architect reads our schema proposal from
   `plugins/agntux-gmail/marketplace/listing.yaml → proposed_schema`,
   walks you through it in plain language, and writes the approved
   contract at
   `<agntux project root>/data/schema/contracts/agntux-gmail.md`.
   **Zero manual schema-review steps.**
5. Onboarding's State A wrap-up auto-fires `/agntux sync agntux-gmail`
   for the first synchronous bootstrap; the ongoing schedule (every hour)
   takes over after.
6. To trigger a sync manually any time, run `/agntux-gmail` (or
   `/agntux-gmail sync`, or `/agntux sync agntux-gmail` from the core
   namespace). Or ask a live question:
   `/agntux-gmail any unread threads from Acme this week?`.

## Configuration

**Bootstrap window:** on the first run the plugin ingests Gmail threads
from the last **14 days**. To override, add `bootstrap_window_days: N` to
the frontmatter of `<agntux project root>/user.md` (range 1–365).

**Triage preferences:** edit `<agntux project root>/user.md` →
`# Preferences` to control which emails generate action items. Add
patterns to `## Always action-worthy` or `## Usually noise`. To allow
specific automated senders (the default skips `noreply@`,
`notifications@`, and `*-bounces@`), add a per-plugin instruction in
`<agntux project root>/data/instructions/agntux-gmail.md` under
`# Always raise` — e.g., `from:digest@vercel.com` to allow a specific
weekly digest.

## The Save flow — what happens when you click Save

The Gmail MCP server only exposes `create_draft`; there is no
`send_message` tool. So the strongest action available from the iframe is
to save a draft in Gmail.

1. You click **Save as Gmail draft & open**.
2. The component emits a two-step envelope:
   - Step 1: `Use the Gmail Connector to call create_draft with to: [...],
     cc: [...], subject: «...», body: «...», replyToMessageId: «...»`.
   - Step 2: `Reply in chat with a clickable link of the form
     https://mail.google.com/mail/?authuser=<user_email>#drafts/<draft_id>
     labeled "Open draft in Gmail to review and send →"`.
3. The host runs `create_draft`, captures the returned `draftId`, and posts
   the link back to chat.
4. You click the link, land on the draft in Gmail, review, and hit Send
   inside Gmail.
5. On the next hourly sync, agntux-gmail sees your sent message in the
   thread and auto-marks the action `done` with an `## Auto-resolved`
   body section.

## Suggested-action flow

Action items raised by the sync sub-command (`skills/agntux-gmail/SKILL.md`
+ `reference/sync.md`) ship two buttons by default:

- `Draft a reply` — opens the compose iframe with a pre-composed body.
- `Open in Gmail` — deep-links to the thread in Gmail's web UI.

Snooze, "Stop raising items like this", and Done are intentionally NOT
plugin-authored — they're rendered for free by agntux-core's triage
chrome (Snooze button with 24h preset; Stop-raising in the Details modal;
primary Done button on every card). Plugin-side duplicates would be
redundant.

## Cross-source merge

If the same conversation is happening in both Gmail and another source
(typically Slack), agntux-gmail's Step 9 dedup looks for open
`response-needed` actions created in the last 48h whose
`## Why this matters` body matches the new email's topic semantically (an
LLM judgment, not a brittle keyword match). When matched, instead of
creating a duplicate action, the gmail run:

1. Appends a `Draft an email reply` row + an `Open in Gmail` row to the
   existing action's `suggested_actions`.
2. Appends a `## Cross-source links` body section listing the gmail thread.
3. Appends a `## Compose payload (gmail)` body section so the gmail compose
   view tool can lift its own payload from the same action file (it
   doesn't conflict with a sibling `## Compose payload (slack)` block).

The slack plugin's Step 9 has the symmetric behaviour as of agntux-slack
5.2.0 — slack-after-gmail runs append a `Draft a Slack reply` to an open
gmail action when the topic overlaps.

Auto-resolution (Step 8.5) honours the cross-source links: if the user
replies in **any** channel listed under `## Cross-source links` (e.g.
sends a message in the linked Slack thread, or sends from the linked
Gmail draft), the whole action is marked `done` on the next sync.

## UI handler

**Gmail reply composer** (`ui://gmail-compose`): When you click `Draft a
reply` on an action item, the host routes the click directly to the
compose view tool, which lifts the pre-composed draft + thread context +
prior-email-context from the action file's `## Compose payload` body
section and renders the iframe inline. You see the recipient list, the
subject, an editable to/cc/bcc/subject/body form, and two disclosures —
"Why this draft?" (personalization signals) and "Prior conversations"
(snippet-level context from up to 3 recent threads with the same person).
The Save button emits the two-step envelope described above.

The UI ships as an embedded component bundle (no external S3 fetch).
Build and bundle after any UI component changes via the top-level builder:

```sh
node scripts/build-plugin.mjs agntux-gmail
```

Or, when iterating locally with MCPJam Inspector:

```sh
node scripts/build-plugin.mjs agntux-gmail --serve
```

## Limitations

- **Cannot send emails.** The Gmail MCP server only exposes `create_draft`.
  Every "Save" click puts a draft in Gmail Drafts; the user finishes the
  Send action in Gmail itself. The action stays open until the next sync
  detects the user has actually sent the reply (auto-resolves on detection).
- **Cannot schedule sends.** No equivalent of Slack's
  `slack_schedule_message`. If the user wants to schedule, they do it
  inside Gmail's compose UI after clicking the Open-in-Drafts link.
- **Calendar invites are out of scope.** `category:updates` from
  `calendar-notification@google.com` and similar automated calendar
  emails are skipped by default.
- **Default skips.** `category:promotions`, `category:social`,
  `category:forums`, and senders matching `noreply@` / `no-reply@` /
  `notifications@` / `*-bounces@` are skipped. Override via
  `data/instructions/agntux-gmail.md → # Always raise`.
- **Volume caps:** 50 threads / 200 messages / 10 action items per run.
  Hot threads update existing action items rather than spawning duplicates.
- **Tracked-thread eviction:** thread cursors with no activity for 30
  days are dropped from the cursor map. Re-activity is caught via
  discovery if the user is `to:` or `cc:` on the new message.

## Hooks and license enforcement

AgntUX Gmail ships **no `hooks/` directory**. License enforcement lives
in this plugin's MCP server (`mcp-server/src/index.ts`) via the
`@agntux/mcp-license` gate, which wraps the `tools/call` handler.
`resources/read` for the UI bundle is intentionally ungated — see
`packages/mcp-license/README.md` §"Why only tools/call". The gate
prompts the user through a host-agnostic pairing flow when no valid
session exists.

The Gmail data connector is host-installed (declared via
`requires_source_mcp: { source: connector, connector_slug: gmail }` in
`marketplace/listing.yaml`); the MCP server in `mcp-server/` is the
plugin's own MCP App UI server (compose view tool), not the data
connector.

## License

Elastic License v2 (ELv2). See the `LICENSE` file for details.

## Support

- Bugs and proposals: https://github.com/AgntUX/AUX-plugins/issues?q=label%3Aagntux-gmail
- Email: support@agntux.ai
