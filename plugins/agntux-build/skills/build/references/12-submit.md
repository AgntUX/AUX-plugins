# Stage 12 — submit the plugin

The plugin works. Sync surfaces the right things. Time to ship it to
the AgntUX maintainers, who will deploy it to the remote MCP server.

Source plugins are remote-view-only — they have no local MCP server,
and local install in Claude Cowork is broken for the view-tool path.
The plugin's first real run is on the remote MCP server after the
AgntUX team deploys it. The submission is therefore a handoff to
`plugins@agntux.ai`: a draft email (composed through an installed
AgntUX email plugin's connector when one is available, otherwise via
convenience links and copy-paste) plus the zip the user attaches.

This is the **first and only time the plugin gets zipped.** Earlier
stages iterate on the prompts in place; the zip is generated here, once,
with the contributor's signature folded in.

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

Write to `{build-path}/CONTRIBUTING-SIGNATURE.md`.

### 2. The final zip (with the signature)

Re-run the view-tool build to make sure `dist/` is fresh, then zip the
plugin tree into the user's Downloads folder. This is the **only** zip
the flow produces — there is no earlier snapshot.

**Build location** (cross-platform — pick the first that resolves):

| Platform       | Path                                                       |
|----------------|------------------------------------------------------------|
| Linux (XDG)    | `$(xdg-user-dir DOWNLOAD)/agntux-{slug}-v{version}.zip`    |
| macOS / Linux  | `$HOME/Downloads/agntux-{slug}-v{version}.zip`             |
| Windows        | `%USERPROFILE%\Downloads\agntux-{slug}-v{version}.zip`     |
| Fallback       | `$HOME/agntux-{slug}-v{version}.zip` (no Downloads dir)    |

Resolution algorithm:

1. On Linux, try `xdg-user-dir DOWNLOAD` (handles non-English locales
   and custom XDG settings). If it succeeds AND the resolved directory
   exists, use it.
2. Else try `$HOME/Downloads` (macOS / Linux default) or
   `%USERPROFILE%\Downloads` (Windows). If `existsSync` returns true,
   use it.
3. Else fall back to `$HOME` directly. Don't create `~/Downloads/` —
   the user's filesystem layout is theirs to set; just put the zip
   somewhere they can find it.

The version is part of the filename, so re-running the build for a
later version accumulates a paper trail in Downloads side-by-side
rather than overwriting. The final filename:

```
agntux-{slug}-v{final-version}.zip
```

Don't write to `<agntux-root>/.agntux-build/submissions/` or any
dot-folder — most users can't easily browse there. Session state still
lives at `<agntux-root>/.agntux-build/sessions/`; the user-facing zip
belongs in Downloads.

