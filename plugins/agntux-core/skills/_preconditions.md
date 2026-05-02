# AgntUX entry-point preconditions (shared)

Every named `agntux-core:*` skill that the user can directly invoke
references this block. Lifted verbatim from the legacy `/ux`
orchestrator. **This file is not a skill** — leading underscore keeps
it out of the slash-command surface. Each entry-point skill points
here from its body.

The flow is: emit the trial banner first (always), then run the
ordered preconditions; stop at the first one that diverts.

---

## A. Trial-status banner (always emit, before any other output)

After the license-refresh hook runs, the cached license at
`~/.agntux/.license` carries `lifecycle.trial_days_remaining`. On
every entry-point skill invocation, read that value and emit a
one-line banner **above** the response when it is set (i.e. when
the user is on a trial plan).

| `trial_days_remaining` | Banner (emit verbatim) |
|---|---|
| ≥ 7, or null | No banner. |
| 6 | `Your trial ends in 6 days. Upgrade at app.agntux.ai/billing.` |
| 5 | `Your trial ends in 5 days. Upgrade at app.agntux.ai/billing.` |
| 4 | `Your trial ends in 4 days. Upgrade at app.agntux.ai/billing.` |
| 3 | `Your trial ends in 3 days. Upgrade at app.agntux.ai/billing.` |
| 2 | `Your trial ends in 2 days. Upgrade at app.agntux.ai/billing.` |
| 1 | `Your trial ends tomorrow. Upgrade at app.agntux.ai/billing to keep AgntUX active.` |
| 0 | `Your trial ends today. After tonight, AgntUX will stop running until you upgrade. app.agntux.ai/billing.` |
| ≤ −1 (post-expiry) | `Trial expired. AgntUX is paused. Your data is safe at ~/agntux/. Upgrade at app.agntux.ai/billing.` |

Rules:
- Emit the banner as the **first line** of your response, followed
  by a blank line, then your normal output.
- If `trial_days_remaining` ≤ −1 (post-expiry), emit the paused
  banner and stop — do NOT route to subagents (the license-validate
  hook would block tool execution anyway, but failing fast here is
  friendlier).
- If `~/.agntux/.license` is absent or unreadable, skip the banner
  silently.

---

## B. Preconditions (run in order, after the banner)

Stop at the first check that diverts; announce the redirect to the
user in one short sentence and chain into the named skill that owns
the prerequisite.

### 0. Project root

Confirm the active project root is exactly `~/agntux/`. If it isn't,
fail loud — say one sentence: "AgntUX requires the project to be
`~/agntux/`. Create that folder, select it in your host's project
picker, then re-invoke me." — and stop.

### 1. `~/agntux/user.md` exists and parses

If the file does not exist, the user has never onboarded.
Acknowledge their original ask in one sentence ("I see you asked
about X — but I need to set up your profile first."), then chain
into `/agntux-onboard`. After onboarding completes, re-run
these preconditions before returning to the user's original ask —
a brand-new `user.md` will trip the schema-bootstrap check below
on the next pass.

If the file exists but its frontmatter or required body sections
(`# Identity`, `# Preferences`, `# Glossary`) cannot be parsed,
say "Your `user.md` looks malformed. Run `/agntux-profile` to
fix it." and stop. (Do NOT attempt to repair it yourself —
personalization owns it.)

### 2. Schema bootstrapped

If `~/agntux/data/schema/schema.md` does not exist AND `user.md`
exists, the schema has never been bootstrapped. Announce the
preemption ("Before I get to that — your tenant schema isn't set up
yet.") and dispatch the **data-architect subagent in Mode A**
(bootstrap from `user.md`). After it completes, return to the
original ask.

### 3. Pending plugin contracts

Glob `~/agntux/data/schema/contracts/*.md.proposed`. If at least one
file matches, a plugin has been installed but is not yet authorised.
The dispatch depends on whether per-plugin onboarding (the
personalization-owned interview that writes `data/instructions/`) has
already run for that plugin:

For each `.proposed` file (oldest first by mtime):

- **Case A — `data/instructions/{plugin-slug}.md` does not exist OR
  has frontmatter `status: draft`**: per-plugin onboarding never
  finished. Dispatch the **personalization subagent in Mode A-bis**
  (new-plugins walkthrough). Mode A-bis runs the per-plugin
  onboarding interview, which itself dispatches architect Mode B at
  the right moment. Do NOT dispatch architect Mode B directly here —
  that would bypass the user-facing interview and write a contract
  without the user's instructions context.
- **Case B — `data/instructions/{plugin-slug}.md` exists with
  `status: final`**: onboarding finished but architect Mode B was
  interrupted. Dispatch the **data-architect subagent in Mode B**
  directly to consume the `.proposed` file. The architect reads the
  finalized instructions alongside the proposal, then deletes the
  `.proposed` file (`rm -f`).

After all `.proposed` files are processed, return to the original
ask.

This precondition is NOT invoked from `/agntux-onboard` (which
explicitly opts out — see that skill's own pre-checks). Every other
entry-point skill DOES run this check.

### 4. Schema-requests queue

If `~/agntux/data/schema-requests.md` exists AND has at least one
non-blank queue line, dispatch the **data-architect subagent in
Mode C** (schema edit driven by user-feedback escalation). The
architect consumes one entry per spawn. After it completes, return
to the original ask.

### Order

If multiple checks fire simultaneously, run them in this order:
2 → 3 → 4. State the order to the user before starting. Check 1
(missing or malformed `user.md`) preempts everything else.
