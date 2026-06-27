# Stage 12 — submit the plugin

The plugin works. Sync surfaces the right things. Time to ship it to
the AgntUX maintainers, who will deploy it to the remote MCP server.

> **Before finalizing:** By submitting you confirm that your plugin will be
> published publicly under the Apache License 2.0, you have not included secrets
> or other people's personal data, and submission is governed by the
> [Marketplace Contributor Terms](https://agntux.ai/terms) and
> [Privacy Policy](https://agntux.ai/privacy). AgntUX does not publish your email
> (none is collected); a name appears in `CONTRIBUTING-SIGNATURE.md` only if you
> chose to provide one — otherwise the record is anonymous.

Source plugins are remote-view-only — they have no local MCP server,
and local install in Claude Cowork is broken for the view-tool path.
The plugin's first real run is on the remote MCP server after the
AgntUX team deploys it.

The handoff no longer goes by email, and there is no file for the user
to download or attach. The built plugin files already live under
`<agntux project root>/`, which the AgntUX desktop app syncs to the
team automatically. Submitting is therefore three moves: write the
contributor's signature into the plugin tree, make sure the tree sits
in the synced location, then drop a small finalization marker the
desktop app picks up and forwards. Nothing for the user to send.

Two things must be true before you claim success: the finalized tree is
in the synced location (steps a–b), and the AgntUX desktop app is
running and signed in (step e, the hard requirement). If the desktop
app isn't active, do **not** tell the user the plugin was submitted.

## Artefact — `CONTRIBUTING-SIGNATURE.md` at the plugin root

Read the contributor identity from
`<agntux project root>/.agntux-build/contributor.json`. The signature
file is the DCO record only — **do not include the `socials` block in
the signature**. The signature ends up on a public-facing PR; the
social handles are credit metadata that lives in the
`SUBMISSION.json` marker instead (step d) and never lands in a commit
message or PR body.

Compose:

```markdown
---
contributor:
  name: {captured-name — omit this line entirely when the contributor stayed anonymous}
dco:
  version: "1.1"
  agreed_at: {dco_agreed_at-iso-timestamp}
  agreed_via: agntux-build/{plugin-version}
submission:
  plugin_slug: agntux-{slug}
  plugin_version: {final-version-from-stage-10}
  submitted_at: {now-iso-timestamp}
  mode: {create-or-update}
  previous_version: {only-when-mode-is-update}
---

By submitting this contribution, I confirm that I have read and
agree to the Developer Certificate of Origin v1.1
(https://developercertificate.org/), reproduced in full below.

This contribution is made under the Apache License 2.0. AgntUX does not
collect or publish a contributor email; when AgntUX maintainers commit
this contribution they sign off with the project's own identity
(`Signed-off-by: AgntUX <noreply@agntux.ai>`), which satisfies the DCO
check on the public PR.

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

Write to `{build-path}/CONTRIBUTING-SIGNATURE.md` (the plugin root).
This file now rides to S3 with the rest of the tree as the DCO consent
record (the agreed DCO version + when, plus the contributor's name only
when they opted into credit). When a maintainer merges the contribution
they sign off the commit with the project's own identity
(`Signed-off-by: AgntUX <noreply@agntux.ai>`) so Probot DCO passes on
the public PR — no contributor email is ever required or published.

## a. Resolve the synced submission path

The submission tree lives at:

```
<agntux project root>/.agntux-build/builds/{session-id}/agntux-{slug}/
```

Resolve `<agntux project root>` exactly as SKILL.md stage 0 does (read
`process.cwd()`, walk up for an ancestor named `agntux`, fall back as
documented there). `{session-id}` is the session timestamp
(`YYYY-MM-DD-HHmmss`); `{slug}` is the connector slug. The marker
(step d) is written one level up — a sibling of the `agntux-{slug}/`
dir.

## b. Ensure the tree is in the synced location

The build location varies. When a marketplace clone exists, the build
may have run there; only the synced
`<agntux project root>/.agntux-build/builds/{session-id}/…` path
reaches S3. So:

- **Already under the agntux project root** (the normal end-user case)
  → no-op.
- **Ran in a marketplace clone** (the finalized tree is not under
  `<agntux project root>/`) → copy the finalized tree into the synced
  path above, applying the exclude list below.

**Exclude list** — never copy these into the synced tree, even if they
exist on disk:

- `node_modules/`
- `mcp-server/` — remote-view-only plugins ship none. The build
  already rejected in stage 7 if present.
- `hooks/` — same.
- `.mcp.json` — same.
- `.omc/`, `.git/`, `.DS_Store`
- `host-renderer/`, `test-harness/`, `agents/` — agntux-build's own
  internals, never copied into a generated plugin.

Ship everything else the finalized tree contains, **including `NOTICE`
when the plugin has one** (most do; agntux-slack/gmail are the exception —
they carry their Apache-2.0 attribution in `LICENSE` alone and simply have
no `NOTICE` to copy). This exclude list mirrors the one
`agntux_write_submission` applies internally when it enumerates and hashes the
tree — the tool is the authoritative implementation, so this copy step only has
to get the same files *into* the synced location.

Keep `CONTRIBUTING-SIGNATURE.md` — it belongs in the synced tree.

After this copy the finalized, signature-carrying tree is under
`<agntux project root>/.agntux-build/builds/{session-id}/agntux-{slug}/`.

> **This copy is only for a marketplace-clone build.** In the normal contributor
> case the build already ran in the synced location, so there is nothing to copy.
> When a clone build *does* need copying, copy BEFORE calling
> `agntux_write_submission` — the tool's first act is to re-validate the synced
> plugin dir, which rebuilds `dist/` in place, so the validated+hashed bytes are
> produced there regardless of where the pre-build happened. See §b.5.

## b.5. The submit gate — `agntux_write_submission` re-validates internally

This is the **gate**, and it lives **inside** the `agntux_write_submission` MCP
tool (step c). There is no separate, agent-written `validation-receipt.json` to
trust — and therefore none to forge (the round-1 failure: a hand-typed green
receipt sailed a broken plugin past the gate because the toolchain wasn't present
to run for real). `agntux_write_submission` **re-runs validation internally**
against the **exact tree being submitted** and **refuses to write
`SUBMISSION.json` on any failure** — no verdict the caller passes in is trusted,
and the tool writes NOTHING when validation fails.

The validation it runs builds → lints → typechecks → tests → `claude plugin
validate` → renders (best-effort) the synced plugin dir **in place** (vite writes
`dist/` into the tree; the import gate may re-route an apps-hook import). The
bytes it validates are byte-for-byte the bytes it then hashes into `tree_sha256`
— there is nothing to keep "in sync" and no trusted receipt. The tool runs
**natively in the host process** (full filesystem, real Chromium), so it works in
a contributor sandbox with **no marketplace clone** — unlike the restricted Bash
sandbox, where the toolchain can't run (it EPERMs on the native host build path).
Do NOT attempt to run the validator — **or any deterministic build step** —
yourself via Bash; call the tool. The same rule covers the whole toolchain:
`agntux_scaffold` lays the marketplace-asset floor, and `agntux_validate` runs
render-skill, the view-tool build, lint, typecheck, tests, and `claude plugin
validate` — all natively. Never run `scaffold-marketplace-assets.mjs`,
`render-skill.mjs`, `build-plugin.mjs`, `npm run build`, vite, or the validator
via Bash; the MCP tools own all of it.

**Ordering** (why the validated bytes == the submitted bytes):

1. Write `CONTRIBUTING-SIGNATURE.md` into the plugin dir (the Artefact step) — so
   the signed tree is what gets validated and hashed.
2. Ensure the plugin dir is the synced tree (§b). For the normal contributor case
   the build already ran there (the sandbox *is* the synced location), so this is
   a no-op; only a marketplace-clone build needs the copy, and it copies BEFORE
   calling `agntux_write_submission` (the tool rebuilds in place anyway).
3. Call `agntux_write_submission` (step c). It re-validates the synced plugin dir
   (which rebuilds dist + may re-route an import), THEN walks + hashes the
   post-validation tree → `tree_sha256` over the exact validated bytes, THEN
   writes the marker. It is the ONLY writer of `SUBMISSION.json`.

It MUST return `ok:true`. If it returns `ok:false`, the tree is not submittable —
the failure is **mechanical** (see `self-validation.md`); read the returned
`failed_stage`/`routing` and route it back to the owning specialist per the
stage-7 re-dispatch table in `07-build.md` (a `failed_stage: "usage"` /
`error_kind: "usage"` means an operator/environment error — fix the call, don't
re-dispatch a specialist; a `blocking:false` verdict means an environment limit —
stop honestly, no specialist re-dispatch), fix, and re-call the tool. Validation
runs **once per submit attempt, never twice within one.**

## c. Write the marker — call `agntux_write_submission`, don't hand-author

> **NEVER hand-author `SUBMISSION.json` or `validation-receipt.json`. The ONLY
> writer is the `agntux_write_submission` tool.** If the tool is not callable,
> STOP and report an agntux-build defect — do **not** improvise a marker, a
> receipt, or a hand-typed "summary". (A hand-written marker is exactly the
> forgery path this design closes: the marker is a precise machine wire-shape;
> the desktop daemon validates `schema_version`, `kind`, and `status` and
> **silently skips** — logs a `warn`, never POSTs — any marker missing them, or
> any marker placed *inside* the `agntux-{slug}/` dir instead of as its sibling,
> so a hand-written summary with the wrong keys never reaches the queue while the
> contributor is told "submitted" when nothing was.)

`agntux_write_submission` is the one step you must not improvise. It
**re-validates the submitted tree internally** (build + lint + typecheck + tests
+ structural validate + best-effort render — no caller verdict is trusted) and
**refuses to write a marker on any failure**, then enumerates the post-validation
tree, computes every sha256, derives `tree_sha256`, assembles the full marker
(the wire-shape documented in §d — `schema_version`, `kind`,
`kind: "agntux-build.submission"`, `status: "final"`, the file manifest, etc.),
self-checks it against the daemon's gates, and writes it atomically to the session
root as a **sibling of** the plugin dir. The tool does the self-check; you do not
transcribe its output into a marker by hand.

Call it with the resolved args:

```
agntux_write_submission({
  slug:             "agntux-{slug}",        // the connector slug, agntux-prefixed
  session:          "{session-id}",         // YYYY-MM-DD-HHmmss (the session timestamp)
  agntux_root:      "<agntux project root>",// the stage-0 resolver result (absolute)
  plugin_version:   "{final-version}",      // stage 10 / the plugin's own plugin.json
  mode:             "create",               // "create" | "update"
  previous_version: "{prev}",               // ONLY when mode === "update", else omit
  revision_of:      "{submission_id}"       // ONLY when :revise (revise.md step 3), else omit
})
```

Branch on the result:

- **`ok:true`** → the tool validated, hashed, and wrote the marker. Its return
  carries `{ submission_id, tree_sha256, files, marker_path, validation }`.
  Record the returned `submission_id` into `last-submission.json` per
  `07-build.md` (its `submission_id` field — that exact key), then proceed to the
  hard-require-sync gate (§e) and confirm (§e·confirm). `tree_sha256` is the
  dedup key; its first 8 hex chars are the `submission_id` suffix.
- **`ok:false`** → the tool re-validated and **wrote nothing**. The return
  carries `{ failed_stage, routing, blocking, error_kind, detail, verdict }`
  (the per-stage detail is in `verdict.stages`). The failure is
  **mechanical** (see `self-validation.md`): read `failed_stage`/`routing` and
  re-dispatch the owning specialist per the stage-7 re-dispatch TABLE in
  `07-build.md`, fix, and **re-call `agntux_write_submission`** — do NOT
  hand-write a marker to "get past" the failure. A `blocking:false` /
  `error_kind` of `"environment"` means an environment limit (honest stop, no
  specialist re-dispatch); a `failed_stage: "usage"` means an operator error in
  the call (fix the args, don't burn a specialist cycle).

If `agntux_write_submission` is not available as a callable tool at all, STOP:
that is an agntux-build defect (the MCP server didn't start). Log it for the
maintainer (saved session + the one-line "hit a snag" message) and do **not**
fall back to writing a marker yourself.

## d. Marker shape — field reference (emitted by the tool, NOT authored by hand)

`agntux_write_submission` (step c) already wrote the marker — atomically (temp +
`rename`, so the desktop watcher's `awaitWriteFinish` never reads a
half-written file), at the session root
(`<agntux project root>/.agntux-build/builds/{session-id}/SUBMISSION.json`, a
**sibling of** the `agntux-{slug}/` dir so the plugin tree stays pristine).
This section documents the shape the **tool emits**, purely so you can
sanity-read the result — **you do not author it by hand.** Before it writes, the
tool self-checks the in-memory marker against the exact gates the daemon + server
schema apply (a marker that would be skipped or 400-rejected is never left on
disk — it would surface as `failed self-check` and the tool refuses to write,
so the flow can't claim "submitted"). The required wire-shape literals the daemon
validates are `schema_version`, `kind: "agntux-build.submission"`, and
`status: "final"`. The emitted JSON is:

```json
{
  "schema_version": "1.1.0",
  "kind": "agntux-build.submission",
  "status": "final",
  "submission_id": "agntux-{slug}@{version}+{tree_sha256[:8]}",
  "revision_of": "{only on :revise — the prior submission_id this chains to}",
  "plugin_slug": "agntux-{slug}",
  "plugin_version": "{final-version}",
  "mode": "create | update",
  "previous_version": "{only when mode=update}",
  "session_id": "{YYYY-MM-DD-HHmmss}",
  "build_root": "agntux-{slug}",
  "agntux_build_version": "{agntux-build plugin.json version}",
  "contributor": {
    // `name` appears ONLY when the contributor chose to provide one for
    // credit; it is absent for an anonymous submission. No `email` is
    // ever collected or emitted.
    "name": "...",
    "socials": {
      // Only the handle keys the contributor actually filled in
      // appear here — never emit `"x": ""` placeholders for skipped
      // fields. LinkedIn is stored as a full URL; the other three
      // (x / instagram / reddit) are stored as bare handles. The
      // `socials` block as a whole is absent when stage 11 was
      // skipped — never write `"socials": null` or `{}`.
      "x": "jane",
      "linkedin": "https://www.linkedin.com/in/jane/",
      "credit_consent_at": "{iso timestamp from stage 11}"
    }
  },
  "dco": { "version": "1.1", "agreed_at": "{iso}", "signed_off_by": "{the name, when one was provided for credit; the key is omitted otherwise — never an email}" },
  "validation": { "build": "pass", "lint": "pass", "tests": "pass", "validate": "pass | skipped", "render": "pass | skipped" },
  "submitted_at": "{iso}",
  "tree_sha256": "{sha256 over sorted `path\\tsha256` lines}",
  "files": [ { "path": "agntux-{slug}/.claude-plugin/plugin.json", "sha256": "...", "bytes": 630 } ]
}
```

Notes:

- `submission_id` = `agntux-{slug}@{final-version}+{tree_sha256[:8]}`.
  It's the marker's primary key downstream and the idempotency key — a
  re-sync or boot rescan re-POSTs the same id and the app dedupes.
- `agntux_build_version` is this plugin's own version — read it from
  `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`.
- `previous_version` is present **only** when `mode` is `"update"`; `revision_of`
  is present **only** on a `:revise` submission (it chains to the prior
  `submission_id`).
- `files[].sha256` are the S3 blob keys; the manifest must cover every
  file in the synced tree, including `CONTRIBUTING-SIGNATURE.md`.
- `dco.*` come from `contributor.json` and the signature you just
  wrote.
- `validation` records the just-run validation result. `build`/`lint`/`tests`
  are `"pass"` by construction (the tool re-validated and only reached the write
  step on a green verdict — the gate inside `agntux_write_submission`), and
  `validate`/`render` carry the per-stage status so a `"skipped"` render (no
  Chromium yet — the renderer may be `installing`) reaches the maintainer. A
  shipped marker ALWAYS carries this block: the tool returns `ok:false` and
  writes nothing on any non-green stage.
- `contributor.socials` is present **only** when a `socials` block
  exists on `contributor.json` (the contributor consented to public
  credit at some point — possibly in a previous session). Copy the
  block verbatim — only the handle keys the contributor provided,
  plus the `credit_consent_at` timestamp. **Read from
  `contributor.json` on disk**, not from the session-state
  `credit_info` field: a `credit_info.skipped: true` session record
  means the user opted out *this session*, but does NOT clear
  consent the user gave previously. If `contributor.json` has no
  `socials` block, omit the whole `socials` key from the marker
  (don't write `"socials": null` or `{}`).

## e. Hard-require sync (before claiming success)

The marker is only meaningful if the desktop app is running to pick it
up. Check **both** of these under the agntux project root:

- `<agntux project root>/.agntux/teams.json` exists, **and**
- `<agntux project root>/.agntux/daemon.lock` is present.

**Both present** → the desktop daemon is active. The marker you wrote
will sync to S3 and the desktop app forwards it to AgntUX. Do **not** jump
straight to the success copy — first confirm the daemon actually accepted
the marker (step e·confirm below).

**Either missing** → do **not** claim the plugin was submitted. The
marker stays on disk (harmless — it syncs the moment the app starts),
but tell the user the AgntUX desktop app must be running and signed in,
then stop:

> {Name}, your plugin is finalized and ready — but it reaches the
> AgntUX team through the AgntUX desktop app, and that app isn't
> running (or isn't signed in) right now. Open the AgntUX desktop app
> and sign in, then run `/agntux-build:build` again and I'll finish the
> handoff. Nothing for you to download, attach, or send.

## e·confirm. Confirm the daemon accepted the marker

Writing the marker is not the same as the submission being queued: the
daemon validates the marker and POSTs it asynchronously, and only a
server-accepted marker becomes a review-queue row. The daemon records the
outcome in a `.submission-status.json` sidecar next to the marker (same
session dir). Confirm via the tool before claiming success — this is what stops
the flow reporting "submitted" for a marker that was actually dropped. Call:

```
agntux_confirm_submission({ session_dir: "<agntux project root>/.agntux-build/builds/{session-id}" })
```

The tool polls the daemon's `.submission-status.json` sidecar and checks the
desktop daemon is active. It is the **ONLY basis for telling the user
"submitted."** Branch on the result:

- **`{ queued: true, ... }`** → the row is queued. Show the success copy in (f).
  This is the only result that licenses a "submitted" claim.
- **`{ queued: false, reason, ... }`** → the daemon dropped the marker; surface
  `reason` to the user and do **NOT** claim success. A `missing_schema_version` /
  location-class reason means step (c) didn't write a valid marker — re-call
  `agntux_write_submission`; a `server_rejected` / `invalid_revision_of` reason
  is a server-side reason worth showing verbatim.
- **`{ queued: null, reason: "daemon_inactive" | "timeout_signed_out", ... }`** →
  the marker is finalized but not yet queued — most often the auth gate (the
  desktop app isn't open or isn't signed in). Tell the user to open / sign in to
  the AgntUX desktop app; it will queue the moment that happens. Do **not**
  assert it's submitted.

## f. What you tell the user (success)

No download, no attachment, no email. The desktop app carries the
finalized plugin to the team on its own. The copy below tells the user
where to watch the review and how to install once it's live — keep it
in non-technical voice. (All the navigation below is in-app menu
breadcrumbs, not filesystem paths — that's fine; just keep it as menu
names.)

**Create mode:**

> {Name}, your plugin is finalized and on its way. The AgntUX desktop
> app is syncing it to the team automatically — there's nothing for you
> to attach or send.
>
> **Track it in the AgntUX desktop app, on the "Built by you" tab.**
> You'll watch it move from "Queued for review" to "In review" to
> "Merged" — or, if the team needs a tweak first, "Changes requested"
> with exactly what to fix spelled out, so you're never guessing.
>
> The team aims to finish review in **one business day or less.** If
> they do ask for changes, you'll get clear instructions for what's
> needed — you won't have to figure it out yourself.
>
> Once it shows **"Merged"** — live in the marketplace — here's how to
> install it:
>
> 1. In Cowork, open **Customize → AgntUX Core → Marketplace
>    (AUX-plugins) → Personal**.
> 2. Click the **three-dot menu** on **AUX-plugins**, then **Check for
>    updates** — the refreshed list now includes your plugin.
> 3. Scroll to find `agntux-{slug}` and click the **+** to install it.
> 4. Back in Cowork, run `/agntux onboard` to set it up. Type the
>    command rather than pasting it — Cowork only recognises it when
>    you type it and pick it from the menu.

**Closing gratitude (create mode):**

> Thank you, {captured-name}. **`agntux-{slug}` will help every other
> AgntUX user who needs to bring {connector-display-name} into
> AgntUX.** That's the whole point of doing this — and you just did it.

**Update mode** — track the same way, but the install is automatic:

> {Name}, your fix is finalized and on its way. The AgntUX desktop app
> is syncing it to the team automatically — nothing to attach or send.
>
> **Track it in the AgntUX desktop app, on the "Built by you" tab** —
> you'll see it move to "Merged" once it's live, or "Changes requested"
> with exactly what to adjust. The team aims to finish review in **one
> business day or less.**
>
> You already have `agntux-{slug}` installed, so there's nothing to
> reinstall. Once the new version is published, **Check for updates**
> (Customize → AgntUX Core → Marketplace (AUX-plugins) → Personal →
> the three-dot menu on AUX-plugins) pulls it in automatically — no
> re-install and no `/agntux onboard` needed; your setup carries over.

**Closing gratitude (update mode):**

> Thank you, {captured-name}. The fix is on its way to the team.
> `agntux-{slug}` will be a better plugin for the people already using
> it because of this — that's the whole point of doing this in the
> open.

## Saved state at end of stage 12

```json
{
  ...,
  "submission": {
    "final_version": "0.1.0",
    "signature_path": "/Users/.../agntux-{slug}/CONTRIBUTING-SIGNATURE.md",
    "marker_path": "/Users/.../.agntux-build/builds/{session-id}/SUBMISSION.json",
    "tree_sha256": "{the tree hash}",
    "sync_active": true,
    "mode": "create",
    "submitted_at": "2026-05-27T..."
  },
  "session_status": "complete"
}
```

`marker_path` and `tree_sha256` come from the `agntux_write_submission`
return (its `marker_path` / `tree_sha256` fields), as does the
`submission_id` you record into `last-submission.json` — never hand-compute or
hand-write any of them. `sync_active` records the result of step e·confirm —
`true` when `agntux_confirm_submission` returned `queued:true` (you showed the
success copy), `false` when the desktop app wasn't active or the daemon dropped
the marker (the tool wrote the marker but the submission wasn't queued, so you
stopped at the hard-require / not-queued message). Don't surface `marker_path`
or `tree_sha256` in user-facing copy; they're internal.

## What you do NOT do

- Don't ask the user to download, attach, or send anything. The whole
  point of this stage is that the desktop app does the delivery.
- Don't claim the plugin was submitted when step e found the desktop
  app inactive. Write the marker, then stop at the hard-require
  message — an unsynced marker is not a submission.
- Don't write `CONTRIBUTING-SIGNATURE.md` outside the build tree (e.g.,
  at the contributor's project root). It travels with the plugin, not
  with the user's local data.
- Don't hand-author the marker (or a `validation-receipt.json`) — ever.
  `agntux_write_submission` is the only writer; it writes after the signature and
  plugin files are on disk, atomically, as a sibling of the plugin dir. If the
  tool isn't callable, STOP and report an agntux-build defect — don't improvise.
- Don't call `agntux_write_submission` before the plugin files and signature are
  all on disk; the tool validates and hashes whatever tree is present.
- Don't skip the closing thank-you. The whole flow has been building
  toward this moment.
- Don't enumerate the files in the manifest, the specialists that ran,
  the schema keys, or anything mechanical. The closing message is for a
  non-technical contributor — high-level only. The session file at
  `<agntux project root>/.agntux-build/sessions/{id}.json` has all the
  detail; that's where it belongs.
- Don't ask the user to install the plugin locally. Source plugins
  can't run locally in Claude Cowork; their first real run is on the
  remote MCP server after AgntUX deploys them. This prohibition is
  about the *local build tree during the flow* — it does NOT
  contradict the §f success copy, which tells the user how to install
  the **published** marketplace version *after* review. That
  post-publication install is a different, legitimate action.

## Why this is enough

- **Auditable**: every submission carries a `CONTRIBUTING-SIGNATURE.md`
  with the DCO version agreed to and when (plus the contributor's name
  when they opted into credit), plus a marker that records the same in
  machine-readable form.
- **Content-addressed**: the marker's `files[].sha256` are the exact S3
  blob keys, so the maintainer side reconstructs the tree with no
  re-upload and `tree_sha256` dedupes re-syncs.
- **Maintainer-side enforcement**: the intake worker can refuse a
  submission missing `CONTRIBUTING-SIGNATURE.md` or with a stale DCO
  version.
- **Probot-DCO-compatible**: when the maintainer commits, they sign off
  with the project's own identity (`Signed-off-by: AgntUX
  <noreply@agntux.ai>`), which passes Probot's check on the public PR
  without collecting or publishing a contributor email.
- **No attachment channel to fail**: nothing is emailed and nothing is
  attached, so the file-type blocks that dead-ended the old flow can't
  happen.
