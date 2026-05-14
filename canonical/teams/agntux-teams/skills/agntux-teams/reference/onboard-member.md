# `/agntux-teams onboard:member {team-slug}` — Team-Member onboarding

Lane: walk a freshly-added team member through the briefing, capture
the all-or-nothing consent grant, collect their relevance-class picks,
and persist the member record both on disk and via the backend
consent endpoint. Idempotent: re-running for an already-consented
member skips the consent prompt and walks the relevance-class picks
with prior picks pre-selected so the user can adjust them.

The body owns the consent text version slug **`v1-2026-05-12`** (the
exact wording lives in step 2 below). Bump this slug whenever the
consent wording changes — P12 owns the re-consent policy that decides
when an existing grant must be re-collected.

---

## Step 0 — Preflight (LLM reads files, no writes)

The SKILL.md preflight has already resolved `<agntux project root>`,
confirmed `teams.json` is non-empty, and verified the license JWT is
structurally present.

> **License freshness gate (runs first).** Run the shared `_lib.md` license-JWT freshness gate first — decode `teams.json.license_jwt`, check `exp` and `subscription_status ∈ {trialing, active, lapse_grace}`. Failure exits cleanly to `app.agntux.ai/org/{slug}/billing` (no writes; no state changes). On `lapse_grace`: soft-warn and continue.

Then run the member-specific gates below in order and stop the body
on the first failure.

1. **Parse `$ARGUMENTS`.** The first whitespace-delimited token is
   `{team-slug}`. Missing or empty → emit one short
   `Usage: /agntux-teams onboard:member {team-slug}` and stop.

2. **Confirm user.md exists.** Read `<root>/user.md`. Missing →
   delegate to `/agntux onboard` with the team context preloaded
   (carry `{team-slug}` and the membership's `org_slug` from
   `teams.json` so the agntux-core onboarding can leave a deep-link
   back to `/agntux-teams onboard:member {team-slug}` in its
   summary card). Stop after delegating; the user re-runs this
   command after agntux-core onboarding finishes. **No writes from
   this body** until the delegation returns.

3. **Verify the user is on this team.** Read
   `<root>/.agntux/teams.json`. Walk `memberships[]` for a row with
   `team_slug === {team-slug}`.
   - **No row** → emit
     `You haven't been added to {team-slug} yet. Ask your team lead to add you in app.agntux.ai/org/{org-slug}/teams/{team-slug}/members.`
     and stop.
   - **Row exists but `team_role !== "member"`** → emit
     `This onboarding is for team members. Your row on {team-slug} shows team_role: {team_role}. If you're the team lead, run /agntux-teams onboard:team-lead {team-slug} instead.`
     and stop. (Team-leads are auto-consented at creation per P6;
     they do not run member onboarding.)
   - **Row OK** → continue. Pull `org_slug`, `user_slug`,
     `joined_at`, and the existing `consent_at` /
     `consent_text_version` (may be null) into local scope.

4. **Schema-ready gate.** Call
   `GET /api/teams/{org_slug}/teams/{team-slug}/status` through the
   host's HTTP fetch surface. Authenticate with
   `Authorization: Bearer {license_jwt from teams.json}` — every
   request to `/api/teams/...` is RLS-gated per P6, so an unauthed
   call returns 401 and the gate misfires. The backend response
   shape (P6-owned):

   ```json
   {
     "team_slug": "...",
     "display_name": "...",
     "schema_ready_at": "<ISO-8601>|null",
     "lead_user_slug": "...",
     "member_count": 7
   }
   ```

   - `schema_ready_at` is **null** → emit
     `Your team lead for {display_name} is still designing the team's data structure. You'll get an email when it's ready — you don't need to do anything in the meantime.`
     and stop. **No writes.** The skill is idempotent; the user
     re-runs once the email lands.
   - HTTP error (network down, 5xx) → emit
     `Couldn't reach the AgntUX Teams service to check {team-slug}'s readiness. Try again in a few minutes.`
     and stop. **No writes.**
   - `schema_ready_at` is set → continue.

