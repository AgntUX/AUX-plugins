---
id: 2026-04-28-mango-pricing-tiers
type: action-item
schema_version: "1.0.0"
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
      ux: Use the slack-ingest plugin to draft a reply for action 2026-04-28-mango-pricing-tiers.
  - label: "Schedule a reply"
    host_prompt: |
      ux: Use the slack-ingest plugin to draft a reply and schedule it for action 2026-04-28-mango-pricing-tiers.
  - label: "Open in Slack"
    host_prompt: |
      ux: Use the agntux-core plugin to print the Slack permalink for action 2026-04-28-mango-pricing-tiers.
  - label: "Snooze 24h"
    host_prompt: |
      ux: Use the agntux-core plugin to snooze action item 2026-04-28-mango-pricing-tiers for 24 hours.
---

## Why this matters
[[john-smith]] asked in #proj-mango to draft [[project-mango]] pricing tiers by **Friday 2026-04-29** and to loop in legal for the multi-year template. The thread already has two replies; the user committed to "share a draft tomorrow" but the deadline is the binding date.

## Personalization fit
- Direct @mention from [[john-smith]] in #proj-mango — `priority: high` qualifies under P3 §4.3 (deadline within 7 days, named stakeholder).
- Matches `user.md → ## Always action-worthy` (`@mentions in #proj-* with a deadline`).
