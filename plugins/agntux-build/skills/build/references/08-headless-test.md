# Stage 8 — final render check (now part of the validate tool)

The plugin is built. The user already iterated against the headed
host-renderer in stage 6, so the iframe shape is known good.

**The authoritative render now runs inside the validation tool.** Both
`agntux_validate` and `agntux_write_submission` (the submit gate, `12-submit.md`
step b.5) drive a headless screenshot pass per view tool **natively in the host
process** with real Chromium, as one stage of validation — there is no separate
Bash-driven render step to run here, and the model must NOT try to render via its
Bash sandbox (the restricted Linux sandbox has no Chromium; the three prior
submission attempts failed there).

So this stage is now a **short, optional, non-blocking preview**. The
regression-grade render is the one the validate tool performs at submit; running
a preview here is allowed but never required, and never gates advancement.

## What the render check is (for reference)

When the validate tool reaches its render stage it, per view tool:

- loads the view-tool bundle and drives Chromium to trigger the tool and wait
  for `tool-result`;
- captures `{ screenshot, logs, consoleErrors, structuredContent }`;
- treats any `consoleError`, a `renderState !== "tool-result"`, a
  structuredContent shape that drifts from the stage-5 schema, or a failed
  content check as a render failure.

The verdict surfaces as the `render` stage in `agntux_validate`'s `stages` (or in
`agntux_write_submission`'s internal re-validation). `render` may be
`{ status: "skipped", reason }` — most often because the renderer is still
**`installing`** (first-ever use self-installs Chromium in the background,
~1–2 min). A skipped render is **still `ok:true`**: validation passes, and the
render is folded in automatically on a later re-call once the renderer is
`ready`. There is nothing to install or probe by hand.

## What you say to the user

If you surface anything during this step, keep it to the one status line:

> Running render checks for {N} button(s)...

No "ready to install?" prompt. There is no pass/fail to narrate here — the render
result lives in the validate tool's verdict at submit. On a clean build, advance
silently to stage 9.5.

## On a render failure (surfaced by the validate tool at submit)

You do not self-fix renders in this stage anymore. If the validate tool reports a
`render` failure at submit time (`12-submit.md` / `07-build.md`), it comes back as
`failed_stage: "render"` in the tool verdict; route it per the stage-7
re-dispatch table (`executor`, model=sonnet) and re-call the validate/submit
tool. Do NOT hand-run a renderer or claim a render passed without the tool.

## Path forward

Advance to [`09a-onboarding-iterate.md`](09a-onboarding-iterate.md).
