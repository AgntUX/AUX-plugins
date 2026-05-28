# Stage 12 — submit the plugin

The plugin works. Sync surfaces the right things. Time to ship it to
the AgntUX maintainers, who will deploy it to the remote MCP server.

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
  name: {captured-name}
  email: {captured-email}
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

Write to `{build-path}/CONTRIBUTING-SIGNATURE.md` (the plugin root).
This file now rides to S3 with the rest of the tree and remains the
maintainer's commit-trailer source — the `Signed-off-by:` line a
maintainer copies into the merge commit so Probot DCO passes on the
public PR.

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
- `NOTICE` — agntux-slack/gmail don't ship one; the Apache-2.0
  attribution lives in `LICENSE` alone.
- `host-renderer/`, `test-harness/`, `agents/` — agntux-build's own
  internals, never copied into a generated plugin.

Keep `CONTRIBUTING-SIGNATURE.md` — it belongs in the synced tree.

Use `node:fs/promises` to enumerate and copy. After this step the
finalized, signature-carrying tree is under
`<agntux project root>/.agntux-build/builds/{session-id}/agntux-{slug}/`.

## c. Build the file manifest

Enumerate every file in the synced plugin tree (after the copy, with
excludes applied) and, for each, compute its sha256 over the exact file
bytes plus its byte length. Those sha256 values **are** the
content-addressed S3 blob keys the daemon syncs, so they must be the
raw-bytes hash:

```js
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
// per file — relative path prefixed by the plugin dir name:
const buf = await readFile(absPath);
const sha256 = createHash("sha256").update(buf).digest("hex");
const bytes = buf.length;
const path = `agntux-{slug}/${relPathWithinPluginDir}`;
```

Then derive the tree hash over the sorted manifest — sort `files` by
`path`, join `${path}\t${sha256}` lines with `\n`, and sha256 that
string:

```js
const treeInput = files
  .slice()
  .sort((a, b) => a.path.localeCompare(b.path))
  .map((f) => `${f.path}\t${f.sha256}`)
  .join("\n");
const tree_sha256 = createHash("sha256").update(treeInput).digest("hex");
```

`tree_sha256` is the dedup key; its first 8 hex chars go into
`submission_id`.

## d. Write the marker LAST, atomically

Only after every plugin file and `CONTRIBUTING-SIGNATURE.md` are on
disk, write the marker to:

```
<agntux project root>/.agntux-build/builds/{session-id}/SUBMISSION.json
```

— a **sibling of** the `agntux-{slug}/` dir, so the plugin tree stays
pristine. Write **atomically**: write a temp file in the same directory
(e.g. `SUBMISSION.json.tmp`), then `rename` it over the target. The
rename is what makes the marker appear all-at-once, so the desktop
watcher's `awaitWriteFinish` never reads a half-written file. This
mirrors how `installed-plugins.json` is written.

Schema:

```json
{
  "schema_version": "1.1.0",
  "kind": "agntux-build.submission",
  "status": "final",
  "submission_id": "agntux-{slug}@{version}+{tree_sha256[:8]}",
  "plugin_slug": "agntux-{slug}",
  "plugin_version": "{final-version}",
  "mode": "create | update",
  "previous_version": "{only when mode=update}",
  "session_id": "{YYYY-MM-DD-HHmmss}",
  "build_root": "agntux-{slug}",
  "agntux_build_version": "{agntux-build plugin.json version}",
  "contributor": {
    "name": "...",
    "email": "...",
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
  "dco": { "version": "1.1", "agreed_at": "{iso}", "signed_off_by": "Name <email>" },
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
- `previous_version` is present **only** when `mode` is `"update"`.
- `files[].sha256` are the S3 blob keys; the manifest must cover every
  file in the synced tree, including `CONTRIBUTING-SIGNATURE.md`.
- `dco.*` come from `contributor.json` and the signature you just
  wrote.
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
will sync to S3 and the desktop app forwards it to AgntUX. Show the
success copy below.

**Either missing** → do **not** claim the plugin was submitted. The
marker stays on disk (harmless — it syncs the moment the app starts),
but tell the user the AgntUX desktop app must be running and signed in,
then stop:

> {Name}, your plugin is finalized and ready — but it reaches the
> AgntUX team through the AgntUX desktop app, and that app isn't
> running (or isn't signed in) right now. Open the AgntUX desktop app
> and sign in, then run `/agntux-build:build` again and I'll finish the
> handoff. Nothing for you to download, attach, or send.

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

`sync_active` records the result of step e — `true` when both
`teams.json` and `daemon.lock` were present (you showed the success
copy), `false` when the desktop app wasn't active (you wrote the marker
but stopped at the hard-require message). Don't surface `marker_path`
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
- Don't write the marker before the plugin files and signature are all
  on disk, and never write it non-atomically — a half-written marker
  trips the desktop watcher.
- Don't put the marker inside `agntux-{slug}/`. It's a sibling of the
  plugin dir so the tree stays pristine.
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
  with the DCO version agreed to, when, and by whom, plus a marker that
  records the same in machine-readable form.
- **Content-addressed**: the marker's `files[].sha256` are the exact S3
  blob keys, so the maintainer side reconstructs the tree with no
  re-upload and `tree_sha256` dedupes re-syncs.
- **Maintainer-side enforcement**: the intake worker can refuse a
  submission missing `CONTRIBUTING-SIGNATURE.md` or with a stale DCO
  version.
- **Probot-DCO-compatible**: when the maintainer commits, the
  `Signed-off-by:` trailer from the signature file passes Probot's
  check on the public PR.
- **No attachment channel to fail**: nothing is emailed and nothing is
  attached, so the file-type blocks that dead-ended the old flow can't
  happen.
