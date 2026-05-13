# Stage 12 — submit the plugin

The plugin works. Sync surfaces the right things, the action button
fires real source-side writes. Time to ship.

## Where does this plugin go?

Two destinations exist; Stage 0 already decided which one applies.
Read the session JSON at
`<agntux project root>/.agntux-build/sessions/{session-id}.json`
once at the top of this stage.

- **`team_context` absent (solo / public-submission path):** the
  plugin is destined for the **public** AgntUX marketplace. Continue
  with the artefacts + mailto flow exactly as documented below.
- **`team_context` present (team-publish path, P3 / S3.3):** the
  plugin is destined for the user's **team's private** marketplace.
  After writing `CONTRIBUTING-SIGNATURE.md` and re-zipping (steps 1
  and 2 below — they're identical in both paths because the
  per-zip DCO trailer is the same in both worlds), **jump to the
  "Team-publish branch (P3 / S3.3)" section near the bottom of this
  file instead of building the mailto link.**

The solo path below is byte-identical to releases ≤ 0.1.5.

## Two artefacts to write

### 1. `CONTRIBUTING-SIGNATURE.md` at the plugin root

Read the contributor identity from
`<agntux project root>/.agntux-build/contributor.json`. Compose:

```markdown
---
contributor:
  name: {captured-name}
  email: {captured-email}
dco:
  version: "1.1"
  agreed_at: {dco_agreed_at-iso-timestamp}
  agreed_via: agntux-build/0.1.0
submission:
  plugin_slug: agntux-{slug}
  plugin_version: {final-version-from-stage-10}
  submitted_at: {now-iso-timestamp}
  mode: {create-or-update}
  previous_version: {only-when-mode-is-update}
signed_off_by: "{captured-name} <{captured-email}>"
---

By submitting this contribution, I confirm that I have read and
agree to the Developer Certificate of Origin v1.1
(https://developercertificate.org/), reproduced in full below.

When committing this contribution, AgntUX maintainers MUST include
the following trailer in the commit message:

    Signed-off-by: {captured-name} <{captured-email}>

---

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
    are public and that a record of the contribution (including
    all personal information I submit with it, including my
    sign-off) is maintained indefinitely and may be redistributed
    consistent with this project or the open source license(s)
    involved.
```

Write to `{build-path}/CONTRIBUTING-SIGNATURE.md`.

### 2. The final zip (final version, with the signature)

Re-run `node scripts/build-plugin.mjs agntux-{slug}` so the
signature lands inside the bundled tree, then re-zip into the user's
Downloads folder. Use the **same cross-platform resolution algorithm
documented in `09-zip-and-install.md → Generate the zip`** — Linux
`xdg-user-dir DOWNLOAD` first, then `$HOME/Downloads` /
`%USERPROFILE%\Downloads` if it exists, falling back to `$HOME`.

The final filename:

```
agntux-{slug}-v{final-version}.zip
```

Note: this is a **new zip** — keep the prior iteration zips around in
Downloads so the user has a paper trail of versions. The version-stamped
filename means snapshots accumulate naturally without overwriting. Same
fail-closed rule as stage 11: if the version didn't bump from
`post_iteration_zip_path`'s embedded version, fall back to
`agntux-{slug}-v{final-version}-final.zip` rather than overwriting.

## The mailto link

Generate a `mailto:` URL with the body pre-filled. Use
`mcp__claude_preview__preview_start` with HTML containing the
clickable link, OR print as a markdown link directly.

The body's exact shape (URL-encoded for `mailto:`):

**Create mode:**
```
Subject: New plugin: agntux-{slug} v{version}

Hi AgntUX team,

Submitting agntux-{slug} v{version} (created via agntux-build).

Plugin: agntux-{slug}
What it does: {one-sentence-from-listing-yaml-tagline}
Connector: {connector-display-name}
Sync cadence: {recommended-cadence}
UI handlers ({N}):
  - {ui-handler-1-name} ({verb-phrase-1})
  - {ui-handler-2-name} ({verb-phrase-2})
  - …

Contributor: {captured-name} <{captured-email}>
DCO: agreed to v1.1 on {dco_agreed_at-date}

Signed-off-by: {captured-name} <{captured-email}>

--
Generated by agntux-build/{plugin-version}
```

(For read-only sources with no UI handlers, replace the
`UI handlers (N):` block with `UI handlers: none — read-only
source, "Open in {connector}" only.`)

**Update mode:**
```
Subject: Update: agntux-{slug} v{new-version}

Hi AgntUX team,

Submitting a fix for agntux-{slug} (now v{new-version}, was v{old-version}).

Reported issue: {paraphrased-issue-summary-from-update-mode}
Fix: {one-sentence-summary-of-the-change}

Contributor: {captured-name} <{captured-email}>
DCO: agreed to v1.1 on {dco_agreed_at-date}

Signed-off-by: {captured-name} <{captured-email}>

--
Generated by agntux-build/{plugin-version}
```

Recipient: `plugins@agntux.ai`. Build the URL:

```
mailto:plugins@agntux.ai?subject={url-encoded-subject}&body={url-encoded-body}
```

