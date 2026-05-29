# Stage 12 — submit the plugin

The plugin works. Sync surfaces the right things. Time to ship it to
the AgntUX maintainers, who will deploy it to the remote MCP server.

> **Before finalizing:** By submitting you confirm that your plugin will be
> published publicly under the Apache License 2.0, your name and email will
> appear in public commit history and in `CONTRIBUTING-SIGNATURE.md`, you have
> not included secrets or other people's personal data, and submission is
> governed by the [Marketplace Contributor Terms](https://agntux.ai/terms) and
> [Privacy Policy](https://agntux.ai/privacy).

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
- `host-renderer/`, `test-harness/`, `agents/` — agntux-build's own
  internals, never copied into a generated plugin.

Ship everything else the finalized tree contains, **including `NOTICE`
when the plugin has one** (most do; agntux-slack/gmail are the exception —
they carry their Apache-2.0 attribution in `LICENSE` alone and simply have
no `NOTICE` to copy). This exclude list and the step-(c) program's
`EXCLUDE_DIRS` / `EXCLUDE_NAMES` are the **same** set and must stay in
sync — the program is the authoritative implementation.

Keep `CONTRIBUTING-SIGNATURE.md` — it belongs in the synced tree.

Use `node:fs/promises` to enumerate and copy. After this step the
finalized, signature-carrying tree is under
`<agntux project root>/.agntux-build/builds/{session-id}/agntux-{slug}/`.

> **Run this copy AFTER the §b.5 validator, not before.** The validator's build
> step is the last thing that can touch the working tree's bytes, so copy the
> *post-validation* tree — that is what guarantees the synced copy the marker
> program hashes is byte-identical to the tree the receipt bound. See the
> ordering list in §b.5.

## b.5. Validate the working tree — the deterministic gate

This is the **gate.** Run the deterministic validator against the working tree
(`plugins/agntux-{slug}/` in the AUX-plugins checkout — the tree stage 7 built
and where the Artefact step just wrote `CONTRIBUTING-SIGNATURE.md`) so it writes
a `validation-receipt.json` whose `tree_sha256` binds THIS exact tree. The marker
program in step (c) refuses to write `SUBMISSION.json` unless that receipt exists
and matches — no green receipt, no submission.

```bash
node scripts/validate-plugin.mjs agntux-{slug} --session-dir "{SESSION_DIR}"
# {SESSION_DIR} = <agntux root>/.agntux-build/builds/{session-id}/  (the receipt lands
#                 here, a sibling of the agntux-{slug}/ synced copy step (c) hashes)
```

The validator builds → lints → typechecks → tests → `claude plugin validate` →
renders (best-effort) the working tree's `plugins/agntux-{slug}/` — the only tree
the repo-root build/lint tooling can target — hashes it, and writes the receipt
to `{SESSION_DIR}`. **Do NOT pass `--plugin-dir` at the synced-copy path:** build
+ lint cannot target an arbitrary tree, so the validator hard-fails
(`failed_stage: "usage"`) rather than silently validate a tree it never built.

**Ordering matters** — this is why the receipt's hash equals the marker's hash:

1. Write `CONTRIBUTING-SIGNATURE.md` into the working tree (the Artefact step,
   above).
2. Run the validator (here) on the working tree → it builds the tree, then
   hashes it → receipt with `tree_sha256`.
3. **Then** perform the §b sync-copy of the *validated* working tree into
   `{SESSION_DIR}/agntux-{slug}/`. The copy uses the SAME exclude list as the
   hash, so the synced copy is byte-identical on hashed files — its
   `tree_sha256` matches the receipt's. (Copy AFTER validation: the validator's
   build step is the last thing that can touch the tree, so copy the
   post-validation bytes.)
4. Run the marker program (step c): it hashes the synced copy → equals
   `receipt.tree_sha256` → the gate passes.

It MUST exit 0. If it doesn't, the tree is not submittable — the failure is
**mechanical** (see `self-validation.md`); route it back to the owning specialist
per the stage-7 re-dispatch table in `07-build.md` (a `failed_stage: "usage"`
means an operator/environment error — fix the invocation, don't re-dispatch a
specialist) and **do not** proceed to step (c). Any edit after validation (even
a one-byte fix) invalidates the receipt; re-run the validator before retrying.

## c. Build the manifest + write the marker — run this program, don't hand-author

> **This is the one step you must not improvise.** The marker is a precise
> machine wire-shape: the desktop daemon validates `schema_version`, `kind`,
> and `status` and **silently skips** (logs a `warn`, never POSTs) any marker
> missing them — so a hand-written "summary" with the wrong keys, or a marker
> placed *inside* the `agntux-{slug}/` dir instead of as its sibling, never
> reaches the queue and the contributor is told "submitted" when nothing was.
> Fill in the constants at the top and **run the program below verbatim**. It
> enumerates the tree, computes every sha256, derives `tree_sha256`, reads the
> step-(b.5) `validation-receipt.json` and **refuses to write a marker unless a
> green receipt binds this exact tree**, assembles the full marker, writes it
> atomically to the session root, and self-checks the result. Do not transcribe
> its output into a marker by hand.

```js
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, relative } from "node:path";

// ---- fill these in from session state (stage 0 / stage 10 / revise step 3) ----
const ROOT = "<agntux project root>";       // the stage-0 resolver result (absolute)
const SESSION = "{session-id}";             // YYYY-MM-DD-HHmmss
const SLUG = "agntux-{slug}";
const PLUGIN_VERSION = "{final-version}";   // stage 10 / the plugin's own plugin.json
const MODE = "create";                      // "create" | "update"
const PREVIOUS_VERSION = null;              // string ONLY when MODE === "update", else null
const REVISION_OF = null;                   // submission_id when :revise (step 3), else null
if (!process.env.CLAUDE_PLUGIN_ROOT) {
  throw new Error(
    "CLAUDE_PLUGIN_ROOT is not set — run this inside the agntux-build plugin context",
  );
}
const AGNTUX_BUILD_VERSION = JSON.parse(    // THIS plugin's own version
  readFileSync(join(process.env.CLAUDE_PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8"),
).version;
// -------------------------------------------------------------------------------

const SESSION_DIR = join(ROOT, ".agntux-build", "builds", SESSION);
const PLUGIN_DIR = join(SESSION_DIR, SLUG);
// SIBLING of the plugin dir — NEVER `${PLUGIN_DIR}/SUBMISSION.json`.
const MARKER_PATH = join(SESSION_DIR, "SUBMISSION.json");

// Mirror the step-b exclude list + the marker itself + OS cruft. The sha256
// of each kept file IS its content-addressed S3 blob key.
const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", ".omc", "mcp-server", "hooks", "host-renderer",
  "test-harness", "agents",
]);
const EXCLUDE_NAMES = new Set([
  "SUBMISSION.json", "SUBMISSION.json.tmp", ".DS_Store", ".mcp.json",
  // The validation receipt lives in SESSION_DIR (a sibling of PLUGIN_DIR), so
  // it is already outside this walk — excluded here belt-and-suspenders so the
  // tree_sha256 the receipt records and the tree_sha256 the marker records can
  // never diverge by the receipt hashing itself.
  "validation-receipt.json", "validation-receipt.json.tmp",
]);

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!EXCLUDE_DIRS.has(e.name)) walk(join(dir, e.name), acc); }
    else if (e.isFile() && !EXCLUDE_NAMES.has(e.name)) acc.push(join(dir, e.name));
  }
  return acc;
}

const files = walk(PLUGIN_DIR)
  .map((abs) => {
    const buf = readFileSync(abs);
    return {
      path: `${SLUG}/${relative(PLUGIN_DIR, abs)}`,
      sha256: createHash("sha256").update(buf).digest("hex"),
      bytes: buf.length,
    };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

// tree_sha256 = sha256 over sorted `path\tsha256` lines joined by \n.
const tree_sha256 = createHash("sha256")
  .update(files.map((f) => `${f.path}\t${f.sha256}`).join("\n"))
  .digest("hex");
const submission_id = `${SLUG}@${PLUGIN_VERSION}+${tree_sha256.slice(0, 8)}`;

// Read the validation receipt that scripts/validate-plugin.mjs wrote into
// SESSION_DIR (step b.5). Read it now so its result can be BOTH gated on (the
// receipt gate further below) AND surfaced into the marker so a "skipped"
// render reaches the maintainer. A null here is handled by the gate.
let receipt = null;
try {
  receipt = JSON.parse(readFileSync(join(SESSION_DIR, "validation-receipt.json"), "utf8"));
} catch {
  /* the receipt gate below throws if it is missing or stale */
}

// contributor + dco + optional socials come from contributor.json ON DISK
// (not session state — see the socials note below).
const contrib = JSON.parse(
  readFileSync(join(ROOT, ".agntux-build", "contributor.json"), "utf8"),
);

const marker = {
  schema_version: "1.1.0",
  kind: "agntux-build.submission",
  status: "final",
  submission_id,
  ...(REVISION_OF ? { revision_of: REVISION_OF } : {}),
  plugin_slug: SLUG,
  plugin_version: PLUGIN_VERSION,
  mode: MODE,
  ...(MODE === "update" ? { previous_version: PREVIOUS_VERSION } : {}),
  session_id: SESSION,
  build_root: SLUG,
  agntux_build_version: AGNTUX_BUILD_VERSION,
  contributor: {
    name: contrib.name,
    email: contrib.email,
    ...(contrib.socials ? { socials: contrib.socials } : {}),
  },
  dco: {
    version: contrib.dco_text_version,
    agreed_at: contrib.dco_agreed_at,
    signed_off_by: `${contrib.name} <${contrib.email}>`,
  },
  ...(receipt
    ? {
        validation: {
          build: receipt.build,
          lint: receipt.lint,
          tests: receipt.tests,
          render: receipt.render, // "pass" | "skipped" — surfaced for the maintainer
        },
      }
    : {}),
  submitted_at: new Date().toISOString(),
  tree_sha256,
  files,
};

// Self-check the IN-MEMORY marker against the exact gates the daemon + the
// server schema apply — BEFORE writing, so a marker that would be skipped or
// 400-rejected is never left on disk and the flow can't claim "submitted".
const okContrib =
  typeof contrib.name === "string" && contrib.name.length > 0 &&
  typeof contrib.email === "string" && contrib.email.length > 0 &&
  typeof contrib.dco_text_version === "string" && contrib.dco_text_version.length > 0 &&
  typeof contrib.dco_agreed_at === "string" && contrib.dco_agreed_at.length > 0;
if (!okContrib) {
  throw new Error(
    "contributor.json is missing name/email/dco fields — fix it, do NOT claim submitted",
  );
}
const okShape =
  marker.schema_version && marker.kind === "agntux-build.submission" &&
  marker.status === "final" && marker.submission_id &&
  Array.isArray(marker.files) && marker.files.length > 0 &&
  marker.files.length <= 4096; // server + worker both cap at 4096
const okLocation = !MARKER_PATH.endsWith(`${SLUG}/SUBMISSION.json`);
if (!okShape || !okLocation) {
  throw new Error("SUBMISSION.json failed self-check — daemon would skip it");
}

// Receipt gate — the single CODE gate that makes submission impossible without
// a green validation for THIS exact tree. validate-plugin.mjs (step b.5) is the
// last mutation before submit; any later edit changes tree_sha256 and
// invalidates the receipt (the intended forcing function). build/lint/tests
// MUST be "pass"; render may be "pass" or "skipped" (soft, per the user's
// best-effort decision).
const validated =
  receipt &&
  receipt.tree_sha256 === tree_sha256 &&
  receipt.build === "pass" &&
  receipt.lint === "pass" &&
  receipt.tests === "pass";
if (!validated) {
  throw new Error(
    "plugin not validated for THIS tree — run validate-plugin.mjs; refusing to submit",
  );
}

// Only now write — atomically: temp in the SAME dir, then rename over the
// target so the desktop watcher's awaitWriteFinish never sees a half-written
// file.
const tmp = `${MARKER_PATH}.tmp`;
writeFileSync(tmp, JSON.stringify(marker, null, 2));
renameSync(tmp, MARKER_PATH);

console.log(JSON.stringify(
  { submission_id, tree_sha256, files: files.length, marker_path: MARKER_PATH },
  null, 2,
));
```

`tree_sha256` is the dedup key; its first 8 hex chars are the `submission_id`
suffix. Record the printed `submission_id` into `last-submission.json` per
`07-build.md` (its `submission_id` field — that exact key).

## d. Marker shape — field reference

The program in step (c) already wrote the marker — atomically (temp +
`rename`, so the desktop watcher's `awaitWriteFinish` never reads a
half-written file), at the session root
(`<agntux project root>/.agntux-build/builds/{session-id}/SUBMISSION.json`, a
**sibling of** the `agntux-{slug}/` dir so the plugin tree stays pristine).
This section documents the shape it emits so you can sanity-read the result —
**you do not author it by hand.** The emitted JSON is:

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
  "validation": { "build": "pass", "lint": "pass", "tests": "pass", "render": "pass | skipped" },
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
- `validation` mirrors the green `validation-receipt.json` from step (b.5)
  so a `"skipped"` render (no Chromium available) reaches the maintainer.
  The block is absent only when no receipt was found — in which case the
  receipt gate in step (c) throws before the marker is ever written, so a
  shipped marker always carries it.
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
session dir). Poll for it before claiming success — this is what stops the
flow reporting "submitted" for a marker that was actually dropped:

```js
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STATUS_PATH = join(SESSION_DIR, ".submission-status.json");
let status = null;
// The daemon writes within ~1–2s of the POST resolving; poll ~30s.
await (async () => {
  for (let i = 0; i < 30; i++) {
    try { status = JSON.parse(readFileSync(STATUS_PATH, "utf8")); return; }
    catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
})();
console.log(JSON.stringify(status));
```

Branch on the result:

- **`status?.ok === true`** → the row is queued. Show the success copy in
  (f).
- **`status?.ok === false`** → the daemon dropped the marker; surface
  `status.reason` to the user and do **NOT** claim success. A
  `missing_schema_version` / location-class reason means the step-(c)
  program didn't run correctly — re-run it; `server_rejected` /
  `invalid_revision_of` is a server-side reason worth showing verbatim.
- **No sidecar after the timeout (`status === null`)** → the daemon saw the
  marker but hasn't confirmed yet — most often the auth gate (signed out or
  onboarding incomplete). Tell the user it's finalized and will queue the
  moment the desktop app is signed in; do **not** assert it's submitted.

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
