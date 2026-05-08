# Gmail sender denylist — Step 11 sub-step 5 procedure

Companion to `../SKILL.md` Step 11. Gmail-only auto-learn step that
appends senders to `data/instructions/agntux-gmail.md → # Sender denylist`
when they get noise-filtered repeatedly within a single run.

## When this runs

After cursor advance + lock release in Step 11, walk the working-memory
`noise_drop_counts` map populated by Step 8 (sender email → number of
messages skipped this run). For each sender with **≥3 dropped messages
this run**, decide whether to denylist them per the gates below.

Skip the entire sub-step if `data/instructions/agntux-gmail.md` does not
exist (the instructions file is created by `/agntux-onboard`'s per-plugin
onboarding; without it, the plugin hasn't been onboarded and this skill
should not author it).

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
breached and the next run should log a
`gmail-denylist-cap-breached-by-user-entries` debug entry.)

Atomic write (temp + rename).

## Untouchable sections

The skill MUST NOT touch any other section of the instructions file
(`# Always raise`, `# Never raise`, `# Rewrites`, `# Notes` are user
territory) and MUST NOT create the file from scratch. Only the
`# Sender denylist` section is auto-author territory, and only with the
`<!-- added: -->` metadata that distinguishes auto-added from
user-curated entries.

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
