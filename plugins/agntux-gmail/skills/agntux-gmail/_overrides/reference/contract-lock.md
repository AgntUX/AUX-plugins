# Gmail schema-lock check — Step 0 routing

Companion to `../SKILL.md` Step 0. Gmail-specific defensive lock check
that mirrors the validator's `schema.lock.json` lookup so the skill
can fail fast — without writing — when `plugin_contracts["agntux-gmail"]`
is missing or version-drifted.

## Authority boundary (load-bearing)

This file is **exit-clean**. It MUST NOT write to
`<agntux project root>/data/schema/` under any circumstance —
including the previously-permitted "interactive self-heal" path.
Schema-lock authoring is owned by the data architect's `/agntux
schema` flow (Mode B). The autonomy-boundary rule in
`./sync.md → "Out of scope"` is the load-bearing source; the
agntux-core hook `validate-write-lane.mjs` enforces it server-side
even if this prose drifts.

## Read order

After the canonical Step 0 sub-steps 1–4 have parsed the contract
markdown, read `<agntux project root>/data/schema/schema.lock.json`
and look up `plugin_contracts["agntux-gmail"]`. Three outcomes:

1. **Present and version-aligned** with the contract markdown
   (`schema_version` matches; `allowed_subtypes` and
   `allowed_action_classes` cover the contract's vocabulary) → pass.
   Continue to sub-step 5.

2. **Missing entirely** (contract markdown exists at
   `data/schema/contracts/agntux-gmail.md` but no
   `plugin_contracts["agntux-gmail"]` key in the lock):
   - Append a `kind: contract-not-registered` entry to
     `sync.md → errors` — payload `"agntux-gmail contract markdown
     present but schema.lock.json is missing the
     plugin_contracts key — run /agntux schema to register"`.
   - Exit cleanly with no user-facing message (scheduled fire) or
     the one-line `agntux-gmail pre-flight: contract not yet
     registered in schema.lock; run /agntux schema and re-fire.`
     (interactive). Step 11's transactional rule applies: cursor
     and run-stats stay at their pre-run values.

3. **Present but version-drifted** (lock entry's `schema_version`
   lags the contract markdown's, OR `allowed_subtypes` /
   `allowed_action_classes` diverge):
   - Append a `kind: contract-version-drift` entry to
     `sync.md → errors` — payload should name the drifted field
     (e.g., `"schema_version: contract=1.1.0, lock=1.0.0"`).
   - Exit cleanly with the same shape as outcome 2.

In neither case does this skill touch `schema.lock.json`. The
data architect's Mode B sweep (`/agntux schema`) reads the
`contract-version-drift` / `contract-not-registered` entries on the
next interactive AgntUX session and updates the lock. The next
scheduled run picks up clean.

## Why no inline self-heal

Two reasons, both load-bearing:

1. **Authority.** `data/schema/` is architect territory. The
   ingest skill's permitted write lanes are `entities/`, `actions/`,
   and `data/learnings/{plugin-slug}/`. Writing to `data/schema/`
   from this skill violates the canonical "Out of scope" rule and
   is refused at the hook layer.
2. **Atomicity.** A self-heal that runs concurrently with another
   plugin's sync (or with `/agntux schema` itself) would race on
   `schema.lock.json` with no lock around it. The architect flow
   has the soft lock and the user's eyes; the ingest skill has
   neither.

Mode B fast-path mirroring is documented as a future opt-in if it
proves load-bearing — it is not the current design.
