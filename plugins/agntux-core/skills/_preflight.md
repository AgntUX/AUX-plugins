# Schema-drift preflight (shared)

Every entry-point skill except `/agntux-schema` and `/agntux-onboard`
references this block. **This file is not a skill** — leading underscore
keeps it out of the slash-command surface. Each entry-point skill
points here from its body so the nudge logic stays in one place.

`/agntux-schema` is excluded because it acts on these states directly
(running it IS how the user resolves them). `/agntux-onboard` runs its
own walkthrough that handles `.proposed` files end-to-end without a
separate nudge.

---

## What to check

Before doing anything else (and after the trial-status banner from
`_preconditions.md` § A, if both files apply), check:

1. **Pending plugin contracts** — Glob
   `<agntux project root>/data/schema/contracts/*.md.proposed`. If any match, emit
   one informational line:

   > 📐 {N} new plugin{s} awaiting schema review. Run `/agntux-schema review` when convenient.

2. **Queued schema-change requests** — read
   `<agntux project root>/data/schema-requests.md` if it exists. If it has any
   non-blank lines, emit one informational line:

   > 📐 {N} pending schema change request{s}. Run `/agntux-schema edit` when convenient.

The nudges are **informational**. Do NOT block. Continue with the
user's actual ask after emitting them.

If both checks fire, emit both lines (newest at top of response,
followed by a blank line, then the normal output). Order: pending
contracts first, schema-requests second.

## Background-mode carve-out

For scheduled-task fires where no user is present (e.g.,
`/agntux-triage` Daily 08:00 or `/agntux-feedback-review` Daily 16:00),
**skip the preflight entirely**. There's no audience for the nudge,
and writing one would clutter scheduled-task logs. The skill detects
unattended runs the same way it does for `_preconditions.md` checks
(per-skill discipline; see each skill's body for its own
"scheduled-task fires where the user is not present" handling).

For interactive direct invocations of background-mode skills (the
user types the slash command themselves), run the preflight normally.
