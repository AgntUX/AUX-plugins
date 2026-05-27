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

- **Plugin source is the existing repo, not a fresh scaffold.** Read
  the existing plugin from
  `AUX-plugins/plugins/agntux-{slug}/` and treat that tree as the
  authoring base. Internally, dispatch
  `manifest-author`, `ingest-prompt-author`, `ui-handler-author` etc.
  pointed at the existing files rather than from `_template/`.
- **Version bump is patch by default.** The user's fix is a fix —
  patch bump (`0.1.0` → `0.1.1`). Bump minor only if the fix adds a
  capability (a new keyword for sync to catch, a new mode tab on the
  UI).
- **CHANGELOG entry uses `Fixed:` and the user's framing.** Don't
  copy the user's complaint verbatim — paraphrase it cleanly:
  > Fixed: @-mentions in private channels weren't surfacing as action
  > items because the channel discovery sweep skipped private channels.

## Stage 12 in update mode

The submission is a fix, not a new plugin. Use the **same Step A–C
draft mechanism as 12-submit.md** — draft through an installed AgntUX
email plugin's connector when one is available (Step B), else
convenience links + copy-paste (Step C). Only the subject and body
copy change; the same concise shape and the same parens-encode rule
apply.

Concise update body:

```
Subject: Update: agntux-{slug} v{new-version}

Hi AgntUX team,

Submitting a fix for agntux-{slug} (now v{new-version}, was v{old-version}).

Reported issue: {paraphrased-issue-summary}
Fix: {one-line summary of the change}

Contributor: {name} <{email}>
DCO: agreed to v1.1 on {date}

Signed-off-by: {name} <{email}>
```

Same guardrail as create mode: **no schema, dry-run, view-tool, or
payload detail** — the zip carries full detail; keep the body short so
the Step C links don't bloat.

The zip carries the same `CONTRIBUTING-SIGNATURE.md` shape as a new
plugin, with `submission.mode: "update"` and a
`submission.previous_version` field so the maintainer's intake script
can match the fix to an existing plugin.

## What to thank the user for at the end

Update mode contributors are doing arguably *more* useful work than
new-plugin contributors — they're keeping a plugin in shape for
everyone else who's already using it. Close with:

> Thank you, {name}. `agntux-{slug}` will be a better plugin for the
> people already using it because of this fix. That's the whole point
> of doing this in the open.
