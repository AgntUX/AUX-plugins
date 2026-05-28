# Stage 11 — credit the contributor

The plugin works, sync iterations have converged, and the submission
is one stage away from going to the AgntUX team. Before stage 12
writes the marker the desktop app forwards, give the contributor the
chance to be publicly credited for the work — and the chance to skip.

## Why this stage exists

When AgntUX talks about this plugin — the marketplace listing page on
agntux.ai/plugins, release notes, social posts promoting the launch —
we want to credit the contributor by name. For contributors who want
to be tagged on social, we collect their public handles here, once,
at the end of the build, and the desktop daemon forwards them into
the submission record. The contributor never has to send a follow-up
email or fill in a form later.

This is also where we get **explicit consent**: the contributor sees,
in plain language, that the handles they share may be used in public
posts and tags. Skipping is a fully supported answer.

## When to run

Always — solo or team path, create or update mode — once the sync
loop in stage 10 has converged and the contributor is ready to ship.
The stage runs **after stage 10, before stage 12**. If the session's
`credit_info` was already captured (the build was resumed mid-flow),
skip silently and proceed to stage 12.

## Pre-flight

1. Read `<agntux project root>/.agntux-build/contributor.json` (which
   exists by this point — stage 0 either created it earlier in this
   session or in a previous one).
2. If the file already carries a `socials` block (the contributor
   went through this step in a previous build session), **confirm
   rather than re-ask** — and re-state the publish/tag consent so
   the contributor isn't asked to re-agree to a rule they last saw
   weeks ago:

   > {Name}, last time you shared these handles so AgntUX could
   > credit you — we may publish them on the agntux.ai plugin page
   > and tag you in social posts promoting your plugins. Want me to
   > use the same set for this submission, or change anything?
   >
   > - X / Twitter: {x or "—"}
   > - LinkedIn: {linkedin or "—"}
   > - Instagram: {instagram or "—"}
   > - Reddit: {reddit or "—"}

   Accept exactly: `same`, `use those`, `yes`, `ok`, `keep` → keep
   the existing values, do not re-write the file, proceed to
   "Hand-off to stage 12". `change X` / `update X` → re-ask the
   named field only and write the updated set. Anything else → load
   the full capture flow below.
3. Otherwise (no prior `socials` block), run the capture flow.

## Capture flow

Lead with the consent framing — three sentences max — so the
contributor knows what they're opting into **before** any handles
change hands:

> {Name}, before I send your plugin off, AgntUX would love to credit
> you for it. If you're up for being tagged, drop any of the handles
> below — we may publish them on the agntux.ai plugin page and tag
> you in social posts promoting your plugin (X, LinkedIn, Instagram,
> Reddit). Anything you leave blank stays private, and you can say
> **skip** to skip the whole step.

Then present the form — labelled lines the contributor fills in:

> - **X / Twitter handle:**
> - **LinkedIn:**
> - **Instagram:**
> - **Reddit:**
>
> Leave any line blank to skip that field. Reply **skip** to skip the
> whole step.

Accept these inputs:

- **Skip the whole step** — case-insensitive match against any of:
  `skip`, `skip all`, `no thanks`, `no`, `pass`, `none`. Move to
  "Persist (skip path)".
- **Filled form** — any reply that fills at least one of the four
  fields. Parse leniently (see "Normalisation"). Move to "Persist
  (with consent)".
- **Ambiguous** — reply doesn't fit either bucket → ask once more in
  one line ("Was that a skip, or did you want me to capture those?
  Just say `skip` or paste the handles."). Don't loop more than once
  — treat a second ambiguous reply as skip.

## Normalisation

The contributor types whatever feels natural. Be lenient — DON'T
reject for shape, just normalise:

- **X / Twitter**: strip leading `@`, strip URL prefix
  (`twitter.com/`, `x.com/`, scheme + host). Store as the bare
  handle without `@`. Examples: `@jane`, `jane`,
  `https://x.com/jane` → all → `jane`.
- **LinkedIn**: if it looks like a full URL (`linkedin.com/in/...`
  or `https://...linkedin.com/...`), store the URL verbatim. If it's
  a bare handle, store as `https://www.linkedin.com/in/{handle}/`.
- **Instagram**: same shape as X — strip `@`, strip
  `instagram.com/`, store bare.
- **Reddit**: strip `u/`, `/u/`, `reddit.com/u/`,
  `reddit.com/user/`, leading `@`. Store bare.

Empty / whitespace-only fields are treated as "not provided".

## Persist (with consent)

If at least one handle was provided, extend
`<agntux project root>/.agntux-build/contributor.json` with a
`socials` block:

```json
{
  "name": "...",
  "email": "...",
  "dco_text_version": "1.1",
  "dco_agreed_at": "...",
  "dco_agreed_via": "...",
  "socials": {
    "x": "{normalised, only if provided}",
    "linkedin": "{normalised URL, only if provided}",
    "instagram": "{normalised, only if provided}",
    "reddit": "{normalised, only if provided}",
    "credit_consent_at": "{current-iso-timestamp}"
  }
}
```

Use `node:fs/promises` `writeFile` with `mode: 0o600`. Write
**atomically** — write to `contributor.json.tmp` in the same
directory, then `rename` over the target — so a concurrent read can't
see a half-written file. Mirrors how stage 0 writes the same file.

Only emit handle keys for fields the contributor actually filled in
— don't write `"x": ""` for skipped fields. Always emit
`credit_consent_at` when the `socials` block exists; its presence is
the consent record.

Acknowledge briefly:

> Got it. Thanks {Name} — AgntUX will credit you when this plugin
> launches.

## Persist (skip path)

If the contributor said skip, **do not** write a `socials` block.
`contributor.json` stays as-is.

Acknowledge briefly:

> No problem — AgntUX will credit your plugin without tagging you.

## Hand-off to stage 12

Save the session state to
`<agntux project root>/.agntux-build/sessions/{session-id}.json`:

```json
{
  ...,
  "credit_info": {
    "captured_at": "{iso}",
    "skipped": true | false
  }
}
```

`skipped: false` means a `socials` block lives in `contributor.json`.
`skipped: true` means the contributor opted out **this session** —
but it does NOT clear any pre-existing `socials` block on disk from
a previous session. Stage 12 reads `contributor.json` directly (not
the session-state field), so a skip in the current session leaves
previously-granted consent intact. That is intentional: the consent
the user gave previously is still valid, and clearing it without an
explicit revocation would erase a permission they granted on
purpose. Don't surface this to the user — `skipped: true` is purely
a session-state record.

Then load `references/12-submit.md` and continue.

## What this does NOT do

- **Doesn't ask for GitHub, Bluesky, Mastodon, or a personal
  website.** This plugin's contributors are knowledge workers, not
  engineers — the four channels above are the ones AgntUX actually
  reaches its audience through. If the contributor volunteers other
  links, accept them politely but don't persist them.
- **Doesn't validate the shape of the handles** beyond the lenient
  normalisation above. We are not checking that an X handle exists;
  we are stripping noise so the stored value is consistent.
- **Doesn't write the marker.** Stage 12 owns the marker. Stage 11
  only writes to `contributor.json`.
- **Doesn't persist anything if the user skipped.** Skip means no
  `socials` block, no consent timestamp, no marker change.
- **Doesn't lecture about consent or social media.** One sentence on
  what AgntUX will do with the handles. The contributor read it;
  move on.
- **Doesn't loop.** One capture turn, one ambiguity retry at most.
  Knowledge workers don't want a five-question wizard at the end of
  a long build session.
