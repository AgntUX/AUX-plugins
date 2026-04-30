---
type: schema
schema_version: "1.0.0"
generated_at: {{generated_at}}
authored_by: data-architect
---

# AgntUX tenant master contract

This file is the runtime authority for the user's data architecture. The validator hook (`agntux-core/hooks/validate-schema.mjs`) reads `schema.lock.json` (the deterministic digest derived from this directory) on every Write/Edit to `~/agntux/entities/**` and `~/agntux/actions/**` and rejects writes that violate the contract.

**Authority:** the data-architect subagent (in agntux-core) is the only writer. Plugins read this file at run-start; they never edit it. The validator hook reads `schema.lock.json` only.

## Pointers

- Subtypes: see `entities/_index.md` and per-subtype files at `entities/{subtype}.md`.
- Action classes: see `actions/_index.md`.
- Per-plugin contracts: see `contracts/{plugin-slug}.md`.
- Deterministic digest: `schema.lock.json` (regenerated on every architect write).
- Migration warnings: `~/agntux/data/schema-warnings.md` (architect-emitted log of changes that would have needed migration).

## Versioning

`schema_version` is a semver string. Bumps:

- **MAJOR** — backward-incompatible change to required fields or enum values. Triggers the migration runbook (deferred to a future phase; the architect logs a warning to `state/schema-warnings.md` so the gap is visible).
- **MINOR** — additive change (new optional field, new subtype, new action_class). No migration needed.
- **PATCH** — clarifications, alias additions, formatting fixes. No data impact.

Existing entity and action files carry their own `schema_version` in frontmatter; the validator checks it against this contract on every write.

## Editing

To change this contract, run `/ux schema edit` (the architect's Mode C). Don't hand-edit — the lock file checksum will diverge and every entity write will be blocked until the lock is regenerated.
