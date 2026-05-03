---
name: agntux-onboard
description: First-run setup AND re-entry for AgntUX. On a fresh `user.md`, walks the discovery interview, bootstraps the schema, then runs per-plugin onboarding for every connected source. On a re-entry (`user.md` already present), scans for newly installed plugins (any `.proposed` contract or installed plugin lacking an instructions file) and walks the per-plugin onboarding only — the user interview is NOT redone unless they explicitly say "redo from scratch". Use when the user says "onboard me", "set me up", "get started with AgntUX", "I added a new plugin", "walk me through new sources".
---

# `/agntux-onboard` — first-run interview AND new-plugin walkthrough

Lane: full onboarding from a clean slate, OR a focused walkthrough
of newly installed plugins after first-run is already complete.

## Opening message

Greet the user briefly: "Welcome to AgntUX — let's get you set up."
Then hand off to personalization Mode A immediately. Do NOT narrate
prerequisite checks, do NOT mention "subagents" / "modes" /
"orchestrator" / "dispatch". The user is talking to AgntUX as a
single voice. Stage 0 of personalization handles project-root
resolution; you do not pre-empt it.

## Voice rules

Speak as a single AgntUX voice to the user throughout. Never
reference internal architecture: do NOT mention "subagent",
"dispatch", "Mode A / A-bis / B / C / D", "orchestrator", "transcribe",
"I'll hand this to", "I'll engage", or any internal phase or
sub-component. Internal phase transitions are silent. The user does
not need to know how the work is divided internally.

## Schema-drift preflight

This skill explicitly does NOT run [`_preflight.md`](../_preflight.md)
because its dispatch flow handles `.proposed` files end-to-end (the
per-plugin walkthrough invokes architect Mode B per plugin). Emitting
a separate "📐 N awaiting schema review" nudge would be redundant and
potentially confusing mid-flow.

It DOES check the `schema-requests.md` queue once at the top of the
turn:

- Read `<agntux project root>/data/schema-requests.md` if it exists — if any
  non-blank lines, emit: "📐 {N} pending schema change request{s}.
  Run `/agntux-schema edit` when convenient." Do not block.

## Pre-checks

This skill is dual-purpose — first-run AND re-entry. A missing
`user.md` triggers first-run; an existing `user.md` triggers
re-entry. Run only these guards:

1. **Trial banner** — emit per [`_preconditions.md`](../_preconditions.md)
   § A (Trial-status banner). For brand-new users with no license
   cache yet the banner is silent; for returning trial users it
   fires.

2. **Project root** — do NOT short-circuit on a missing `agntux` folder.
   Hand off to personalization Mode A immediately so Stage 0 can resolve
   the project root. Stage 0 covers all cases: cwd is `agntux`, an
   ancestor is `agntux`, a candidate exists elsewhere under `~/`, or no
   `agntux` directory exists at all (in which case Stage 0 offers to
   `mkdir ~/agntux` and instructs the user to select it via the host
   picker).

3. **DO NOT run `_preconditions.md` checks 2, 3, or 4** here. This
   skill's dispatch (below) handles schema bootstrap, `.proposed`
   contract review, and queued schema-requests inline as part of the
   normal onboarding flow. Running those preconditions would
   short-circuit the flow with a redirect. **DO run check 0.5 (plugin
   reconciliation)** — it auto-syncs `## Installed` from the host's
   `mcp__plugins__list_plugins` tool and seeds Mode A-bis's Set 2 with
   any plugin the user has installed but not yet onboarded. This is the
   primary auto-trigger for onboarding newly-installed plugins; the user
   doesn't have to remember `/agntux-onboard` because every `/agntux-*`
   command runs the same reconciliation and emits a nudge.

