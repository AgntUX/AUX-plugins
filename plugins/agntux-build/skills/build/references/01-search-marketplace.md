# Stage 1 — greet, capture intent, search the marketplace

Stage 1 has three parts that run in one chat turn each:

1. **Greet.** Use the contributor's name from stage 0 if this is a
   re-entry; first sentence is a thank-you for choosing to contribute.
2. **Capture intent.** Ask the one question that frames everything
   downstream — what system the user wants AgntUX to support.
3. **Search the marketplace** for an existing plugin and branch on
   the result.

Building a duplicate is the worst possible outcome — it splits
maintenance, confuses users, and wastes the contributor's time. The
search-first rule is non-negotiable; never skip it even if the user
seems certain no plugin exists.

## Greet

If stage 0 just ran (first session in this AgntUX root), the user
just typed `I agree` — open with appreciation:

> Thanks, {name}. Now we get to build something.

If stage 0 was already done (re-entry on a later day), open with
recognition that they're back:

> Welcome back, {name}.

Don't pad the greet — one sentence is enough.

## Capture intent

Ask exactly one question:

> What system would you like AgntUX to support?

Parse the answer for:

- **The display name** ("Linear", "Notion", "a new project tracker
  called Height").
- **The slug you'll use.** Lowercase, hyphen-separated, must match
  `/^[a-z][a-z0-9-]*[a-z0-9]$/`. Drop spaces ("Apple Mail" →
  `apple-mail`), version digits in the middle ("Things 3" →
  `things3`), branding noise.

Confirm both before searching:

> Got it — `agntux-{slug}` for {display-name}. Sound right?

If they correct you, accept the correction; never argue about
spelling or naming.

## Search the marketplace

## Where to look

`<repo-root>/marketplace/index.json` is a CI-regenerated read-only
aggregate of every `listing.yaml` in the marketplace. It's the
canonical source for "which plugins exist." Read it from the
`AUX-plugins/marketplace/index.json` path that the marketplace
plugin's source pulls from.

You can also use the host's plugin tools:

1. Load the host's plugin discovery tool with `ToolSearch` —
   `mcp__plugins__list_plugins` is the typical name (the same tool
   `agntux-core`'s `_preconditions.md` check 0.5 uses). The exact
   name may shift between hosts; resolve by querying with
   `query: "list plugins"`. If the host doesn't expose a listing
   tool, fall back to reading `marketplace/index.json` directly.

## How to match

Search both:

1. **Slug match.** If `agntux-{guessed-slug}` appears in the index,
   that's a hit (e.g., `agntux-linear` for `Linear`).
2. **Keyword match.** If the user's input appears in any plugin's
   `keywords[]` or `tagline`, that's a softer hit. Common alias cases:
   `gh` → `agntux-github`, `gcal` → `agntux-google-calendar`,
   `mail` → `agntux-gmail`.

## Three branches

### 1. Exact slug match

The plugin already exists. Tell the user, then ask:

> Looks like there's already a plugin for {connector-display-name} —
> `agntux-{slug}`. Have you tried it before?

Branch on the answer:

- **"No, I didn't know."** Offer to install:

  > Want me to install it for you? It'll handle
  > {connector-display-name} the same way agntux-slack handles Slack
  > — every {polling-cadence-from-listing-yaml}, with the same triage
  > flow.

  If yes, dispatch the host's plugin install tool (resolve the name
  via ToolSearch — typical names are `mcp__plugins__install_plugin` or
  similar). After install, thank the user and stop:

  > That's installed. Run `/agntux onboard` if you haven't already —
  > that'll walk through how {connector-display-name} fits into your
  > AgntUX setup. Thanks for the nudge — you saved us building a
  > duplicate.

- **"Yes, but it's not working / I want to fix it."** Switch to
  update mode. Load
  [`update-mode.md`](update-mode.md) and continue from
  there. The same stages 3–11 apply, but stage 12 frames the
  submission as a fix to the existing plugin.

### 2. Keyword / soft match

A related plugin exists but doesn't exactly match. Tell the user
what we found and ask whether it's the same system:

> I see there's `agntux-{related-slug}` in the marketplace —
> {tagline-from-listing-yaml}. Is that the same system you mean, or
> is {user's-input} something different?

If same: treat as branch 1. If different: continue to branch 3.

### 3. No match

> Nothing in the marketplace yet. Let's build a new plugin for
> {connector-display-name}.

Confirm the slug you'll use (lowercase, hyphen-separated, must start
with `agntux-`):

> The plugin will be named `agntux-{slug}`. Sound right?

Once confirmed, load
[`02-install-or-improve.md`](02-install-or-improve.md) (which is
mostly a no-op when there's nothing to install — it's the
update-mode entry point).

## Slug rules (reference — already enforced during intent capture above)

- Always prefixed `agntux-`.
- Source slug after the prefix: lowercase, alphanumeric, hyphens.
- Length: 3–30 chars after the prefix.
- Must match `/^[a-z][a-z0-9-]*[a-z0-9]$/`.
- Don't use the connector's marketing name verbatim if it has spaces
  or punctuation. `Things 3` → `things3`. `Bear Notes` → `bear`.
  `Apple Mail` → `apple-mail`.

## What you save before moving on

To `<agntux project root>/.agntux-build/sessions/{session-id}.json`:

```json
{
  "connector_display_name": "Linear",
  "connector_slug": "linear",
  "plugin_slug": "agntux-linear",
  "mode": "create"
}
```

(Or `"mode": "update"` if branch 1 sent us into update mode.)

## What you say to advance

> Great — let's get connected to {connector-display-name} so we can
> see what it can do.

Then load [`03-connect-source.md`](03-connect-source.md).