## Drop the zip + email body into chat as cards (Cowork)

Before printing the prose handoff, try to render the artefacts as
inline cards so the user can see the zip download and grab the email
body without leaving the chat. Write the email body to a file the host
can present — **outside the build tree** so it never ends up inside
the submission zip:

1. Write the rendered email body (subject + body, plain text) to
   `<agntux project root>/.agntux-build/sessions/{session-id}/SUBMISSION-EMAIL.txt`.
   The same body that goes into the `mailto:` URL, unencoded. Keep
   it readable — it's the fallback if the user's `mailto:` handler
   is misconfigured. **Never write this file under `{build-path}`**;
   that tree gets zipped, and the email body must not travel with
   the plugin.
2. Resolve the tool:
   `ToolSearch({query: "select:mcp__cowork__present_files", max_results: 1})`.
3. On resolve, call:
   ```
   mcp__cowork__present_files({files: [
     {file_path: "{absolute-zip-path}"},
     {file_path: "<agntux project root>/.agntux-build/sessions/{session-id}/SUBMISSION-EMAIL.txt"}
   ]})
   ```
4. On no resolve, skip silently — the prose below carries the path
   and the mailto link. **Don't narrate the failed lookup.**

The cards don't replace the drag-and-drop step — chat cards can't be
dragged into a third-party mail client window — so the absolute zip
path stays in the prose either way. The cards are supplementary:
visual confirmation, a one-click download of the email body if the
`mailto:` link fires into a browser tab they can't easily edit.

## What you tell the user

> {Name}, your plugin is packaged and ready.
>
> Final zip: **{absolute-zip-path}**
>
> Two steps to send it:
>
> 1. **Click this link** to open a new email — subject and body
>    are filled in for you:
>    {mailto-link}
> 2. **Drag the zip from {zip-path} into the email window** to
>    attach it, then click Send.
>
> That's it.

## The closing

Once the user confirms they sent the email:

> Thank you, {captured-name}. **`agntux-{slug}` will help every
> other AgntUX user who needs to bring {connector-display-name}
> into AgntUX.** That's the whole point of doing this — and you
> just did it.
>
> The team will review the submission and post back at
> {captured-email} with any questions. The plugin should be in
> the public marketplace within a week if everything checks out.

In update mode, change the closing:

> Thank you, {captured-name}. The fix is on its way to the team.
> `agntux-{slug}` will be a better plugin for the people already
> using it because of this — that's the whole point of doing this
> in the open.

## Saved state at end of stage 12

```json
{
  ...,
  "submission": {
    "final_version": "0.1.0",
    "zip_path": "/Users/.../Downloads/agntux-linear-v0.1.0.zip",
    "signature_path": "/Users/.../agntux-linear/CONTRIBUTING-SIGNATURE.md",
    "mailto_link": "mailto:plugins@agntux.ai?...",
    "mode": "create",
    "submitted_at": "2026-05-08T..."
  },
  "session_status": "complete"
}
```

## What you do NOT do

- Don't try to attach the zip programmatically. The Gmail MCP
  schema explicitly says draft creation with attachments isn't
  supported, and we can't assume the user has Gmail MCP connected
  anyway. The drag-and-drop is unavoidable and fine.
- Don't include the contributor's email body verbatim — the body
  is generated by you, with the contributor's identity merged in.
