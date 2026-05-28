# Stage 0 — identity + Developer Certificate of Origin

This stage runs **once** per AgntUX project root, before stage 1 of the
first `/agntux-build:build` invocation. Skip silently on every
subsequent run unless the DCO version has changed.

## Why this stage exists

Open-source projects need a record that the contributor has the right
to give the work they're contributing. The standard mechanism is the
[Developer Certificate of Origin v1.1](https://developercertificate.org/)
— a short, plain agreement that the contributor wrote (or has the
right to contribute) the code they're submitting. The AgntUX
maintainer's commit ends up with a `Signed-off-by:` trailer carrying
the contributor's name and email; that's what Probot DCO checks on the
public PR.

For technical contributors who type `git commit -s`, the trailer
appears automatically. For knowledge workers contributing via this
flow, we capture the agreement once at the start and embed the
trailer inside every submission the user makes.

## Pre-flight

1. Resolve the AgntUX project root using the same algorithm
   `agntux-core` uses (see
   `AUX-plugins/plugins/agntux-core/skills/_resolve-root.md` and
   `AUX-plugins/canonical/hooks/lib/agntux-root.mjs`'s
   `resolveAgntuxRoot()`):
   1. Read `process.cwd()` — if its basename matches `/agntux/i`, use
      it.
   2. If any ancestor matches `/agntux/i`, use the nearest.
   3. Otherwise there's no agntux project yet — **create it first, then
      request access** (never ask the user to run a terminal command):
      1. **Create `~/agntux`.** Try
         `ToolSearch({query: "select:agntux_core_create_project_directory", max_results: 1})`.
         - Resolves (agntux-core installed) → call it (no arguments) to
           create `~/agntux` (no-op if present); cache the returned
           **absolute path**.
         - Does NOT resolve (agntux-core not installed) → ask the user
           whether to create `~/agntux`. Yes → create it and cache the
           absolute path. No → "Let me know when you're ready." + stop.
      2. **Request access to the now-existing folder.** Resolve
         `ToolSearch({query: "select:mcp__cowork__request_cowork_directory", max_results: 1})`.
         - Resolves → call it with `{path: <absolute path from step 1>}`.
           On approval the host re-points cwd; resume on next turn. On
           decline, tell the user they can select the folder in the
           project picker and re-run, then stop.
         - Does NOT resolve (non-Cowork host) → the folder exists, so
           tell the user "Your AgntUX project is at `{absolute path}` —
           open or select that folder and re-run." then stop.
   4. Last-resort glob `**/agntux` (case-insensitive) below
      `os.homedir()` with depth 4 — only if step 3.1 failed to create
      the directory.
2. Once the root is resolved, expand `~` to absolute home and cache
   the absolute string for every subsequent tool call so the user only
   has to click "Allow for scheduled runs" once.
3. Read `<agntux project root>/.agntux-build/contributor.json`. If it
   exists AND its `dco_text_version` field equals `"1.1"`, skip this
   whole stage silently. Use the stored `name` for personalised voice.

## Capture flow

If the file is missing or stale:

1. Lead with a short plain-language framing — three sentences max:

   > Before we start, AgntUX needs to confirm that the work you're
   > about to make is yours to give. The text below is the standard
   > agreement open-source projects use for this. Read it once — it's
   > short — and confirm you agree.

2. Display the full DCO v1.1 text. Verbatim, not summarised:

   ```
   Developer Certificate of Origin
   Version 1.1

   Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

   Everyone is permitted to copy and distribute verbatim copies of
   this license document, but changing it is not allowed.


   Developer's Certificate of Origin 1.1

   By making a contribution to this project, I certify that:

   (a) The contribution was created in whole or in part by me and I
       have the right to submit it under the open source license
       indicated in the file; or

   (b) The contribution is based upon previous work that, to the best
       of my knowledge, is covered under an appropriate open source
       license and I have the right under that license to submit that
       work with modifications, whether created in whole or in part
       by me, under the same open source license (unless I am
       permitted to submit under a different license), as indicated
       in the file; or

   (c) The contribution was provided directly to me by some other
       person who certified (a), (b) or (c) and I have not modified
       it.

   (d) I understand and agree that this project and the contribution
       are public and that a record of the contribution (including all
       personal information I submit with it, including my sign-off)
       is maintained indefinitely and may be redistributed consistent
       with this project or the open source license(s) involved.
   ```

3. Capture the contributor's **real legal name**:

   > To sign off, I need your real legal name (the one a court would
   > use, not a handle). What should the sign-off use?

   Reject obvious placeholders:
   - `test`, `anonymous`, `dev`, `me`, `user`, `contributor`
   - Single-word names without a space (e.g. `john` alone)
   - Names containing only ASCII punctuation
   - Names < 4 chars

   If rejected, explain *why* in one line and re-ask. Don't lecture.

4. Capture the contributor's email:

   > And the email AgntUX should credit you at?

   Validate as a real email shape (regex: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`).
   If it fails, ask once more.

5. Final confirmation in a single turn:

   > Got it. To confirm:
   >
   > - Name: **{captured-name}**
   > - Email: **{captured-email}**
   > - You agree to the Developer Certificate of Origin v1.1 above.
   >
   > Type **I agree** to confirm, or anything else to revise.

   Accept exactly: `I agree`, `i agree`, `agree`, `yes`, `confirmed`.
   Anything else → loop back to whichever field they want to revise.

## Persist

On confirmation, write
`<agntux project root>/.agntux-build/contributor.json`:

```json
{
  "name": "{captured-name}",
  "email": "{captured-email}",
  "dco_text_version": "1.1",
  "dco_agreed_at": "{current-iso-timestamp}",
  "dco_agreed_via": "agntux-build/0.1.0"
}
```

Stage 11 may later append an optional `socials` block to this same
file with the contributor's public handles + a `credit_consent_at`
timestamp. Stage 0 doesn't write `socials`; if a previous session
already left one, preserve it on re-write (merge rather than
overwrite).

Use `node:fs/promises` `writeFile` with `mode: 0o600` (owner read/
write only). Confirm to the user:

> Saved. We won't ask again unless the agreement changes — that's
> rare. Now let's build something.

## DCO version bumps

If the file exists but `dco_text_version` doesn't match the current
accepted version (currently `"1.1"`), walk the user through the new
clauses ("the agreement was updated — here's what's different — please
re-confirm") and re-capture. Treat this rarely; bump the constant in
this file when the project formally moves to a new DCO revision.

## Why we capture name + email even on update mode

The "fix existing plugin" branch (stage 2b) is also a contribution.
The signature embedding in stage 12 references the same
`contributor.json` regardless of mode. The submission's
`mode: "update"` field disambiguates downstream — the maintainer's
intake script handles both cases identically other than the commit
message body.

## What we never persist

- Passwords, OAuth tokens, anything secret.
- The user's host or environment information beyond what's in
  `contributor.json` above.
- A separate "agreed to terms" flag — the DCO record is the only
  agreement record we keep.

## What to do if the user declines

If the user types anything other than the confirmation phrases at the
final gate, treat it as a revision request, not a refusal. Ask which
field they'd like to revise. If they explicitly decline ("no", "I
don't agree", "stop"), thank them politely:

> No problem — that's a hard requirement, so we'll stop here. If you
> change your mind, just run `/agntux-build:build` again.

Don't write `contributor.json`. Don't try to persuade them. Stop the
flow.

## Team-context detection (P3 / S3.3)

After the DCO capture step completes (or was skipped because
`contributor.json` already exists), check for team context. This
step is **inert for solo users** — when `<agntux project root>/.agntux/
teams.json` is absent, no team_context is recorded and Stage 12 takes
the public submission path (finalize-for-sync) verbatim as today.

1. Read `<agntux project root>/.agntux/teams.json`.
   - If the file is absent → solo path. **Do not write a
     `team_context` field anywhere.** Continue to Stage 1.
   - If the file is present and `memberships` is `[]` (rare; user is
     in zero teams) → solo path. Same as absent.
   - If the file is present and `memberships` is non-empty → team
     path. Continue below.

2. Read the session-scoped state at
   `<agntux project root>/.agntux-build/sessions/{session-id}.json`.
   If `team_context` is already pinned for this session (a previous
   turn made the selection), skip the prompt and use the stored
   selection — never re-ask within the same build session.

3. **Single-team case:** if `memberships.length === 1`, offer the
   single team explicitly and let the user opt out:

   > I see you're on the **{display_name}** team for **{org_slug}**.
   > Should this plugin be published to your team's private
   > marketplace, or to the public AgntUX marketplace?
   >
   > - Type **team** to publish to {display_name}.
   > - Type **public** to submit as an open-source contribution
   >   (the standard email flow).

   Accept exactly: `team`, `t`, `private` → team path. Anything else
   that includes `public`, `p`, `open` → public path. Ambiguous input
   → re-ask once.

4. **Multi-team case:** if `memberships.length > 1`, list the teams
   the user is on and let them pick one or opt out:

   > You're a member of these teams under **{org_slug}**:
   >
   > 1. {team-A display_name} — {team-A team_slug}
   > 2. {team-B display_name} — {team-B team_slug}
   > …
   > 0. Submit publicly (open source)
   >
   > Which is this plugin for? Reply with a number or the team's
   > slug.

   Numbers and slug matches both work. Selection of `0` / `public`
   → public path. Invalid input → re-ask once.

5. **Persist** the selection to the session JSON at
   `<agntux project root>/.agntux-build/sessions/{session-id}.json`:

   - **Public path (solo or opt-out):** do not write `team_context`.
     The session JSON's `team_context` field remains absent — Stage
     12 will read its absence as "take the public submission path".
   - **Team path:** write
     ```json
     {
       "team_context": {
         "team_slug": "{selected-team-slug}",
         "org_slug":  "{org_slug-from-teams.json}",
         "team_display_name": "{selected-team-display-name}",
         "selected_at": "{current-iso-timestamp}"
       }
     }
     ```
     Use `node:fs/promises` `writeFile` with `mode: 0o600`. **Do not
     duplicate this into `.agntux-build/contributor.json`** — the
     contributor file is cross-session (carries the user's DCO
     agreement) and must not gain session-scoped state.

6. **Brief acknowledgement** on the team path:

   > Got it — this build is for the **{team_display_name}** team.
   > When it's ready, I'll submit it to your team's private
   > marketplace instead of the public one. Let's build.

   On the public path, no acknowledgement is needed — the original
   "Now let's build something" line from the DCO save step covers it.

## What this does NOT do

- **Never reads `license_jwt`.** Stage 0's only signal is the
  *structural presence* of `teams.json`. The cryptographic license
  check lives server-side at the publish endpoint (P11). Public
  `agntux-build` remains Apache-2.0 and unconditionally usable.
- **Never writes `teams.json`.** That file is owned by the
  `agntux-teams` plugin and the desktop daemon. `agntux-build`
  is a read-only consumer.
- **Never asks about teams when no `teams.json` exists.** The
  prompt only fires for users who have already onboarded a team via
  `/agntux-teams onboard:*`. Solo users see no new questions.