**Zip contents** (mirror agntux-slack's shape), with
`CONTRIBUTING-SIGNATURE.md` added at the plugin root:

```
agntux-{slug}/
├── .claude-plugin/plugin.json
├── LICENSE                           # Apache-2.0 (mirror of repo root)
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING-SIGNATURE.md         # written above, this stage
├── package.json                      # plugin root manifest
├── vitest.config.ts
├── marketplace/
│   ├── listing.yaml
│   ├── icon.png
│   └── screenshots/
├── skills/
│   └── {plugin-slug}/                # rendered ingest skill tree
│       ├── SKILL.md
│       ├── _overrides/
│       └── reference/
├── view-tool/                        # the only runtime surface
│   ├── src/
│   ├── dist/                         # built bundles (handler + ui-resources + manifest)
│   ├── scripts/                      # emit-manifest.mjs
│   ├── __tests__/                    # payload-shape.test.ts + any other regressions
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── tailwind.config.mjs           # when Tailwind is wired (canonical scaffold default)
└── __tests__/                        # plugin-level cold-start, render-reproducibility, etc.
```

**Explicit excludes** (the zip must NOT contain these paths even if
they exist on disk):

- `node_modules/`
- `mcp-server/` — remote-view-only plugins ship none. The build
  already rejected in stage 7 if present.
- `hooks/` — same.
- `.mcp.json` — same.
- `.omc/`, `.git/`, `.DS_Store`
- `NOTICE` — agntux-slack/gmail don't ship one; the Apache-2.0
  attribution lives in `LICENSE` alone.
- `host-renderer/`, `test-harness/`, `agents/` — those are
  agntux-build's own internals, never copied into a generated plugin.

Use `node:fs/promises` to enumerate the build tree and a zip library
(the host typically has `archiver` or similar — fall back to the `zip`
shell command if needed).

## The submission email — best-available draft, degrading cleanly

The recipient is always `plugins@agntux.ai`. How you get the email in
front of the user depends on what's installed.

**Empirical note (don't regress this):** a bare `mailto:` link can't be
the primary path. macOS routes `mailto:` to its registered handler,
which is commonly Chrome; Chrome with no mail web-handler registered
shows "create an email?" and then dead-ends. Shortening or re-encoding
the URL does not fix it — verified. `mailto:` only works for users
whose handler is a native client (Apple Mail / Outlook). Anyone living
in webmail hits a silent dead end. So `mailto:` is one fallback among
several, never the lead.

### The concise body (used everywhere)

```
Subject: New plugin: agntux-{slug} v{version}

Hi AgntUX team,

Submitting agntux-{slug} v{version} (created via agntux-build).

What it does: {one-line tagline from listing.yaml}
Connector: {connector-display-name}

Contributor: {name} <{email}>
DCO: agreed to v1.1 on {date}

Signed-off-by: {name} <{email}>
```

**Do not add schema, dry-run, view-tool, or payload detail to the
email** — the zip carries full detail; long bodies bloat the links and
push webmail/`mailto:` URLs past length limits.

### Step A — detect installed AgntUX email plugins

Mirror agntux-core onboarding's detection idiom (see
`plugins/agntux-core/skills/_preconditions.md` check 0.5):

1. Resolve `mcp__plugins__list_plugins` via
   `ToolSearch({query: "select:mcp__plugins__list_plugins", max_results: 1})`.
   If it resolves, call it for the host's installed `{slug, marketplace}`
   list. If it doesn't resolve, best-effort read
   `~/.agntux/installed-plugins.json`. If neither yields a list, skip to
   **Step C**.
2. For each installed slug (excluding `agntux-core` / `agntux-build`),
   best-effort read
   `${CLAUDE_PLUGIN_ROOT}/../{slug}/marketplace/listing.yaml`. Classify
   it as **email-draft-capable** when it has all three of:
   - `categories` containing `communication`,
   - a compose `ui_components` entry (a `view_tool` whose purpose
     mentions draft/compose — e.g. `agntux_gmail_compose_view`), and
   - `requires_source_mcp.connector_slug`.

   Capture `connector_slug` + `display_name` (agntux-gmail → `gmail` /
   "Gmail"). If a plugin is malformed or a field is missing, treat it as
   not email-draft-capable and move on — never block on a parse error.

### Step B — preferred path: draft through that plugin's connector

If Step A found an email-draft-capable plugin:

- **Do NOT invoke the plugin's compose view tool directly.**
  `agntux_gmail_compose_view` reads an on-disk action file's
  `## Compose payload` and is shaped for thread *replies*; using it
  would force a write into the user's `data/` (against this skill's
  "never write the user's data" rule). The view ultimately calls the
  connector's create-draft tool — call that directly instead.
- Resolve the connector's create-draft tool via `ToolSearch` keyed on
  the display name (e.g. query `"{display_name} create draft"`; for
  Gmail the host tool is `mcp__claude_ai_Gmail__create_draft`). Pick a
  resolved tool whose name matches `create_draft` / `draft`.