- Don't write `CONTRIBUTING-SIGNATURE.md` outside the build tree
  (e.g., at the contributor's project root) — it travels with the
  plugin's zip, not with the user's local data.
- Don't skip the closing thank-you. The whole flow has been
  building toward this moment.
- Don't enumerate the files in the zip, the specialists that ran,
  the schema keys, or anything mechanical. The closing message is
  for a non-technical contributor — high-level only. The session
  file at `<agntux project root>/.agntux-build/sessions/{id}.json`
  has all the detail; that's where it belongs.

## Team-publish branch (P3 / S3.3)

Run this branch instead of the mailto flow above **only when** the
session JSON's `team_context` field is present. The two artefacts
already exist on disk at this point — `CONTRIBUTING-SIGNATURE.md`
inside the rebuilt plugin tree, and the final
`agntux-{slug}-v{version}.zip` in Downloads. They are produced
identically in both branches; the team-publish branch never mutates
either.

### 1. Call the publish tool

Invoke the new MCP tool `agntux_build_publish_to_team` shipped by
this plugin's MCP server (see `mcp-server/`). Inputs:

```json
{
  "team_slug":        "{team_context.team_slug}",
  "org_slug":         "{team_context.org_slug}",
  "plugin_slug":      "agntux-{slug}",
  "plugin_version":   "{final-version-from-stage-10}",
  "tarball_path":     "{absolute-zip-path}",
  "plugin_dir":       "{build-path}",
  "agntux_root":      "{agntux project root, absolute}",
  "contributor": {
    "name":  "{captured-name from contributor.json}",
    "email": "{captured-email from contributor.json}"
  },
  "dco_text_version": "1.1"
}
```

The tool walks `plugin_dir`, builds a base64 manifest of every file
under the plugin tree (skipping `node_modules/`, `dist/`, `.git/`,
`.omc/`), reads the license JWT from
`<agntux_root>/.agntux/teams.json`, and POSTs the manifest to the
backend at
`https://app.agntux.ai/api/teams/{org_slug}/marketplace/publish`
with the license JWT in the `Authorization: Bearer` header. The
backend verifies the JWT, validates the DCO trailer in
`CONTRIBUTING-SIGNATURE.md`, commits the tree under
`plugins/agntux-{slug}/` in the org's private marketplace repo, and
writes an audit row.

### 2. Branch on the tool result

The tool returns one of:

```json
{ "ok": true,  "submitted_at": "...", "plugin_slug": "...",
  "plugin_version": "...", "team_slug": "..." }
```

```json
{ "ok": false, "reason": "auth" | "validation" | "conflict" | "network",
  "error": "..." }
```

### 3a. On success — surface non-technical confirmation

**Do NOT print the GitHub commit URL.** The team's private
marketplace lives in an AgntUX-owned GitHub org that team members
have no access to, per P1's auth model. Surface this message
instead:

> {Name}, your plugin has been submitted to your team's private
> marketplace.
>
> - Plugin: **agntux-{slug}** v{plugin_version}
> - Team: **{team_context.team_display_name}**
> - Submitted: {submitted_at}
>
> Your organization admin needs to enable **agntux-{slug}** in
> Claude Desktop's organization plugin settings before team members
> can install it. Team members can then add it from their plugin
> browser.

In update mode, change the wording slightly:

> {Name}, the fix has been submitted to your team's private
> marketplace as **agntux-{slug}** v{plugin_version}. Your team
> members will pick up the new version on their next plugin update.

### 3b. On failure — non-technical-friendly fallback copy

Map the `reason` field to user-facing copy. **Do not surface the
raw `error` string** — it's for the session JSON.

- `reason: "auth"`:
  > Your team's subscription or sign-in needs attention before we
  > can submit on behalf of your team. Open the AgntUX desktop app
  > and ask your admin to check billing. If you'd like to publish
  > this as an open-source contribution instead, run
  > `/agntux-build:build` again and pick "Submit publicly" at the
  > team-selection step.

- `reason: "validation"`:
  > Something in the packaged plugin didn't pass the team-publish
  > checks (the most common cause: the DCO signature didn't match
  > the contributor name on file). I can re-run from Stage 11 to
  > rebuild — type **retry** when you're ready, or **public** to
  > switch to the open-source submission flow.

- `reason: "conflict"`:
  > Your team's marketplace is in a state that needs admin
  > attention (often: the team was just archived). Reach out to
  > your team-lead and re-run this build once it's resolved.

- `reason: "network"`:
  > I couldn't reach the AgntUX backend just now. The plugin zip
  > is still saved at **{absolute-zip-path}**, so nothing is lost
  > — re-run `/agntux-build:build` once you're back online and
  > we'll pick up where we left off.

In every failure case, **do not write `submission` to the session
JSON**. The next build session must be free to retry from a clean
state.

### 4. Persist session result

On `ok: true`, append to
`<agntux project root>/.agntux-build/sessions/{session-id}.json`:

```json
{
  ...,
  "submission": {
    "publish_target":  "team-private",
    "team_slug":       "{team_context.team_slug}",
    "org_slug":        "{team_context.org_slug}",
    "plugin_slug":     "agntux-{slug}",
    "plugin_version":  "{final-version-from-stage-10}",
    "submitted_at":    "{submitted_at-from-tool-result}",
    "zip_path":        "{absolute-zip-path}",
    "signature_path":  "{plugin-tree}/CONTRIBUTING-SIGNATURE.md"
  },
  "session_status": "complete"
}
```

**Do NOT include any commit URL, repo name, GitHub owner, or SHA**
in the session JSON. Those values exist only in the team's
marketplace repo and the org's `teams_marketplace_audit` table —
not in the contributor's local data.

### What this branch does NOT do

- **Does not open `mailto:`.** The team-publish branch and the
  public-submission branch are mutually exclusive.
- **Does not retry on failure.** The build skill body surfaces
  the failure copy and exits. The user re-runs the whole flow if
  they want to try again.
- **Does not read `license_jwt` itself.** The MCP tool reads it
  from `teams.json`; the skill body never touches the JWT.
- **Does not bypass the DCO signature.** Steps 1 and 2 above
  (`CONTRIBUTING-SIGNATURE.md` + re-zip) run identically in both
  branches. The backend re-validates the DCO trailer server-side.

## Why this is enough for v1

- **Auditable**: every submission has a per-zip signature with
  what version of the DCO was agreed to, when, and by whom.
- **Maintainer-side enforcement**: the intake script can refuse
  zips without `CONTRIBUTING-SIGNATURE.md` or with stale DCO
  versions.
- **Probot-DCO-compatible**: when the maintainer commits, the
  resulting commit's `Signed-off-by:` trailer (from the signature
  file) passes Probot's check on the public PR.
- **No new infra**: no submit backend, no auth layer, no database.
  v1 ships email + zip + frontmatter. The strategy doc's v2
  (`submit.agntux.ai`) can read the same frontmatter and lift
  the agreement into a database when that ships.
