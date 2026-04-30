---
type: role-preset
role: default
schema_version: "1.0.0"
---

# Default role preset

Used by data-architect Mode A (bootstrap) when `user.md → # Identity → Role` doesn't match any specific preset (or when the user explicitly skipped role).

## Suggested entity subtypes

- `person` — anyone the user interacts with.
- `company` — organizations.
- `project` — workstreams, initiatives.
- `topic` — themes, products, contracts.

Default if the user accepts all four.

## Suggested action classes

Standard six only:

- `deadline`, `response-needed`, `knowledge-update`, `risk`, `opportunity`, `other`.

## Notes

- Defer to the user — ask what subtypes are missing rather than over-suggesting.
- The default set is intentionally minimal. Adding a subtype is cheap (Mode C); pruning a subtype that has populated entities is harder. Start small.
- Probe `# Day-to-Day` and `# Aspirations` carefully — the answers often suggest 1–2 role-specific subtypes that aren't covered by the four defaults.
