# Update mode — when the user reports an issue with an existing plugin

Entered from stage 2 when the marketplace search returned an exact
match AND the user reports they've hit something specific. The same
3–10 stages apply; only the framing changes.

## What you capture before starting

Ask one question to scope the issue:

> Tell me what's not working. The more specific the better — what
> did you click, what did you expect, what happened instead?

Common shapes:

- **Sync doesn't catch X** — "I @-mentioned in #engineering and
  AgntUX never raised an action item." Treats this as a sync-loop
  fix; stage 10's iteration is the load-bearing one.
- **The action button does the wrong thing** — "When I click Send
  it's adding a quoted reply instead of a fresh message." Treats
  this as a write-back UI fix; stages 6–8 are the load-bearing ones.
- **The plugin asks too many questions / not enough** — sync skill
  prompt issue; stage 10 again.
- **It's slow / costs too much** — cadence or volume cap issue;
  stage 10 plus a `recommended_ingest_cadence` change in
  `plugin.json`.
- **It conflicts with another plugin** — escalate to issues. The
  fix is cross-plugin and doesn't belong in this flow.

Persist the user's complaint verbatim in the session file:

```json
{
  ...,
  "mode": "update",
  "issue_summary_user_words": "...verbatim user complaint..."
}
```

## What to skip

Update mode skips:

- **Stage 1's no-match branch** — the marketplace search already
  found the plugin in stage 1; we entered update mode from stage 2.
  Don't re-search.
- **Stage 5's "plan the action buttons"** — the existing view tools
  tell you. Read each handler from `view-tool/src/{slug}-view.ts`
  (descriptor + handler) and the iframe entries at
  `view-tool/src/{ui-name}-ui.tsx`. Just confirm with the user which
  existing UI(s) are the surface to fix.

## What you DO different

- **Fetch the LATEST PUBLISHED source as the authoring base — never a
  fresh scaffold, never a stale local copy.** The plugin already exists
  in the marketplace; a fix must be authored against current published
  code. Call the MCP tool:

  ```
  agntux_fetch_published_plugin({
    slug:        "agntux-{slug}",
    agntux_root: "{stage-0 agntux root}",
    session:     "{session-id}"        // the current build session
  })
  ```

  It downloads `plugins/agntux-{slug}/` from the public repo (default
  ref `main` = latest published) into
  `<agntux root>/.agntux-build/builds/{session-id}/agntux-{slug}/` and
  returns `{ build_path, version, files_written, … }`. Use `build_path`
  as the authoring base; dispatch `manifest-author`,
  `ingest-prompt-author`, `ui-handler-author` etc. pointed at those
  files rather than from `_template/`. **Do NOT read from a marketplace
  clone (`AUX-plugins/plugins/agntux-{slug}/`)** — most contributors
  don't have one, and even when they do it can be behind the published
  version. (A local clone is only a maintainer fast-path; the fetch is
  the contract.)

  Branch on the result:
  - **`ok:true`** → author the fix on `build_path`.
  - **`error_kind:"rate_limited"`** → GitHub throttled the read; tell the
    user to retry in a few minutes (or, if a local build of this slug
    exists under `.agntux-build/builds/*/`, fix that instead).
  - **`error_kind:"not_found"`** → the slug isn't on `main`, even though
    stage 1's marketplace lookup matched it. The lookup index can be
    stale (it warns it may be ~2 weeks behind), so you were likely
    mis-routed here for a plugin that hasn't actually merged. Handle it
    **here** — do NOT loop back through another fetch: if a local build
    of `agntux-{slug}` exists under
    `<agntux root>/.agntux-build/builds/*/agntux-{slug}/`, fix that
    (newest by lexical session sort) as a `:revise`-style in-review fix;
    if none exists, stop honestly ("`agntux-{slug}` isn't on `main` yet —
    if you just submitted it, finish that review first"). Never re-call
    `agntux_fetch_published_plugin` for the same slug in the same turn.
  - **`error_kind:"network"`** → offline; surface honestly and stop.

  **Never** fall back to prompting the user to pick a directory.

- **Version bump is patch by default, off the FETCHED version.** The
  user's fix is a fix — patch bump from `agntux_fetch_published_plugin`'s
  returned `version` (e.g. `0.7.1` → `0.7.2`), NOT from a stale local
  number. Bump minor only if the fix adds a capability (a new keyword
  for sync to catch, a new mode tab on the UI). Basing the bump on the
  fetched version prevents the regression where a stale local copy
  (`0.5.0`) bumps to `0.5.1` while the published plugin is already at
  `0.7.1`.
- **CHANGELOG entry uses `Fixed:` and the user's framing.** Don't
  copy the user's complaint verbatim — paraphrase it cleanly:
  > Fixed: @-mentions in private channels weren't surfacing as action
  > items because the channel discovery sweep skipped private channels.

## Stage 12 in update mode

The submission is a fix, not a new plugin, but it ships the same way:
finalize the tree in the synced location and drop the marker. Follow
12-submit.md's flow verbatim, with two update-mode differences in both
the signature and the marker:

- `mode: "update"`, and
- `previous_version: {old-version}` alongside `plugin_version:
  {new-version}`.

`CONTRIBUTING-SIGNATURE.md` carries the same `submission.mode: "update"`
and `submission.previous_version` fields, and the marker carries
`mode` + `previous_version` at top level, so the maintainer's intake
worker can match the fix to the existing plugin.

The same hard-require sync check (12-submit.md step e) applies — if the
AgntUX desktop app isn't running and signed in, write the marker but
don't claim the fix was submitted. There's no email and nothing for the
user to attach or send; the desktop app carries the fix to the team
automatically.

## What to thank the user for at the end

Update mode contributors are doing arguably *more* useful work than
new-plugin contributors — they're keeping a plugin in shape for
everyone else who's already using it. Close with:

> Thank you, {name}. `agntux-{slug}` will be a better plugin for the
> people already using it because of this fix. That's the whole point
> of doing this in the open.
