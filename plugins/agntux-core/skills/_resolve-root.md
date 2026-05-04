# Resolve the AgntUX project root (shared)

Every named entry-point skill that the user can directly invoke
references this block via `_preconditions.md` § B Check 0. **This
file is not a skill** — leading underscore keeps it out of the
slash-command surface.

The AgntUX project is any directory named `agntux` (case-insensitive).
The runtime resolver in `canonical/hooks/lib/agntux-root.mjs`
(`resolveAgntuxRoot()`) is the source of truth for hook + MCP
contexts; this file is the equivalent prompt-side ladder for
entry-point skills, so a friendly redirect happens before any read or
write is attempted outside `<agntux project root>/`.

The ladder is deliberately mirrored from `personalization.md` Mode A
Stage 0 steps 1–3, plus an additional step 4 that hands off to
`/agntux-onboard` instead of duplicating the create-and-pick flow.
Onboarding remains the single owner of the interactive `mkdir` and
host-picker dance.

---

## Resolution ladder

Walk these in order. Stop at the first match.

1. **`basename(cwd).toLowerCase() === "agntux"`** → use cwd silently.
   No banner, no chatty preamble — this is the expected case for any
   invocation from inside an agntux project. Continue with the user's
   ask.

2. **Any ancestor of cwd has `basename().toLowerCase() === "agntux"`**
   → use the nearest such ancestor. Emit one short line, then
   continue:

   > Working in the agntux project at `{root}`, found above your current directory.

3. **`~/agntux/` exists and is a directory** → use it. Emit one short
   line, then continue:

   > Using your AgntUX project at `~/agntux`.

4. **None of the above** → ask once, verbatim:

   > I don't see an AgntUX project yet. Want me to set one up at `~/agntux` now? (yes / no)

   - **yes** → invoke `/agntux-onboard` (it owns the full Cowork-request /
     `mkdir` / Glob / picker dance under personalization Mode A
     Stage 0 step 4, plus the migration aid in step 5). Exit Check 0;
     `/agntux-onboard` carries the conversation from there.
   - **no** → reply once and stop the original command cleanly:

     > Okay — let me know when you're ready.

     Do NOT fall back to the old fail-loud refusal copy. Do NOT proceed
     with the original ask.
   - **Anything else / no response** → treat as `no`.

Throughout this prompt and every skill that references it,
`<agntux project root>` (or `<root>`) means whichever directory the
ladder above resolved to. Do not read or write any file outside the
resolved root.

---

## Background-mode carve-out

Scheduled-task fires (e.g., `/agntux-triage` Daily 13:00,
`/agntux-feedback-review` Daily 16:00, ingest plugins firing on their
cadence) run with no user present. If steps 1–3 all fail in that
context, **skip step 4 entirely** — there is no audience for the
question — and exit cleanly with no user-facing message. Per-skill
"scheduled-task fires where the user is not present" handling
(documented in each skill's body) decides whether anything is logged
to stderr.

Interactive direct invocations of background-mode skills (the user
types the slash command themselves) run the full ladder, including
step 4.
