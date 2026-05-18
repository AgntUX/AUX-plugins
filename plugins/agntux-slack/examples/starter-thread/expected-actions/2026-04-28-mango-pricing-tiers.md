---
id: 2026-04-28-mango-pricing-tiers
type: action-item
schema_version: "1.1.0"
status: open
priority: high
reason_class: deadline
created_at: 2026-04-28T09:00:00Z
source: slack
source_ref: "C01PROJMANGO#1714300000.000100"
related_entities:
  - people/john-smith
  - topics/project-mango
  - companies/acme
due_by: 2026-04-29
snoozed_until: null
completed_at: null
dismissed_at: null
suggested_actions:
  - label: "Draft a reply"
    host_prompt: |
      /agntux-slack open the reply composer for action 2026-04-28-mango-pricing-tiers
  - label: "Schedule a reply"
    host_prompt: |
      /agntux-slack open the reply composer in schedule mode for action 2026-04-28-mango-pricing-tiers
  - label: "Open in Slack"
    url: "https://oatfi.slack.com/archives/C01PROJMANGO/p1714300000000100"
---

## Why this matters
[[john-smith]] asked in #proj-mango to draft [[project-mango]] pricing tiers by **Friday 2026-04-29** and to loop in legal for the multi-year template. The thread already has two replies; the user committed to "share a draft tomorrow" but the deadline is the binding date.

## Personalization fit
- Direct @mention from [[john-smith]] in #proj-mango — `priority: high` qualifies under P3 §4.3 (deadline within 7 days, named stakeholder).
- Matches `user.md → ## Always action-worthy` (`@mentions in #proj-* with a deadline`).

## Compose payload

```yaml
drafted_body: |
  Sharing a first cut of pricing tiers for Project Mango — see the doc linked in #proj-mango (Phase 1 only; Phase 2 multi-year template still pending legal review).

  Quick summary of the three tiers I'm proposing:
    - Standard — single-year, list price.
    - Growth — single-year, volume discount kicks in at 100 seats.
    - Strategic — multi-year, requires legal review of the template (looping Sarah in separately for that).

  Will iterate on Friday's call. Flag anything missing before then.
personalization_signals:
  - Tone: terse — per user.md → # Preferences ("keep replies under 3 sentences where possible")
  - Direct @mention from John (per # Always action-worthy: @mentions in #proj-* with a deadline)
  - Acknowledge the legal-review constraint John raised (#proj-mango thread, latest reply)
thread_context:
  parent_ts: "1714300000.000100"
  parent_author_real_name: John Smith
  parent_excerpt: "Can you draft the Project Mango pricing tiers by Friday and loop in legal for the multi-year template?"
  last_reply_ts: "1714386500.000300"
  last_reply_author_real_name: John Smith
  last_reply_excerpt: "Heads-up: legal said the multi-year template needs Sarah's review before we share with Acme."
  total_replies: 2
  participants:
    - John Smith
    - Sarah Lee
  messages_preview:
    - ts: "1714300000.000100"
      author: John Smith
      body_excerpt: "Can you draft the Project Mango pricing tiers by Friday and loop in legal for the multi-year template?"
    - ts: "1714300100.000200"
      author: Sarah Lee
      body_excerpt: "I can take the legal-review side once we have a draft."
    - ts: "1714386500.000300"
      author: John Smith
      body_excerpt: "Heads-up: legal said the multi-year template needs Sarah's review before we share with Acme."
channel:
  id: "C01PROJMANGO"
  name: proj-mango
  is_dm: false
slack_permalink: "https://oatfi.slack.com/archives/C01PROJMANGO/p1714300000000100"
generated_at: "2026-04-28T09:00:00Z"
```
