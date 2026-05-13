# `/agntux-teams reshape {team-slug}` — per-team schema reshape one-shot

Lane: a one-shot interview to evolve a team's schema additively (per
P7's additive-only policy — no MAJOR bumps).

## Preflight

1. **Parse `$ARGUMENTS`.** The first token is the `team-slug`. Remainder
   is treated as freeform context (e.g., "we want to track ARR per
   customer").
2. **Verify the user is the team-lead** for this team. Read
   `<root>/.agntux/teams.json.memberships[]` and find the row matching
   `team_slug: <team-slug>`. If `team_role != "team-lead"`, emit
   "Schema reshape requires team-lead role on `{team-slug}`. Ask your
   team lead to run this." and stop.
3. **Verify the team's schema exists.** Read
   `<root>/teams/{team-slug}/data/schema/schema.lock.json`. If absent,
   emit "Team `{team-slug}` hasn't been onboarded yet — run
   `/agntux-teams onboard:team-lead {team-slug}` first." and stop.

## What you can change (additive-only per P7)

- **Add a new entity subtype** — appends to the lock's
  `entity_subtypes[]` and to the team-lead's contract's
  `allowed_subtypes[]`. Existing entity files at the previous schema
  version pass through untouched until the lift pass touches them.
- **Add a new action class** (the team's `reason_class` taxonomy) —
  appends to `action_classes[]`. Existing actions at the previous
  schema version pass through.
- **Add a new field to an existing subtype/action** — marked
  `optional: true` so existing files validate.
- **Mark a field `deprecated: true`** — readers tolerate both during
  transition; the lift pass eventually re-shapes touched files.

## What you CANNOT change (refused — emit guidance, then stop)

- **Remove a required field.** Refuse with: "Removing required fields
  is a breaking change. Mark the field `deprecated: true` instead and
  add the replacement field as `optional: true`. The lift pass will
  re-shape touched files over time."
- **Rename a field.** Refuse with: "Renames are non-additive. Add the
  new name as `optional: true` and mark the old name `deprecated: true`."
- **Narrow a type** (e.g., string → enum). Refuse with: "Type narrowing
  is breaking. Add a new field with the narrower type as
  `optional: true`."
- **Drop a subtype.** Refuse with: "Dropping subtypes is breaking. Mark
  it `deprecated: true` so it stops feeding new lift output but
  existing files still validate."
- **MAJOR version bump** (e.g., 1.x.x → 2.0.0). Refuse outright. P7
  forbids MAJOR bumps. Reshape stays at MINOR and PATCH.

## Interview flow

1. **Read the current schema** (`schema.md` for the human-readable
   shape; `schema.lock.json` for the machine lock; the lock is the
   source of truth for validation).
2. **Read any context the user supplied** in `$ARGUMENTS`.
3. **Ask one short question** to get the proposed change ("What new
   data do you want the team to track?").
4. **Propose the additive change in plain English.** Quote the
   current shape, quote the proposed shape, and ask for explicit
   confirmation ("Apply this change to `{team-slug}`'s schema?").
5. **On `yes` confirmation**:
   - Update `<root>/teams/{team-slug}/data/schema/schema.md` (the
     human-readable file) with the new field/subtype/action class
     described in plain English.
   - Update `<root>/teams/{team-slug}/data/schema/schema.lock.json`:
     - Append to `entity_subtypes[]` / `action_classes[]` if adding.
     - Update the named subtype's field list with the new field
       marked `required: false` (optional).
     - Bump `schema_version` MINOR (e.g., `1.0.0` → `1.1.0`) for
       additions; PATCH (`1.1.0` → `1.1.1`) for clarifications.
     - Update `generated_at` to now.
     - Recompute `checksum` (sha256 of the markdown source files in
       `<root>/teams/{team-slug}/data/schema/`).
   - Append a single audit line to
     `<root>/teams/{team-slug}/data/audit.log`:
     `{ISO-8601} reshape: bumped {old-version} → {new-version}: {one-line summary}`.
6. **On `no` (or anything else)**: emit "No changes made." and stop.

## Hooks

The PreToolUse `validate-team-write-lane` hook lets `agntux-teams`
write to `data/schema/**` (per the lane matrix). The PostToolUse
`maintain-team-index` hook does NOT touch schema files — they're
not entities or actions. Schema integrity is enforced by the
team-scoped `validate-team-schema.mjs` (P7-owned) on the next team
data write.

## Out of scope

- **Personal schema reshape.** That's `/agntux schema edit` (public
  agntux-core).
- **Cross-team schema unification.** Each team has its own lock; there
  is no shared "org-wide team schema". The web-app marketplace audit
  surfaces drift; the user lives with it.
- **Bulk re-write of existing entity/action files.** Reshape only
  changes the lock; existing files re-shape lazily on the next lift
  pass that touches them.
