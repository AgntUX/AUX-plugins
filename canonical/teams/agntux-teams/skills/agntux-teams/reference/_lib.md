# Shared preflight library — license JWT freshness gate

Lane: shared preflight snippet referenced by every `/agntux-teams`
sub-command's Step 0. Carries the **claim-level** license JWT
freshness check that extends the SKILL.md structural-shape check.

This file is not a sub-command body. It documents one reusable gate.
Sibling reference files invoke it by prose name as the first action
of their Step 0 ("run the shared license freshness gate described in
the `_lib.md` snippet"). No markdown links — one level deep per the
lint pass 8 rule.

## License freshness gate

This gate runs **after** SKILL.md preflight has confirmed
`teams.json` is non-empty and `teams.json.license_jwt` is
structurally a three-segment base64url JWT. It rejects expired or
out-of-state JWTs cleanly with the billing pointer below — no writes,
no state changes.

1. **Re-read `<root>/.agntux/teams.json`.** The SKILL.md read may be
   stale; the P4 desktop daemon rewrites this file every ≤1h. Pull
   `license_jwt` and `org_slug` from the top level (and from each
   `memberships[]` row if `org_slug` isn't at the top level — older
   `teams.json` shapes stash it on the membership row).

2. **Decode the JWT payload.** Split `license_jwt` on `.`. Take the
   middle segment. Base64url-decode it (replace `-`→`+`, `_`→`/`,
   pad with `=` to a length-multiple-of-4, then standard base64).
   Parse the resulting UTF-8 string as JSON.

   **No crypto verification at the LLM layer.** The LLM cannot run
   `crypto.verify()`. Forged JWTs are caught server-side at the
   sync-token mint and at the `agntux_build_publish_to_team`
   endpoint (both do Ed25519 verify via KMS). This snippet is the
   **soft-gate** that fails the lapsed-subscription UX closest to
   where the user feels it; the **hard-gate** lives in those
   server endpoints. P11 §"Validation in agntux-teams preflight"
   ratifies this two-layer split.

3. **Check `exp`.** Compare the decoded `exp` claim (Unix epoch
   seconds) against `now`.
   - `exp >= now` → JWT is fresh; proceed.
   - `exp < now` → JWT is stale (typically: the machine has been
     offline > 24h and the daemon hasn't been able to mint a fresh
     one; or: token mint endpoint returns 403 because the
     subscription is `canceled_locked` and the daemon couldn't
     get a new JWT). **Exit cleanly** with the message in §"Exit
     copy" below.

4. **Check `subscription_status`.** Read the `subscription_status`
   claim.
   - `trialing` → proceed.
   - `active` → proceed.
   - `lapse_grace` → proceed, but emit the soft-warning prefix
     described in §"Lapse-grace soft warning" below. Team
     features keep working through the 7-day grace per P11.
   - **Any other value** (`past_due`, `canceled`, `unpaid`,
     `incomplete_expired`, `paused`, anything unrecognised) →
     exit cleanly with the message in §"Exit copy" below.

5. **No retries; no network calls.** A single read of `teams.json`
   + a single decode is the gate. If the file is unreadable, the
   JWT payload won't parse as JSON, or any required claim is
   missing, exit with the same §"Exit copy" message — the user
   shouldn't have to distinguish between "JWT missing", "JWT
   payload malformed", and "JWT expired". All three resolve via
   "refresh your sign-in in the desktop app".

## Exit copy

Resolve `{slug}` from the JWT's `org_slug` claim if the decode
succeeded that far, else from `teams.json.memberships[0].org_slug`.
If neither is available (malformed `teams.json`, decode failed),
fall through to the generic-message variant below — never leak a
literal `{org-slug}` template token into user-facing copy.

Slug-resolved message (preferred — verbatim):

> Your team's AgntUX Teams subscription is no longer active. Your
> admin can update billing at `app.agntux.ai/org/{slug}/billing`.

Generic fallback (no slug resolvable):

> Your team's AgntUX Teams subscription is no longer active. Your
> admin can update billing at `app.agntux.ai/billing`.

Then stop the sub-command. **No writes; no state changes.** This
applies to every sub-command — sync, onboard:team-lead,
onboard:member, onboard:leader, ask, teach, status, reshape.

## Lapse-grace soft warning

When `subscription_status === "lapse_grace"`, prefix the sub-command's
first user-facing line with:

> Your team's subscription is in a {N}-day grace period — your admin
> needs to update billing by {lapse_grace_ends_at} at
> `app.agntux.ai/org/{slug}/billing`.

Resolve `{N}` as `ceil((lapse_grace_ends_at_epoch - now_epoch) /
86400)`. Resolve `{lapse_grace_ends_at}` as the human-readable date
(YYYY-MM-DD). Resolve `{slug}` per §"Exit copy" above.

Then continue with the sub-command body. Grace state is **not** a
hard gate; the user's team-mode work continues. Read-only
sub-commands (ask, status) skip the warning if the lapse_grace claim
isn't useful to surface (status emits its own roster output; ask
can prefix the first answer).

## Public-plugin invariant

Public plugins (`agntux-core`, `agntux-build`, and every public
source plugin) do **NOT** invoke this snippet. They gate on
`teams.json` **file presence** only — that is the cross-plugin
contract from P3 §"What gates the proprietary product".

If a refactor tempts you to import this snippet from a public
plugin, **stop**. That would regress the master-plan "free for
individuals" invariant: a lapsed org's members can still use
AgntUX for their personal data, and the public plugins must keep
rendering team data already on disk even when this gate would
reject. Only `agntux-teams` (the proprietary plugin) ever runs
the claim-level check.

`agntux-build`'s `agntux_build_publish_to_team` tool is the one
edge case: it reads `license_jwt` out of `teams.json` and forwards
it as `Authorization: Bearer ...` to the backend publish endpoint.
That is **not** a claim-level check — it's an opaque pass-through.
The backend does the Ed25519 verify via KMS (per P11 §"Validation
in `agntux_build_publish_to_team`") and returns 403 on a lapsed
subscription; the tool surfaces a clean error then. The LLM never
decodes the JWT in agntux-build, and that is correct.

## Test scenarios

The four scenarios from P11's verification matrix (and the S7.2
work order) all flow through the gate above without needing
signature verification at the LLM layer:

- **Offline 24h** — cached `license_jwt` still fresh (`exp >= now`),
  `subscription_status` still `active`. Gate passes; sub-command
  runs. The "cached public key" mental model is mis-leading: the
  cache is the JWT itself, not a key. No network involved.
- **Offline 25h** — cached `license_jwt` expired (`exp < now`).
  Daemon offline and couldn't refresh. Gate rejects with the
  billing pointer.
- **Lapse grace** — daemon's most recent refresh returned a JWT
  with `subscription_status: "lapse_grace"` (Stripe flipped the
  subscription state; the mint endpoint still issues fresh JWTs
  during the 7-day window). Gate accepts and emits the soft
  warning; team features continue.
- **Canceled / locked** — Stripe flipped the subscription to
  `canceled` past the grace; the mint endpoint returns 403; the
  daemon's cached `license_jwt` ages out within 24h. Gate rejects
  on `exp < now` with the billing pointer.

If a future iteration adds a real public-key fetch (e.g., a
desktop-side worker that pre-verifies the signature and writes a
`license_jwt_verified_at` timestamp into `teams.json`), this
snippet should consume that timestamp instead of re-deriving
trust at the LLM layer. Until then, the structural shape check
(SKILL.md) + the claim-level check (this snippet) + the
server-side Ed25519 verify (mint endpoint + publish endpoint)
together close the loop.
