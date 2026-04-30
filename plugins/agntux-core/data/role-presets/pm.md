---
type: role-preset
role: pm
schema_version: "1.0.0"
---

# PM role preset

Used by data-architect Mode A (bootstrap) when `user.md → # Identity → Role` matches `pm`, `product manager`, `product`, `head of product`, `vp product`, `cpo`.

## Suggested entity subtypes

- `person` — colleagues, customers, candidates.
- `team` — engineering pods, GTM teams, customer cohorts the user works with.
- `company` — customers, partners, competitors.
- `product` — the user's own product line (or a SKU within it).
- `feature` — discrete features under a product.
- `release` — versioned milestones.
- `customer` — alias of `company` if the user pushes back on having both.
- `topic` — themes, contracts, research areas.

Default if the user accepts: `person`, `team`, `company`, `product`, `feature`, `release`, `topic`.

## Suggested action classes

Standard six (`deadline`, `response-needed`, `knowledge-update`, `risk`, `opportunity`, `other`) PLUS:

- `customer-feedback` — research signal worth funneling into discovery.
- `release-blocker` — anything that could push out a milestone.

## Notes

- PMs typically have fragmented sources (Slack, email, Linear/Jira, Notion, customer calls). Suggest 4–6 sources.
- Goals tend to be quarterly (OKR-cadence). Probe for active OKRs in the personalization interview so they show up in `# Goals`.
- Glossary is heavy — codenames, internal acronyms, customer-facing names. PMs benefit a lot from `# Glossary` upkeep.
