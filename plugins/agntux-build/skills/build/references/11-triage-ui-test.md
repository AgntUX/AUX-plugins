# Stage 11 — test the action button in the real triage UI

The sync flow's good. Now we test the action button against an
action item that just came out of stage 10's sync, in the real
AgntUX triage UI. The headless test in stage 8 caught render bugs;
this catches behavioural ones — does the Send actually fire, does
the source-side write land correctly, does the action item resolve.

## Set the expectation

> One last quick test. Open your **AgntUX triage UI**, find an
> action item from this plugin (you should have a few from
> {connector-display-name} after the sync rounds), and click the
> "{verb-phrase}" button.
>
> The action button is the same iframe we previewed earlier — it'll
> open inline with a draft. Edit if you want, hit Send.
>
> Tell me what happens — did the source-side write actually land?
> {connector-display-name} should show your {comment / reply /
> transition / etc.} immediately.

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

Cap at 2 iterations. The action button's behaviour is mostly
mechanical wiring — if it's wrong twice, escalate to issues.
Stage 11 isn't a deep prompt-engineering loop like stage 10.

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
  "triage_test_iterations": 1,
  "triage_test_passed_at": "2026-05-08T...",
  "verified_source_side_write": true
}
```
