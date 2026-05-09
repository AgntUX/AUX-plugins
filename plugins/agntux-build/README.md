# AgntUX Build

Build a new AgntUX plugin for a system AgntUX doesn't yet support.

If AgntUX doesn't yet cover the tool you live in — your project tracker,
your CRM, your notes app, your meeting recorder — this plugin walks you
through making one. You don't need to be a developer. You need an hour,
your laptop, and a willingness to test the new plugin against your real
data three to five times until it feels right.

## What it does

`/agntux-build:build` opens a guided flow that:

1. Asks what system you'd like to support.
2. Searches the marketplace first — if there's already a plugin for it,
   we install that one rather than build a duplicate. If you've used
   that plugin before and hit something specific, we switch into "fix
   mode" and walk the same flow with a smaller scope.
3. Connects to the system through your AgntUX host's connector tools.
4. Looks at what the connector can do and translates that into plain
   language — "here's what your new plugin will be able to read, and
   here's the one button people will press to take action."
5. Designs the action button's screen with you. Previews it inline. We
   only do **light mode** with the standard AgntUX colours and spacing,
   so every plugin in the marketplace feels like part of the same
   product. If something feels off about that rule, we'll point you at
   the issues page.
6. Builds the plugin.
7. Tests the new screen on your machine — no extra apps to start,
   nothing to install separately.
8. Hands you a `.zip` and walks you through installing it in
   Claude Desktop.
9. Iterates with you using the **real** sync output from your system —
   you run the plugin in Cowork, paste the run back to Claude Code,
   we read it, edit the prompts, regenerate the zip, and you re-run.
   This usually takes 3 to 5 rounds. That's normal — not a sign of
   failure.
10. When the sync feels right and the action button works, packages
    the final zip with a Developer Certificate of Origin sign-off and
    hands you a pre-filled email to `plugins@agntux.ai`.

## What you get

The result is a real Claude Code plugin you can use yourself, and that
your contribution helps every other AgntUX user who needs the same
system. The voice of the plugin matches the rest of AgntUX. The action
button uses the same look as Slack and Gmail. The sync schedule is
sensible for what your system needs.

## What you need

- An AgntUX project root (any directory named `agntux` —
  `~/agntux`, a Drive folder, a work-vs-personal split, whatever).
  If you've used AgntUX before, you already have one.
- The system's connector available in your host. If it's a popular
  service (Linear, Notion, GitHub, Jira, etc.), the connector is
  almost certainly in the host's connector marketplace.
- Claude Desktop, Cowork, and Claude Code installed.
- About an hour, plus the patience to run the new plugin three to
  five times and paste the output back.

## How to start

```
/agntux-build:build
```

The first time you run it, we'll ask for your real legal name and
email and walk you through the [Developer Certificate of
Origin](https://developercertificate.org/). It's the standard
agreement open-source projects use to confirm that the work you're
contributing is yours to give. Read it once — it's short — and we
won't ask again unless the agreement changes.

After that, just describe the system you want covered and we'll take
it from there.

## Voice

`agntux-build` is intentionally written for knowledge workers, not
engineers. You will never see the words "schema", "render pipeline",
"validator", "byte-freeze", "dispatch", or any other internal term.
You're contributing time to AgntUX users you'll never meet — every
milestone gets a thank-you. If you push back on a design rule, we
redirect you to the issues page rather than caving — the standards
are non-negotiable so plugins feel coherent, not because we're being
stubborn.

## If you're a maintainer

The maintainer-side runbooks (PR review, rollback, kill-switch,
canonical-hook updates, secret rotation) live in the separate
`agntux-plugin-dev` repo, not here. This plugin is for end users
extending the marketplace.

## Issues, feedback, ideas

`https://github.com/AgntUX/AUX-plugins/issues` —
file under the `agntux-build` label.

## License

Apache License 2.0.
