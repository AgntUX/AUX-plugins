---
name: onboard
description: First-run setup for AgntUX. Creates `<agntux project root>/user.md` (identity, responsibilities, day-to-day, aspirations, goals, preferences, glossary, sources, plugins) via a guided interview, then bootstraps the tenant schema. Use when the user says "onboard me", "set me up", "get started with AgntUX", "first-time setup", "redo onboarding", "start over", or when any other agntux-core skill detects `user.md` is missing.
---

# `/agntux-core:onboard` — first-run interview

Lane: walk the user through onboarding from a clean slate, then chain
into schema bootstrap so the tenant is fully wired before any other
skill runs.

## Pre-checks

This skill is the entry point for users with no profile yet — a
missing `user.md` is the trigger, not a failure. So `/onboard` does
NOT run the full preconditions block. Run only these guards:

1. **Trial banner** — emit per [`_preconditions.md`](../_preconditions.md)
   § A (Trial-status banner). For brand-new users with no license
   cache yet the banner is silent; for returning trial users
   re-onboarding, it must fire.

2. **Project root** — confirm the active project root is exactly
   `<agntux project root>/`. If it isn't, say "AgntUX requires the project to be
   `<agntux project root>/`. Create that folder, select it in your host's project
   picker, then re-invoke me." and stop.

3. **`user.md` already exists?** — if `<agntux project root>/user.md` already
   exists, this is a re-onboarding request. The user must have said
   "redo onboarding" / "start over" / similar to land here, since
   the description-driven dispatch wouldn't pick `/onboard` for an
   already-onboarded user. Confirm intent before destroying their
   profile: "This will rewrite your profile from scratch — proceed?
   Or did you mean `/agntux-core:profile` (edit existing) or
   `/agntux-core:schema` (review the tenant schema)?". Wait for an
   explicit yes before continuing.

## Dispatch

1. Engage the **personalization** subagent in **Mode A** (first-run
   interview). It walks Stages 0–5 (identity, responsibilities,
   day-to-day, aspirations, goals, preferences, glossary, sources,
   AgntUX plugins) and writes `<agntux project root>/user.md` end-to-end.
2. When personalization returns, engage the **data-architect**
   subagent in **Mode A** (schema bootstrap). It reads `user.md`
   and proposes the baseline `<agntux project root>/data/schema/schema.md`,
   per-subtype contracts, and `actions/_index.md`.
3. After the architect completes, tell the user: "You're set up.
   Try `/agntux-core:triage` to see what's hot, or
   `/agntux-core:teach {plugin}` to teach me about a specific
   source."

## Out of scope

Schema review/edit (`/agntux-core:schema`), per-plugin instructions
(`/agntux-core:teach`), profile edits to an existing `user.md`
(`/agntux-core:profile`), retrieval queries (`/agntux-core:triage`
or `/agntux-core:ask`).
