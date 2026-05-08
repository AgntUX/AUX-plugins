# Gmail sender denylist — Step 11 sub-step 5 procedure

Companion to `../SKILL.md` Step 11. Gmail-only auto-learn step that
appends senders to `data/instructions/agntux-gmail.md → # Sender denylist`
when they get noise-filtered repeatedly within a single run.

## When this runs

After cursor advance + lock release in Step 11, walk the working-memory
`noise_drop_counts` map populated by Step 8 (sender email → number of
messages skipped this run). For each sender with **≥3 dropped messages
this run**, decide whether to denylist them per the gates below.

**Two precondition checks** (skip auto-learn entirely on either):

1. **File missing.** If `data/instructions/agntux-gmail.md` does not
   exist, skip the entire sub-step. The instructions file is created
   by `/agntux onboard`'s per-plugin onboarding; without it the plugin
   hasn't been onboarded and this skill MUST NOT author it.
2. **Section missing.** If the file exists but lacks a `# Sender denylist`
   section header, skip auto-learn for this run and append a
   `kind: gmail-denylist-section-missing` entry to `sync.md → errors`.
   Do **NOT** author the section header — the autonomy-boundary rule
   in `./sync.md → "Out of scope"` puts `data/instructions/` under
   `/agntux teach` ownership exclusively. The user invokes
   `/agntux teach` to add the section; auto-learn activates on the
   next run after the section is present. PR #4's
   `validate-write-lane.mjs` enforces refusal at the hook layer if
   this prose drifts.

## Gates (all must pass before auto-add)

1. **Recently-active gate.** Skip the auto-add if the sender's bare
   email appears anywhere under `<agntux project root>/actions/`
   (grep recursively across `actions/*.md`, with the bare email as
   the literal pattern). Any open or recently-resolved action
   mentioning the sender is a signal the user cares about them — do
   NOT denylist.
2. **Already-denylisted gate.** If the sender's bare email already
   appears in `# Sender denylist` (with or without `<!-- added: -->`
   metadata), skip — the entry exists; do not duplicate.
3. **Always-raise gate.** If the sender matches a `# Always raise`
   `from:` predicate, skip — `# Always raise` is the user's most
   explicit instruction and overrides the denylist.

## Append + slice

Append the new line (newest at top of the section, NOT bottom — the
eviction rule below operates from the bottom up):

```
- <sender-email>  <!-- added: YYYY-MM-DD, dropped: N -->
```

After appending, slice the section so it carries no more than
**30 entries** total. Evict from the bottom (oldest first), but
ONLY entries whose comment metadata contains `added:` (auto-added).
Entries without `added:` metadata are user-curated and never
auto-evicted, even if doing so would push the section above 30.
(In the rare case where 30+ entries are user-curated, the cap is
breached and the next run logs a
`gmail-denylist-cap-breached-by-user-entries` entry to `sync.md →
errors` per the kind: taxonomy in `./runbook.md`.)

Atomic write (temp + rename).

## Untouchable sections

The skill MUST NOT touch any other section of the instructions file
(`# Always raise`, `# Never raise`, `# Rewrites`, `# Notes` are user
territory). The skill MUST NOT create the instructions file from
scratch and MUST NOT create the `# Sender denylist` section header —
the precondition checks above gate both.

Auto-author scope is **entry rows within an existing
`# Sender denylist` section**, distinguished from user-curated rows by
the `<!-- added: YYYY-MM-DD, dropped: N -->` metadata trailer. Rows
without the metadata trailer are user-curated and never auto-evicted.

## How Step 8 populates the counter

Whenever Step 8 skips a thread on a sender-derived rule (`noreply@`
family, `*-bounces@`, `mailer-daemon@`, or any sender that slipped
through the query-layer category exclusion), it increments
`noise_drop_counts[<sender-email>]` keyed by the bare sender address
(applying the same `<([^>]+)>` extraction as Step 5b).

Do NOT track drops attributable to `# Never raise` rules (those are
user-curated and need no learning) or to thread-level heuristics
(only-user-participant, etc.) — those are not sender-derived patterns
and don't help denylist tuning.
