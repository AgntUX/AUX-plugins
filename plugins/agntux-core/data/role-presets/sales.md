---
type: role-preset
role: sales
schema_version: "1.0.0"
---

# Sales role preset

Used by data-architect Mode A (bootstrap) when `user.md → # Identity → Role` matches `sales`, `account executive`, `ae`, `sdr`, `bdr`, `head of sales`, `vp sales`, `cro`, `account manager`.

## Suggested entity subtypes

- `person` — prospects, champions, decision-makers.
- `company` — accounts.
- `deal` — opportunities (distinct from `company` because one company can have multiple deals).
- `account` — alias of `company` if the user prefers `account` over `company` as the canonical name.
- `topic` — pricing, security, integration concerns.

Default if the user accepts: `person`, `company`, `deal`, `topic`.

## Suggested action classes

Standard six PLUS:

- `awaiting-customer` — ball is in their court.
- `awaiting-internal` — blocked on legal, ops, finance.
- `next-step` — explicit next-step the user committed to.
- `closed-lost-recovery` — a lost deal showing signs of life.

## Notes

- Sales sources are Salesforce/HubSpot/Outreach-heavy + email + calendar. Suggest CRM-first.
- Goals tend to be revenue-quota-shaped. `# Goals` should capture quota number + horizon if the user shares it.
- Pipeline review is daily/weekly. Probe for the user's stand-up cadence so the daily-digest scheduled task lines up.
- Glossary often has internal product names + customer-facing names that diverge — capture both.