- **Confirm before mutating** (voice rule #5): "Want me to draft this in
  your {display_name}? You'll review and send it yourself." On yes, call
  create-draft with `to: plugins@agntux.ai`, the concise subject, and
  the concise plain-text body (no URL encoding — it's a tool arg, not a
  URL).
- create-draft can't attach files (see "What you do NOT do" below), so
  the zip is still attached by hand. Tell the user: "I've drafted it in
  {display_name} — open Drafts, attach the zip (Show in Finder on the
  card below), and Send."

### Step C — fallback when no email plugin/connector is available

Present these together, labelled, so the user picks whichever fits:

- **Open in Gmail compose** —
  `https://mail.google.com/mail/?view=cm&fs=1&to=plugins@agntux.ai&su={encoded-subject}&body={encoded-body}`
  (works for browser Gmail users, no handler needed). *Verified working
  in the test environment.*
- **Open in your mail app** — the `mailto:` link:
  `mailto:plugins@agntux.ai?subject={encoded-subject}&body={encoded-body}`
  (works for native-client users).
- **Copy & paste** — the `SUBMISSION-EMAIL.txt` card (same concise body)
  plus the zip card.

**Parens-encode rule (load-bearing — the link breaks otherwise):**
`encodeURIComponent` leaves `(` and `)` raw, and a literal `)` ends a
markdown link early. Encode every emitted link body and subject with:

```js
encodeURIComponent(s).replace(/\(/g, "%28").replace(/\)/g, "%29")
```

## Drop the zip + email body into chat as cards (Cowork)

Before printing the prose handoff, try to render the artefacts as
inline cards so the user can see the zip download and grab the email
body without leaving the chat. Write the email body to a file the host
can present — **outside the build tree** so it never ends up inside
the submission zip:

1. Write the rendered email body (subject + body, plain text) to
   `<agntux project root>/.agntux-build/sessions/{session-id}/SUBMISSION-EMAIL.txt`.
   The same concise body the links carry, unencoded. Keep it readable —
   it's the copy-paste fallback. **Never write this file under
   `{build-path}`**; that tree gets zipped, and the email body must not
   travel with the plugin.
2. Resolve the tool:
   `ToolSearch({query: "select:mcp__cowork__present_files", max_results: 1})`.
3. On resolve, call:
   ```
   mcp__cowork__present_files({files: [
     {file_path: "{absolute-zip-path}"},
     {file_path: "<agntux project root>/.agntux-build/sessions/{session-id}/SUBMISSION-EMAIL.txt"}
   ]})
   ```
   The zip renders as a download card with a **Show in Finder** button —
   that's the affordance the user clicks to attach the file. `zip_path`
   stays in saved-state JSON (internal only); it does NOT go in
   user-facing copy.
4. On no resolve, skip silently — Step C's links + copy-paste body
   carry the handoff. **Don't narrate the failed lookup.**

## What you tell the user

What you show depends on which path Step A–C resolved.

**If Step B drafted through a connector:**

> {Name}, your plugin is packaged and I've drafted the submission email
> in your {display_name}.
>
> To send it: open your Drafts, click **Show in Finder** on the zip
> below to grab the file, attach it, and Send. That's it.

**If you're on the Step C fallback:**

> {Name}, your plugin is packaged and ready. Pick whichever fits how you
> do email:
>
> - **Open in Gmail compose** — {gmail-compose-link}
> - **Open in your mail app** — {mailto-link}
> - **Copy & paste** — the email card below has the full text.
>
> Then click **Show in Finder** on the zip below, attach it to the
> email, and Send.

## The closing

Once the user confirms they sent the email:

> Thank you, {captured-name}. **`agntux-{slug}` will help every
> other AgntUX user who needs to bring {connector-display-name}
> into AgntUX.** That's the whole point of doing this — and you
> just did it.
>
> The team will review the submission and post back at
> {captured-email} with any questions. Once it's deployed to the
> AgntUX remote MCP server, anyone who installs `agntux-{slug}`
> will get the live view tools you designed.

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
    "draft_method": "connector",
    "draft_connector": "gmail",
    "mode": "create",
    "submitted_at": "2026-05-08T..."
  },
  "session_status": "complete"
}
```

`draft_method` records which path Step A–C resolved: `"connector"` (Step
B drafted through an installed email plugin — `draft_connector` names
it, e.g. `"gmail"`), or `"links"` for the Step C fallback (no email
plugin; the user got the Gmail-compose / `mailto:` / copy-paste set, and
`draft_connector` is `null`).

## What you do NOT do

- Don't try to attach the zip programmatically. Connector create-draft
  tools don't accept attachments, and even on the Step B path the user
  attaches the zip by hand (Show in Finder on the card → attach → Send).
  That's unavoidable and fine.
- Don't lead with `mailto:`. It dead-ends for webmail users (macOS
  routes it to Chrome, which has no mail web-handler). It's one Step C
  fallback among several, never the primary path.
- Don't emit a link without parens-encoding the subject and body
  (`%28` / `%29`) — a raw `)` ends the markdown link early.
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
- Don't ask the user to install the plugin locally. Source plugins
  can't run locally in Claude Cowork; their first real run is on
  the remote MCP server after AgntUX deploys them.

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
  v1 ships email + zip + frontmatter.
