# Stage 11 — install the plugin, test action buttons in the real triage UI

The sync flow's good. Now we test the action buttons against
action items that just came out of stage 10's sync, in the real
AgntUX triage UI. The headless test in stage 8 caught render bugs;
this catches behavioural ones — does the Send actually fire, does
the source-side write land correctly, does the action item resolve.

**This is the first stage that requires the plugin to be installed.**
Stages 9.5 and 10 ran inline against on-disk files, but the triage UI
test exercises the host's real action-button routing — that only works
once the plugin is installed in Cowork.

## Regenerate and install

The zip dropped in Downloads at stage 9 is stale by now (stage 10
iterated prompts). Re-zip first so the install reflects the latest:

1. **Bump the patch version FIRST.** Edit
   `plugins/agntux-{slug}/.claude-plugin/plugin.json` (e.g.
   `0.1.0` → `0.1.1`) and add a matching `CHANGELOG.md` entry. The
   linter rejects mismatches, so do both together.
2. Re-run `node scripts/build-plugin.mjs agntux-{slug}` so the rendered
   skill tree and any UI bundle changes land in the dist tree.
3. Re-zip into `~/Downloads/agntux-{slug}-v{new-version}.zip`.

**Fail closed if the version didn't bump.** The zip filename includes
the version, so writing to `agntux-{slug}-v{old-version}.zip` would
silently overwrite the snapshot stage 9 dropped — breaking the paper
trail the user relies on. Before opening the writer, confirm:

- The new version in `plugin.json` is strictly greater than the version
  embedded in `zip_path` from the saved session state (compare via
  semver).
- If they're equal, stop and bump again — don't write.

If for some reason a bump can't happen (rare; only if stage 10 made no
prompt edits at all), fall back to a non-colliding filename:

```
~/Downloads/agntux-{slug}-v{version}-iter{N}.zip
```

where `{N}` is `sync_iteration_count` from saved state. Document this
in the saved-state's `post_iteration_zip_path` field so stage 12 picks
the right artifact for the final submission.

Then walk the user through install (eight clicks, verbose on purpose —
the user has never done this before):

> {Name}, time to install the plugin. There are eight clicks. Walking
> through them so nothing gets missed:
>
> 1. Open **Claude Desktop**.
> 2. Click the gear icon (top-right) → **Customize**.
> 3. Find **Personal Plugins** in the left sidebar.
> 4. Click the **+** button next to Personal Plugins.
> 5. Hover over **Create plugin** → click it.
> 6. Click **Upload plugin**.
> 7. Drag the `.zip` from {zip-path} into the upload area, or click
>    Browse and select it.
> 8. Click the **+** button to install.
>
> Tell me when it's installed and I'll keep going.

After the user confirms install:

> Got it — should now see `/agntux-{slug}` in your slash command
> picker in Cowork. Try typing `/agntux-{slug}` and see if it
> shows up.

If install fails (not in slash picker, or Claude Desktop showed an
error):

> Hmm — `/agntux-{slug}` isn't showing up. Few things to try:
>
> 1. Restart Claude Desktop (sometimes needed for new plugins).
> 2. Check Customize → Personal Plugins — is the plugin actually
>    listed there?
> 3. If listed but greyed out, click it and check the error
>    message — paste back to me here.

Don't loop more than once. If install keeps failing, redirect to
issues with the session file path linked.

## Set the expectation

> One last quick test. Open your **AgntUX triage UI**, find an
> action item from this plugin (you should have a few from
> {connector-display-name} after the sync rounds), and click whichever
> action button shows up — could be any of: {comma-list of verb phrases}.
>
> The button opens the same iframe we previewed earlier — inline,
> with a draft. Edit if you want, hit Send.
>
> Tell me what happens — did the source-side write actually land?
> {connector-display-name} should show your {comment / reply /
> transition / etc.} immediately.
>
> If you have multiple action items, try a couple — different
> action items will surface different buttons.

## What can go wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Button doesn't appear on action items | view tool descriptor not advertising the action; `_meta.ui.resourceUri` missing | re-run `manifest-author` for the view tool |
| Button opens but iframe is blank | bundle path wrong, or CSP blocking the load | re-run `ui-handler-author`'s embed step |
| Iframe opens but Send is greyed | required structuredContent field missing | re-run the field plumbing |
| Send fires but nothing happens at the source | envelope's connector targeting is wrong | check the `connector_slug` in the envelope; redirect to source-semantics |
| Send fires but source returns auth error | connector lost auth between stages 3 and now | redirect user to host's connector page |
| Source-side write lands but action item stays in triage | post-send acknowledgment not writing the resolution | check the action file's `## Outcome` write |

For each, translate to plain language:

> Looks like the button isn't appearing on action items — usually
> means the metadata that tells AgntUX "this action has a button"
> didn't get wired in. I'll fix that.

## Iteration cadence

Cap at 2 iterations. Each button's behaviour is mostly mechanical
wiring — if it's wrong twice, escalate to issues. Stage 11 isn't a
deep prompt-engineering loop like stage 10.

## When it works

> {Name}, that's a real source-side write from a button you
> designed. The plugin is doing its job. Last step — packaging
> this for the AgntUX team.

Advance to [`12-submit.md`](12-submit.md).

## What you do NOT do

- Don't run the headless test again — that already passed in
  stage 8. The triage test is checking real-system behaviour.
- Don't try to fix multiple things in one round. Pick the most
  load-bearing issue, fix it, re-test.
- Don't ask the user to read connector-side response payloads.
  Translate.
- Don't skip stage 11 even if stage 10 went smoothly. Real
  source-side writes are a different code path than reads.

## Saved state at end of stage 11

```json
{
  ...,
  "post_iteration_zip_path": "/Users/.../Downloads/agntux-linear-v0.1.1.zip",
  "user_install_confirmed_at": "2026-05-08T...",
  "triage_test_iterations": 1,
  "triage_test_passed_at": "2026-05-08T...",
  "verified_source_side_write": true
}
```
