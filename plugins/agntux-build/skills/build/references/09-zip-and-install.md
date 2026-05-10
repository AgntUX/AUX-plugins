# Stage 9 — package the plugin, drop a snapshot in Downloads

The plugin builds. The action buttons render. Now we package it as a
`.zip` in the user's Downloads folder. **No install required at this
point** — stages 9.5 and 10 drive onboarding and sync iteration inline,
so the zip is just a snapshot the user can come back to.

The first install walk happens at stage 11 (triage UI test), with the
final regenerated zip going out at stage 12 (submission).

## Generate the zip

Build location (cross-platform — pick the first that resolves):

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

The version is part of the filename, so accumulating a paper trail in
Downloads is a feature — the user keeps every snapshot side-by-side.

Don't write to `<agntux-root>/.agntux-build/submissions/` (the previous
location). It's a dot-folder and most users can't easily browse there;
session state still lives at `<agntux-root>/.agntux-build/sessions/` but
the user-facing zip belongs in Downloads.

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
> No need to install it yet — we're going to iterate on the prompts
> in this same chat for the next few rounds, then re-zip at the end.
> The Downloads copy is your snapshot in case you want to look at it.

## Reveal the file in Finder/Explorer (optional)

If the user wants to see the file, and the host exposes a
"show in folder" tool, open Downloads:

```
mcp__filesystem__open_in_explorer (or similar)
```

Resolve via `ToolSearch`. If unavailable, just leave the path printed.

## Pass through to onboarding (stage 9.5)

Once the zip is on disk:

> Right — let's test the onboarding flow first, then we'll run sync
> against your real {connector-display-name} data.

Then load [`09a-onboarding-iterate.md`](09a-onboarding-iterate.md).

(Stage 9.5 walks the user through the plugin's own onboarding flow —
personalisation values that the sync skill needs to feel right.
After 9.5, stage 10 picks up.)

## Saved state at end of stage 9

```json
{
  ...,
  "zip_path": "/Users/.../Downloads/agntux-linear-v0.1.0.zip",
  "zip_size_bytes": 2400000,
  "zip_generated_at": "2026-05-08T..."
}
```

(Note: no `user_install_confirmed_at` here. That field moves to
stage 11, where install is first required.)

## What you do NOT do

- Don't walk the install flow here. Stage 10's iteration is inline —
  the user doesn't need an installed plugin to test it. Walking install
  prematurely creates a stale install (no iterated prompts yet) and
  risks the user testing the wrong version.
- Don't try to install the zip programmatically anywhere — the host
  doesn't expose that path for personal plugins.
- Don't fudge the path. Always show the absolute path.
- Don't write to `~/.agntux-build/` or any dot-folder for the
  user-facing zip. Downloads only.
