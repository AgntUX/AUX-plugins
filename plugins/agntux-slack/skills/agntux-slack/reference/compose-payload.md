# Slack compose payload schema

Companion to `../SKILL.md` Step 10. The action item's frontmatter,
priority anchoring, and `suggested_actions` envelope shape live in the
SKILL body. The fenced-YAML payloads that the slack compose / canvas
iframes load at click time live here.

## §4 contract divergence — composition at ingest

In Slack, the agent composes the draft reply at **ingest time** (during
sync), not at click time. The drafted body, thread context, and
personalization signals are persisted into the action file's `## Compose
payload` body section so the compose iframe can lift them at click time
without re-derivation. This is the §4 contract divergence note: prior
versions deferred composition to a `skills/draft/` round-trip; 5.0.0+
emits envelopes targeting the Slack Connector directly, so the
composition-at-ingest model is what the compose iframe relies on.

## suggested_actions — the three standard buttons (4.0.0+)

Default ship is **2–4 buttons**: `Draft a reply`, `Schedule a reply`,
`Open in Slack` (3 by default; drops to 2 when `slack_open_url` is
null). For thread-summary-worthy items add a 4th `Summarise to canvas`
row. The deprecated `Mark done — already handled in Slack`, `Snooze
24h`, and `Stop raising items like this` rows are NOT emitted —
agntux-core's triage chrome covers those.

```yaml
suggested_actions:
  - label: "Draft a reply"
    host_prompt: "/agntux-slack open the reply composer for action {id}"
  - label: "Schedule a reply"
    host_prompt: "/agntux-slack open the reply composer in schedule mode for action {id}"
  # Include the next row ONLY IF slack_open_url is non-null. Drop both
  # lines if null.
  - label: "Open in Slack"
    url: "{slack_open_url}"
  # Include the next row ONLY for thread-summary-worthy items.
  - label: "Summarise to canvas"
    host_prompt: "/agntux-slack open the canvas summariser for action {id}"
```

The host's tool selector matches each `host_prompt` against the target
view tool's `description` (which carries the trigger phrases inline).
The Draft button also accepts the alternative phrasing `/agntux-slack
draft a reply for action {id}` and the Schedule button accepts
`/agntux-slack draft a reply and schedule it for action {id}` — the
view tool's description matches either form.

The canvas summariser additionally matches `/agntux-slack summarise the
thread for action {id}`.

**Prefix history.** Prior to agntux-slack 8.2.0 these prompts used the
legacy `"ux: Use the agntux-slack plugin to …"` shape (P3 §9.1
host-protocol prefix). The bare slash-command form
(`"/agntux-slack …"`, 4.0.0+ schema) is the going-forward shape;
the view-tool `description` still recognises the legacy form for
backwards compatibility with action items written before the
migration.

## ## Why this matters — citing both parent and reply ts

For Slack threads, `## Why this matters` MUST cite the parent ts AND the most-recent or most-action-relevant reply ts (`<channel_id>#<parent_ts>` and `<channel_id>#<reply_ts>`) so the reader can see *why* this is action-worthy without re-fetching the thread.

## ## Compose payload — required for every Draft action

Authored at ingest in Step 10 / 10.1 with body content informed by
`user.md`, `data/instructions/agntux-slack.md`, and the related
entities' `## Recent signals`. The compose iframe loads it at click
time via `mcp__agntux-slack__agntux_slack_compose_view` — see that
tool's input schema for the canonical contract.

**YAML quoting reminder.** Any string scalar containing `: ` (colon-
space), a leading `-`, or starting with `{` / `[` MUST be wrapped in
double quotes — otherwise the parser interprets it as a key/value pair,
list item, or flow collection and the resulting payload is unparseable.
Concretely, `personalization_signals` bullets like `Tone: terse — per
user.md` MUST be authored as `"Tone: terse — per user.md"`. The view
tool falls back to a `compose_payload_missing` error envelope when
normalisation drops the field.

```markdown
## Compose payload

​```yaml
drafted_body: |
  {agent-composed reply, ≤4000 chars, informed by Step 10.1 context}
personalization_signals:
  - {≤120 chars; cite which user.md / instructions rule motivated this}
  - {up to 4 bullets total}
thread_context:
  parent_ts: <ts>
  parent_author_real_name: <name>
  parent_excerpt: <≤300 chars>
  last_reply_ts: <ts | null>
  last_reply_author_real_name: <name | null>
  last_reply_excerpt: <≤300 chars | null>
  total_replies: <int>
  participants: [<≤6 names>]
  messages_preview:
    - ts: <ts>
      author: <name>
      body_excerpt: <≤200 chars>
channel:
  id: <Cxxxxx>
  name: <slug>
  is_dm: <bool>
slack_permalink: <url | null>
generated_at: <RFC 3339 of this run>
​```
```

**For cross-source-merged actions** (Step 9 found a sibling open action
to merge into): emit the payload as `## Compose payload (slack)`
rather than `## Compose payload`. The agntux-slack compose view tool
reads either header — same shape, different namespace.
