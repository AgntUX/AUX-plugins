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

The AgntUX marketplace is the *only* registry that matters here.
Other Claude Code plugins (Anthropic-shipped, third-party) are out
of scope — even if a plugin called "Jira" exists somewhere else,
it's not an AgntUX plugin and won't ingest into the user's AgntUX
knowledge store.

Two sources, in order:

1. **Local first.** If `<repo-root>/AUX-plugins/marketplace/index.json`
   exists on the user's machine (developer setup), read it.
2. **Public fallback.** Otherwise fetch
   `https://raw.githubusercontent.com/AgntUX/AUX-plugins/main/marketplace/index.json`
   via `WebFetch`. This is CI-regenerated on every merge to `main`
   and is the canonical "what AgntUX plugins exist today" answer.

Do NOT reach for `mcp__plugins__list_plugins`, `ToolSearch query:
"list plugins"`, or any other host-level plugin discovery — those
enumerate the host's full plugin universe (all marketplaces) and
will produce false negatives ("nothing called agntux-jira") that
are really false positives ("the host knows about non-AgntUX
Atlassian plugins, but they don't ingest into AgntUX").

## How to match

Match against entries in `marketplace/index.json` only — every
AgntUX plugin's slug starts with `agntux-`, and the keyword /
tagline scope is bounded by that file. Search both:

1. **Slug match.** If `agntux-{guessed-slug}` appears in the index,
   that's a hit (e.g., `agntux-linear` for `Linear`).
2. **Keyword match.** If the user's input appears in any plugin's
   `keywords[]` or `tagline` *within `marketplace/index.json`*,
   that's a softer hit. Common alias cases: `gh` →
   `agntux-github`, `gcal` → `agntux-google-calendar`,
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

  If yes, render the install card for the matched AgntUX plugin via
  Cowork's plugin-suggest tool. **The pluginId comes from the
  `marketplace/index.json` entry you just matched** — never from a
  host-wide plugin search, which would broaden the scope past AgntUX:

  1. Resolve the tool:
     `ToolSearch({query: "select:mcp__plugins__suggest_plugin_install", max_results: 1})`.
  2. On resolve, call with the matched entry only:
     ```
     mcp__plugins__suggest_plugin_install({
       plugins: [{
         pluginId: "agntux-{slug}",
         pluginName: "agntux-{slug}",
         description: "{tagline-from-marketplace-index-json}"
       }],
       contextLabel: "Already in the AgntUX marketplace"
     })
     ```
  3. On no resolve (non-Cowork host), fall back to the prior prose
     path: tell the user the slug to install manually and link
     `https://github.com/AgntUX/AUX-plugins/tree/main/plugins/agntux-{slug}`.

  After the install card renders (or the manual path is acknowledged),
  thank the user and stop:

  > That's installed. Run `/agntux onboard` if you haven't already —
  > that'll walk through how {connector-display-name} fits into your
  > AgntUX setup. Thanks for the nudge — you saved us building a
  > duplicate.

- **"Yes, but it's not working / I want to fix it."** Switch to
  update mode. Load
  [`update-mode.md`](update-mode.md) and continue from
  there. The same stages 3–10 apply, but stage 12 frames the
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