5. **Detect edit mode.** Read
   `<root>/teams/{team-slug}/data/onboarding.md`. The file is the
   member-onboarding marker; absence means first-run.
   - **Absent** → first-run mode. Set `edit_mode = false`. Read no
     prior picks.
   - **Present** → read the frontmatter. If
     `member_onboarding_complete: true` AND
     `consent_text_version === "v1-2026-05-12"` (the current
     wording), set `edit_mode = true` and remember the prior
     `relevance_classes:` array as `prior_picks` for step 3's
     pre-selection.
   - **Present** but `consent_text_version` differs from the
     current version → set `edit_mode = false` (re-consent required
     per P12's versioning policy). **Load** `prior_picks` from the
     existing file for step 3's pre-selection, but treat consent
     as not-yet-captured (step 2 runs).

6. **Load the team's schema** so step 1 can translate it to
   plain English and step 3 has the `relevance_classes[]` source
   of truth. Read in order:

   - `<root>/teams/{team-slug}/data/team-config.md` — pull
     `display_name`, `cadence`, `purpose` (one-line summary from
     frontmatter or the first paragraph of the body), and
     `relevance_classes[]` (array of `{slug, label, description}`
     objects, authored by the team lead in onboard:team-lead).
   - `<root>/teams/{team-slug}/data/schema/schema.lock.json` —
     pull `entity_subtypes[]` and `action_classes[]` for the
     plain-English summary in step 1.

   Missing files at this step is unexpected (schema-ready was true
   in step 4) → emit a short
   `{team-slug}'s schema files are missing locally. Try /agntux-teams sync first, then re-run this onboarding.`
   and stop. **No writes.**

---

## Step 1 — Briefing card

Call `mcp__cowork__create_artifact` to render a one-screen briefing.
The body is plain prose; never quote `schema.lock.json` JSON to the
user. Translate `entity_subtypes[]` and `action_classes[]` into a
short paragraph.

Title: `Welcome to {display_name}`

Body template (fill placeholders from the values gathered in step 0):

```
You've been invited to {display_name}.
  · Lead: {lead display name from /status response}
  · Purpose: {one-line from team-config.md}
  · {member_count - 1} other members have joined so far.

How AgntUX Teams works for you as a member:
  · Your personal AgntUX checks your data each cycle.
  · Anything that fits this team's data shape gets lifted into
    the team's shared workspace.
  · You'll see team items in /agntux triage alongside your
    personal items.

What this team tracks (in plain English):
  · {one sentence summarising entity_subtypes — e.g., "people,
    companies, and projects"}.
  · {one sentence summarising action_classes — e.g., "customer
    pain points and product decisions"}.
```

When in `edit_mode`, prefix the title with `Adjusting your picks for
{display_name}` and keep the body so the user has the context refresher.

After rendering the artifact, continue to step 2.

---

## Step 2 — Consent (all-or-nothing)

**Skip this step entirely when `edit_mode === true`** — the existing
consent grant stays in force. Jump directly to step 3.

When not in edit mode, call `AskUserQuestion` with the exact wording
below. This text **is** version `v1-2026-05-12` — if you change a
character of it, also change the slug and update the file's
top-of-file note. Do not paraphrase.

```
question: "Do you consent to AgntUX lifting slices of your personal
data that fit this team's data shape into the team's shared
workspace? Other team members and your team lead will see anything
that gets lifted."
header: "Consent"
options:
  - label: "Yes — I consent"
    description: "Your personal items that match {display_name}'s
      schema will be lifted into the team workspace on each sync.
      You can leave the team at any time from the AgntUX Teams web
      app to revoke."
  - label: "No — not right now"
    description: "Nothing is lifted. You can re-run this command
      later to consent."
multiSelect: false
```

Handle the answer:

- **`No — not right now`** → emit one short
  `No problem — nothing is lifted. Re-run /agntux-teams onboard:member {team-slug} whenever you're ready.`
  and stop. **Write nothing** — `team_members.consent_at` stays
  NULL server-side, and the on-disk member file is not created.
  (Author note: the lift pass reads `consent_at` per cycle and
  treats the user as not-consented until they re-run.)
- **`Yes — I consent`** → continue to step 3. Record the answer
  locally as `consent_at = <now-iso>` and
  `consent_text_version = "v1-2026-05-12"` for step 5's write.

---

## Step 3 — Relevance-class picks

Before asking: **validate `relevance_classes[]` is non-empty.**
If the team-config loaded in step 0.6 has an empty array (a
malformed schema, or a team-lead onboarding that didn't reach
step 3), emit
`{team-slug}'s data shape doesn't include any relevance classes yet — ask the team lead to re-run /agntux-teams onboard:team-lead {team-slug}.`
and stop. **No writes** (the consent grant in step 2 has not
been persisted yet).

Also: **filter `prior_picks` to only slugs still present** in the
current `relevance_classes[]`. The team-lead may have deprecated a
class between runs (per P7's additive-only-with-deprecation
policy); stale prior_picks must be dropped before pre-selection.
If filtering empties `prior_picks` entirely, treat the edit-mode
user as first-run for this step only (still skip step 2).

Show the team's relevance classes via `AskUserQuestion`
(multiSelect: true). Pull options from
`team-config.md.relevance_classes[]` — each entry's `description`
goes into the option's `description:` so the user sees what they
are picking.

When `edit_mode === true`, mention `prior_picks` in the question
prompt so the user knows what's currently set; the host's
multi-select UI does not surface defaults directly, so the
question prompt is the only place to convey them.

```
question (first-run): "Which kinds of {team's action_class category
  noun, e.g. 'work items'} from {display_name} do you want to see in
  your triage? Pick at least one."
question (edit mode): "Your current picks are: {prior_picks joined by
  comma}. Update them below — pick at least one."
header: "Relevance"
options:
  for each class in team-config.md.relevance_classes:
    - label: "{class.label}"
      description: "{class.description}"
multiSelect: true
```

Validate the answer:

- **Zero picks** → re-prompt with
  `You need to pick at least one. If nothing else feels right, the team lead included a "general" class as a safe default — pick that.`
  (Only mention `general` if the team-config actually includes it
  — otherwise omit the second sentence.) Re-ask.
- **One or more picks** → record as `picks` and continue.

---

## Step 4 — Optional context

Ask one short free-text question:

```
question: "Anything you want your team to know about how you'd like
  to receive items? (Skip is fine.)"
header: "Context"
options:
  - label: "Skip"
    description: "Move on without adding a note."
  - label: "Add a note"
    description: "Write one or two sentences."
multiSelect: false
```

On `Skip` → leave the body empty.
On `Add a note` → ask a follow-up free-text question and capture
the response (`free_text_body`). Strip leading/trailing whitespace;
if the user types only whitespace, treat it as Skip.

In `edit_mode`, if a prior `free_text_body` exists on the member
file, surface it in the question prompt:

```
question (edit mode): "Your current note is: '{prior_body}'. Replace
  it, keep it, or drop it?"
options:
  - "Keep current"
  - "Replace"
  - "Drop"
```

Map answers to: keep → reuse `prior_body`; replace → ask for new
text; drop → empty body.

---

## Step 5 — Persist member record + POST consent

Two writes happen here. They are ordered: filesystem first
(so the on-disk replica is durable even if the network blip),
then backend.

### 5a. Write the member file

Path: `<root>/teams/{team-slug}/data/members/{user_slug}.md`.

Use the `user_slug` resolved in step 0 (from `teams.json`, never
guess). If the parent directory does not exist, create it (the
`validate-team-write-lane` PreToolUse hook allows
`<root>/teams/{slug}/data/members/` for the agntux-teams write
lane — see hook source for the allow-list).

File contents:

```yaml
---
team_slug: {team-slug}
team_role: member
user_slug: {user_slug}
user_id: {user_id-from-teams.json}
joined_at: {joined_at-from-teams.json}
consent_at: {now-iso}
consent_text_version: v1-2026-05-12
relevance_classes:
{- one entry per pick, in the order chosen}
---
{free_text_body, or empty}
```

In edit mode the file already exists. Use Edit to update the
`consent_at` only if `edit_mode === false` (re-consent path),
otherwise preserve the prior `consent_at`. Always rewrite
`relevance_classes:` and the body to match the new picks/context.
Never delete the file in edit mode — replace fields in place.

### 5b. POST consent to the backend

```
POST /api/teams/{org_slug}/teams/{team-slug}/members/me/consent
Content-Type: application/json
Authorization: Bearer {license_jwt from teams.json}

{
  "version": "v1-2026-05-12",
  "relevance_classes": ["{pick-1}", "{pick-2}", ...]
}
```

Backend behavior (P6-owned):

- UPDATE `team_members SET consent_at = now(), consent_text_version = $1 WHERE user_id = me AND team_id = team-of(team-slug)`.
- 200 → success. Response body echoes the updated `consent_at`.
- **401 Unauthorized** (expired or revoked license JWT) → emit
  `Your AgntUX Teams session expired — open the AgntUX Teams desktop app, sign in again, then re-run /agntux-teams onboard:member {team-slug}. Your on-disk record is saved.`
  Continue to step 6. Do NOT treat this as a retryable
  network error — the P4 daemon's reconcile loop will hit the
  same 401 until the user refreshes the JWT in the desktop app.
- Other 4xx (e.g., row missing, version unknown) → if the
  response body parses as a short error message, emit
  `The AgntUX Teams service rejected the consent submission: {error message}. Your on-disk record is saved; ask support to investigate.`
  Otherwise (HTML, malformed JSON, or empty body) fall back to
  `The AgntUX Teams service rejected the consent submission (HTTP {status}). Your on-disk record is saved; ask support to investigate.`
  Continue to step 6 — the on-disk file is the synced replica.
- 5xx or network error → emit
  `Couldn't reach the AgntUX Teams service to record consent — your on-disk record is saved and will sync on the next cycle.`
  Continue to step 6. (Author note: the reconcile loop catches
  up silently on the next refresh.)

### 5c. Update teams.json (best-effort)

The agntux-teams write lane is allowed to write
`<root>/.agntux/teams.json` per P7's write-lane exception. Set
the matching `memberships[]` entry's `consent_at` and
`consent_text_version` to match the values written above. The
P4 daemon's next push reconciles this to the backend within
≤ 1 hour; the POST in 5b is the eager path, this is the
fallback path.

If `teams.json` write fails (lock contention, disk full),
**continue** — the membership row's `consent_at` is already
authoritative server-side via 5b, and the daemon will repair
the local file on its next refresh.

---

## Step 6 — Summary + marker drop

Call `mcp__cowork__create_artifact` with the summary card. Body
template:

```
You're set up for {display_name}.
The next time the team's sync runs ({human-readable cadence —
e.g., "every hour"}), items relevant to you will appear in
/agntux triage.

Your picks:
{bulleted list of relevance_classes, labels (not slugs)}

Want to adjust later?
Run /agntux-teams onboard:member {team-slug} again — your
existing picks will be the defaults.
```

In edit mode, swap the first sentence to
`Your picks for {display_name} are updated.` and keep the rest.

After the artifact renders, drop the marker file at
`<root>/teams/{team-slug}/data/onboarding.md` (overwrites in
edit mode):

```yaml
---
team_slug: {team-slug}
member_onboarding_complete: true
consent_text_version: v1-2026-05-12
consent_at: {now-iso, matches the member file}
relevance_classes:
{- one entry per pick}
last_run_at: {now-iso}
edit_mode: {true|false — the mode this run was}
---
This marker is written by /agntux-teams onboard:member. The
dispatch loop reads it to skip already-consented members. Do
not edit by hand — re-run the slash command to make changes.
```

Stop. No further chat output after the artifact + marker write.

---

## Re-run / edit semantics

Re-running `onboard:member` for an already-consented member where
`consent_text_version === "v1-2026-05-12"`:

- Step 0 sets `edit_mode = true` and loads `prior_picks` /
  `prior_body` from the existing member file.
- Step 1 renders the briefing in "adjusting your picks" framing.
- Step 2 is **skipped** — consent stays in force.
- Step 3 walks the relevance picks with the prior picks surfaced
  in the question prompt; the user replaces the set.
- Step 4 surfaces the prior context note (keep / replace / drop).
- Step 5 edits the member file in place — `consent_at` is
  **preserved**, `relevance_classes:` and the body are rewritten.
  5b POSTs the new `relevance_classes:` so the backend mirrors
  the disk.
- Step 6 swaps to the "your picks are updated" framing.

Re-running where `consent_text_version` has changed (P12 bumped
the slug): `edit_mode = false`. The body walks the full flow
including step 2. The new consent grant supersedes the old one.

---

## Out of scope

- **Schema reshape** — members cannot reshape the team's schema.
  Route the user to `/agntux-teams reshape {team-slug}` (which
  itself only allows the team-lead to act).
- **Authoring per-team rules** — `/agntux-teams teach`.
- **Inviting yourself to other teams** — web-app territory
  (`app.agntux.ai/org/{org-slug}/teams`).
- **Leaving the team** — voluntary leave is the P4 daemon's job;
  the user clicks "leave team" in the AgntUX Teams web app and
  the daemon mirrors the deletion to disk per P7.
- **Per-source-plugin consent granularity** — V1 consent is
  all-or-nothing per the P6 invariant. Per-slice toggles are
  deferred to V2.
- **Token-mint** — that's the P5 daemon's job. This body only
  records consent; the daemon picks up the freshened
  `consent_at` on its next refresh and re-mints the sync JWT
  with the team's container claim.