4. **`user.md` already exists?**

   - **Default (re-entry)**: dispatch personalization in **Mode A-bis**
     (new-plugins walkthrough only). Do NOT re-walk discovery, identity,
     preferences, etc. — the user did those already. Mode A-bis scans
     for the union of three sets (see personalization.md Mode A-bis):
     plugins with `.proposed` contracts, installed plugins lacking an
     instructions file, and plugins with `status: draft` instructions
     (interrupted onboarding). It runs the per-plugin onboarding for
     each.
   - **Override (only on explicit user signal)**: if the user said
     "redo onboarding from scratch" / "start over completely" /
     "rewrite my profile", confirm once: "This will rewrite your
     entire profile and schema from scratch — proceed? Or did you
     mean `/agntux-profile` (edit existing) or `/agntux-schema`
     (review the tenant schema)?". Wait for explicit yes before
     dispatching Mode A.

## Dispatch

### First-run (`user.md` missing)

1. Engage the **personalization** subagent in **Mode A** (first-run
   interview). It walks Stage 0 (project root) → Stage 0.5 (open-ended
   discovery, with explicit `discovery_summary` confirmation) → Stage
   1 (identity with timezone auto-detect) → Stage 1.5 (people,
   conditional) → Stage 2 (responsibilities) → Stage 2.5 (day-to-day
   / aspirations / goals) → Stage 3 (preferences) → Stage 4
   (glossary) → Stage 4.5 (sources, populated from discovery) →
   Stage 4.6 (plugins) → Stage 5 (finalize) and writes
   `<agntux project root>/user.md` end-to-end.

2. **Stage 5.5 (architect Mode A — schema bootstrap).** After
   `user.md` is finalized, personalization dispatches the
   **data-architect** subagent in **Mode A**. The architect reads
   `discovery_summary`, `# Discovery`, and the rest of `user.md`,
   synthesises a custom starter schema using
   `data/schema-design-rubric.md`, walks the user through a
   plain-language approve/edit, and writes `data/schema/` files. This
   step is mandatory — the per-plugin onboarding below cannot
   dispatch architect Mode B without the schema existing.

3. **Plugin suggestions** (drawn from `data/plugin-suggestions.json`
   plus discovery context).

4. **Connect-your-sources gate** — prompts the user to authorize
   connectors in **Customize → Connectors** and waits for "ready".

5. On "ready", personalization enumerates connected plugins (union of
   `# AgntUX plugins → ## Installed` and any `.proposed` contracts on
   disk) and runs the **Per-plugin onboarding interview** for each:
   - Stub `<agntux project root>/data/instructions/{plugin-slug}.md` with
     `status: draft` first.
   - Ask up to 5 plain-language questions.
   - Capture answers into the instructions file; flip
     `status: draft → final`.
   - Dispatch **data-architect Mode B** for that plugin's `.proposed`
     contract (if one exists) — the architect reads the freshly
     written instructions file alongside the proposal, then deletes
     the `.proposed` file via `rm -f`.

6. After all per-plugin onboarding completes, personalization runs
   the **Per-source scheduled-task walkthrough** (manual scheduled
   task creation per plugin) and the **Deterministic wrap-up**
   (state machine: A — fully set up / B — connectors connected, no
   ingests fired yet / C — partial / D — no plugins connected) with
   an actionable next step.

### Re-entry (`user.md` exists, default path)

1. Engage the **personalization** subagent in **Mode A-bis**
   (new-plugins walkthrough). It computes the set of plugins needing
   onboarding = (plugins with a `.proposed` contract) ∪ (installed
   plugins lacking a `data/instructions/{slug}.md` file). If the set
   is empty, it tells the user there's nothing to do and exits.

2. For each plugin in the set, Mode A-bis runs the same per-plugin
   onboarding interview as first-run — stub draft, ≤5 questions,
   finalize, dispatch architect Mode B.

3. Mode A-bis then runs the per-source scheduled-task walkthrough
   for the new plugins only, then the deterministic wrap-up.

The user interview (discovery, identity, preferences) is NEVER
re-run on a re-entry. Only the explicit "redo from scratch" override
re-runs Mode A.

## Out of scope

Schema review/edit (`/agntux-schema`), profile edits to an existing
`user.md` (`/agntux-profile`), retrieval queries (`/agntux-triage`
or `/agntux-ask`), per-plugin instruction edits after onboarding
completes (`/agntux-teach {slug}`).
