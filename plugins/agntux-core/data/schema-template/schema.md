---
type: schema
schema_version: "1.1.0"
generated_at: {{generated_at}}
authored_by: data-architect
---

# AgntUX tenant master contract

This file is the runtime authority for the user's data architecture. The validator hook (`agntux-core/hooks/validate-schema.mjs`) reads `schema.lock.json` (the deterministic digest derived from this directory) on every Write/Edit to `<agntux project root>/entities/**` and `<agntux project root>/actions/**` and rejects writes that violate the contract.

**Authority:** the data-architect subagent (in agntux-core) is the only writer. Plugins read this file at run-start; they never edit it. The validator hook reads `schema.lock.json` only.

## Pointers

- Subtypes: see `entities/_index.md` and per-subtype files at `entities/{subtype}.md`.
- Action classes: see `actions/_index.md`.
- Per-plugin contracts: see `contracts/{plugin-slug}.md`.
- Deterministic digest: `schema.lock.json` (regenerated on every architect write).
- Migration warnings: `<agntux project root>/data/schema-warnings.md` (architect-emitted log of changes that would have needed migration).

## Versioning — additive-only policy

`schema_version` is a semver string. Bumps follow the **additive-only**
policy ratified in P7 (`~/.claude/plans/pls-study-the-below-eager-prism.md`):

- **MINOR** — additive change (new optional field, new subtype, new
  action_class, **promoting a previously-optional field to required so
  long as legacy files self-heal via the runbook loop**). The validator
  emits a runbook on forward-drift and the next write to an affected
  file picks up the new shape; no one-shot migration job exists. This is
  the only path schemas evolve along in production.
- **PATCH** — clarifications, alias additions, formatting fixes. No
  data impact.
- **MAJOR** — **forbidden by policy.** The on-disk corpus is never
  rewritten in bulk; users never have to manually manage schemas.
  Breaking proposals are rewritten as additive deprecations by the
  schema-editing flow (mark the old field `deprecated: true`, add a
  new field, leave consumers tolerating both during the transition).

Existing entity and action files carry their own `schema_version` in
frontmatter; the validator checks it against this contract on every
write, semver-aware:

- PATCH drift either direction → pass silently.
- MINOR drift, file ahead of contract → reject + emit the bump
  runbook so the agent advances the contract + lock to match.
- MINOR drift, contract ahead of file → pass silently (legacy files
  predate the bump; the next touch reshapes them additively).

## P7 required fields (schema_version 1.1.0)

The `1.1.0` MINOR bump promotes three frontmatter fields to required on
every entity file (`<root>/entities/{subtype}/*.md` and every
`<root>/teams/{slug}/entities/{subtype}/*.md`):

- `entity_id` — deterministic 16-hex-char identifier derived by the
  validator hook from `source` + `source_ref`. **The LLM never computes
  this** — the hook emits the correct value in its rejection runbook
  when the field is missing or incorrect.
- `source` — slug of the writing connector (e.g. `agntux-slack`,
  `agntux-gmail`, `agntux-core` for onboarding entities).
- `source_ref` — stable natural key chosen by the source connector
  (Slack `workspace:user_id`, Gmail `thread_id`, kebab-cased
  identifier for onboarding entities).

Action files (`<root>/actions/{date}-{slug}.md`) gain one required
field:

- `entity_refs` — array of `entity_id` values for the entities this
  action concerns. Supersedes the freeform `related_entities[]` array
  for cross-namespace joins; both fields are required so personal-side
  triage and team-scoped views can join on a stable identifier.

The derivation rule for `entity_id` lives at
`canonical/hooks/lib/entity-id.mjs`:

```
entity_id = sha256(source + ":" + source_ref).slice(0, 16)
```

## Editing

To change this contract, run `/agntux schema edit` (the architect's Mode C). Don't hand-edit — the lock file checksum will diverge and every entity write will be blocked until the lock is regenerated.
