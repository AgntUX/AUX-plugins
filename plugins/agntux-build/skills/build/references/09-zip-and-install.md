# Stage 9 — zip the plugin, hand the user an install path

The plugin builds. The action button renders. Now we hand it to the
user as a `.zip` they can install in Claude Desktop. This is the
first stage where the user has to do meaningful manual work — the
install dialog has eight clicks and we want to walk every one.

## Generate the zip

Build location:
```
<agntux project root>/.agntux-build/submissions/agntux-{slug}-v{version}.zip
```

The submissions directory is per-project-root (so a user with a work
AgntUX root and a personal one keeps them separated). Don't write
to `~/.agntux-build/` — the strategy is "identity follows the
project root."

Zip contents (mirror what's in `<repo-root>/AUX-plugins/plugins/
agntux-{slug}/` after stage 7's build):

```
agntux-{slug}/
├── .claude-plugin/plugin.json
├── LICENSE
├── NOTICE
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING-SIGNATURE.md      # NEW — written here in stage 12, but emit a placeholder now
├── marketplace/
│   ├── listing.yaml
│   ├── icon.png
│   └── screenshots/
├── skills/
│   └── {plugin-slug}/             # rendered ingest skill tree
│       ├── SKILL.md
│       ├── _overrides/
│       └── reference/
├── ui-handlers/                   # if write-capable
│   └── {handler-name}/
│       └── component/
│           └── out/               # bundled JS — already built by `build-plugin.mjs`
├── mcp-server/
│   └── dist/                      # already built
└── __tests__/
```

Use `node:fs/promises` to enumerate the build tree and a zip
library (the host typically has `archiver` or similar — fall back to
`zip` shell if needed).

`CONTRIBUTING-SIGNATURE.md` is a stage-9 placeholder; the real one
gets written in stage 12 with the submission timestamp.

## What you say to the user

> Your plugin is packaged at:
>
> **{absolute-zip-path}**
>
> Size: ~{N} MB.
>
> Now — and this is genuinely the most fiddly part of the flow —
> let's install it in Claude Desktop. There are eight clicks.
> Walking through them so nothing gets missed:

Then walk the install:

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

The walk is verbose on purpose. Don't condense — the user has never
done this before and skipped steps mean wasted time.

## Reveal the file in Finder/Explorer

If the host exposes a "show in folder" tool, open the
submissions directory so the user can grab the zip without
typing the path:

```
mcp__filesystem__open_in_explorer (or similar)
```

Resolve via `ToolSearch`. If unavailable, just print the absolute
path.

## Confirm the install worked

After the user says "done" or "installed":

> Got it — should now see `/agntux-{slug}` in your slash command
> picker in Cowork. Try typing `/agntux-{slug}` and see if it
> shows up.

If yes:

> Perfect. {Name}, you've installed your own plugin. Now we're
> going to test it against your real {connector-display-name} data
> — that's where the real iteration happens. Heads up: usually
> takes 3 to 5 rounds to get sync feeling right. That's normal,
> not a sign of failure.

Then load [`10-sync-iterate.md`](10-sync-iterate.md).

If the install failed (not in slash picker, or Claude Desktop
showed an error):

> Hmm — `/agntux-{slug}` isn't showing up. Few things to try:
>
> 1. Restart Claude Desktop (sometimes needed for new plugins).
> 2. Check Customize → Personal Plugins is the plugin actually
>    listed there?
> 3. If listed but greyed out, click it and check the error
>    message — paste back to me here.

Don't loop more than once. If the install keeps failing, redirect
to issues with the session file path linked.

## Saved state at end of stage 9

```json
{
  ...,
  "zip_path": "/Users/.../.agntux-build/submissions/agntux-linear-v0.1.0.zip",
  "zip_size_bytes": 2400000,
  "user_install_confirmed_at": "2026-05-08T..."
}
```

## What you do NOT do

- Don't try to install the zip programmatically — the host doesn't
  expose that path for personal plugins, and even if it did, the
  user needs to see the install flow once so they can update later.
- Don't fudge the path. Always show the absolute path so the user
  can drag-and-drop without confusion.
- Don't skip the confirm step. We need to know the plugin is live
  before stage 10 starts polling.
