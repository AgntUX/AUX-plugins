---
id: 2026-04-25-acme-renewal-pricing-quote
type: action-item
schema_version: "1.0.0"
status: open
priority: high
reason_class: deadline
created_at: 2026-04-25T00:00:00Z
source: notes
source_ref: "~/agntux/notes/2026-04-25-acme.md"
related_entities:
  - companies/acme-corp
  - people/john-smith-acme
  - topics/q2-renewal-acme
  - topics/project-mango
due_by: 2026-04-29
snoozed_until: null
completed_at: null
dismissed_at: null
suggested_actions:
  - label: "View renewal note"
    host_prompt: |
      ux: Use the notes-ingest plugin to view note ~/agntux/notes/2026-04-25-acme.md.
  - label: "Snooze 24h"
    host_prompt: |
      ux: Use the agntux-core plugin to snooze action item 2026-04-25-acme-renewal-pricing-quote for 24 hours.
---

## Why this matters
[[john-smith-acme]] (CFO at [[acme-corp]]) requested a formal pricing quote by **Friday 2026-04-29**. The [[q2-renewal-acme]] contract expires 2026-05-30 and includes a potential expansion under [[project-mango]]. Missing this deadline risks losing the renewal window.

## Personalization fit
- Customer CFO at top-account ([[acme-corp]]) — `priority: high` qualifies under P3 §4.3's "top-account / direct-manager / VIP relationship" prong (deadline window is 4 days, outside the strict 48-hour deadline rule).
- Direct request from a stakeholder named in user.md `# Identity > Reports to` or top-10 customer list — high signal per user.md preferences.
