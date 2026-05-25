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

The ladder is deliberately mirrored from `skills/agntux/reference/onboard.md`
Stage 0 steps 1–2 (cwd / ancestor), plus an additional step 4 that hands
off to `/agntux onboard` instead of duplicating the create-and-pick flow.
Onboarding remains the single owner of the directory-create-tool call
(`agntux_core_create_project_directory`) and host-picker dance.

## Contents

- [Resolution ladder (steps 1–4)](#resolution-ladder)
- [Path canonicalisation rule](#resolution-ladder)
- [Background-mode carve-out](#background-mode-carve-out)
- [Permission-allowlist note](#permission-allowlist-note-host-level-for-reference)

---

## Resolution ladder

Walk these in order. Stop at the first match.

**Path canonicalisation (mandatory).** Once a step matches and yields
a directory path, **immediately resolve it to its absolute form** —
expand `~` to the user's home directory, drop any `./` / `..` /
duplicate-slash segments. Cache the absolute string as
`<agntux project root>` for the rest of the run, and use **that exact
string** in every subsequent `Read` / `Write` / `Edit` / `Glob` /
`Grep` call.

This canonicalisation is load-bearing for the host's permission
allowlist. Hosts (Claude Code, Cursor, Cowork) key their "Allow for
scheduled runs" decision on the **literal path string the tool was
called with**. If one scheduled run reads `~/agntux/data/...` and the
next reads `/Users/<you>/agntux/data/...`, the allowlist treats them
as two distinct prompts and re-asks every time. Always emitting the
absolute form makes one allow click hold across all runs.

1. **`basename(cwd).toLowerCase() === "agntux"`** → use cwd silently.
   No banner, no chatty preamble — this is the expected case for any
   invocation from inside an agntux project. Continue with the user's
   ask. (cwd is already absolute, so no canonicalisation work needed.)

2. **Any ancestor of cwd has `basename().toLowerCase() === "agntux"`**
   → use the nearest such ancestor. Emit one short line, then
   continue (the resolved ancestor is already absolute):

   > Working in the agntux project at `{root}`, found above your current directory.

3. **`~/agntux/` exists and is a directory** → use it, **but resolve
   `~` to the absolute home directory first** (e.g.
   `/Users/<username>/agntux` on macOS, `/home/<username>/agntux` on
   Linux). Emit one short line using the absolute path, then continue:

   > Using your AgntUX project at `/Users/<username>/agntux`.

   Do **not** emit the literal `~/agntux` form in the message or in
   any subsequent tool call — that breaks the host's permission
   allowlist (see "Path canonicalisation" above).

4. **None of the above** → ask once, verbatim:

   > I don't see an AgntUX project yet. Want me to set one up at `~/agntux` now? (yes / no)

   - **yes** → invoke `/agntux onboard` (it owns the full
     create-then-Cowork-request / Glob / picker dance under `onboard.md`
     Stage 0 step 4, plus the migration aid in step 3). Exit Check 0;
     `/agntux onboard` carries the conversation from there.
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

Scheduled-task fires (e.g., `/agntux triage-digest` Daily 13:00,
`/agntux feedback-review` Daily 16:00, ingest plugins firing on their
cadence) run with no user present. If steps 1–3 all fail in that
context, **skip step 4 entirely** — there is no audience for the
question — and exit cleanly with no user-facing message. Per-skill
"scheduled-task fires where the user is not present" handling
(documented in each skill's body) decides whether anything is logged
to stderr.

Interactive direct invocations of background-mode skills (the user
types the slash command themselves) run the full ladder, including
step 4.

## Permission-allowlist note (host-level, for reference)

If the host repeatedly prompts for filesystem access on every
scheduled run despite "Allow for scheduled runs" being clicked, the
two most likely causes are:

1. **Path-string drift across runs.** Different runs hit different
   absolute paths because the `~` expansion was not applied
   consistently. The "Path canonicalisation" rule above fixes this on
   the prompt side — every run now emits the same absolute string, so
   one allow click holds across runs.
2. **Per-run tool-name or glob drift.** The host may key its
   allowlist on the *combination* of tool name + path. If the skill
   uses `Read` once and `Glob` next, both need to be allowlisted.

Users still hitting prompts after 4.0.0 / 6.0.0 ships can paste the
following block into their host's `settings.local.json` (or the
equivalent Claude Code `permissions.allow` array) to grant blanket
read/write/glob/grep access to the resolved AgntUX root, replacing
`<username>` with their actual username:

```json
{
  "permissions": {
    "allow": [
      "Read(/Users/<username>/agntux/**)",
      "Write(/Users/<username>/agntux/**)",
      "Edit(/Users/<username>/agntux/**)",
      "Glob(/Users/<username>/agntux/**)",
      "Grep(/Users/<username>/agntux/**)"
    ]
  }
}
```

The host docs are the source of truth on the allowlist syntax — this
block is just an example. Plugins do not (and cannot) modify the
host's permissions config.
