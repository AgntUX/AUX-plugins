# Test persona fixture

A synthetic AgntUX user profile used by Stage 9.5 of the
`/agntux-build:build` flow to drive analyze-only sync test runs against
a newly-built source plugin's prompts.

## What this is

- A plausible-but-fictional `user.md` shaped like the file
  `agntux-core`'s onboarding flow produces.
- A minimal generic schema seed (`schema/_seed.md`) the test-run
  synthesizer extends with whatever entity subtypes / action classes
  the source plugin advertises in its `marketplace/listing.yaml →
  proposed_schema` block.

## What this is NOT

- **Not copied to disk during the build flow.** The fixture lives in
  this directory and is loaded into the build assistant's conversation
  context only. The user's real `<agntux project root>/user.md` is
  never touched by the build session.
- **Not a substitute for real onboarding.** When the user installs the
  finished plugin and runs `/agntux onboard` from `agntux-core`, that
  produces the real `user.md`. This file is build-tooling state.

## How Stage 9.5 uses it

1. Reads `user.md` into conversation context.
2. Reads `schema/_seed.md` for the generic entity-subtype baseline.
3. Reads the source plugin's `marketplace/listing.yaml` (`tagline`,
   `purpose`, `supported_prompts`, `proposed_schema`) and
   `.claude-plugin/plugin.json` (`recommended_ingest_cadence`).
4. Reads `plugins/agntux-core/skills/agntux/reference/onboard.md` for
   the "Per-plugin onboarding interview" question shape.
5. Synthesizes — by impersonating the persona — a per-plugin
   `data/instructions/{plugin-slug}.md` and
   `data/schema/contracts/{plugin-slug}.md` for the test run.
6. Shows the contributor a one-screen summary with an edit / accept /
   regenerate choice.

Stage 10 then runs the canonical sync prompt against this synthesized
context, calling source MCP read tools but writing nothing to disk.

## Versioning

The fixture is versioned by the agntux-build plugin's own version
(`plugin.json → version`). Stage 9.5 records the consumed version into
the session record as `persona_fixture_version`.

## When to edit this fixture

- The persona is too narrow for a new source domain (e.g., a medical
  plugin needs a caregiver-shaped variant). Add a sibling under
  `fixtures/test-persona-{variant}/` and teach Stage 9.5 to pick the
  right one from the source plugin's listing metadata.
- The schema seed is missing a subtype every plugin needs. Edit
  `schema/_seed.md` and bump agntux-build's MINOR version.

Do NOT bake one real source's quirks into this persona. The persona's
job is to be broad enough that any source plugin's prompts get a fair
test against it.
