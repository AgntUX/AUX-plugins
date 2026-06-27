# Draft void reason body section — agntux-docusign

Wholesale additive reference for the `## Draft void reason` body section
written into DocuSign action files at Step 10 of the ingest skill.

This section is read at click time by `agntux_docusign_void_view`
(`view-tool/src/agntux-docusign-view.ts` `handleVoid`) via
`extractSection(body, "Draft void reason")`. Its content seeds the
required void-reason textarea in the void iframe.

---

## Conditional body section: `## Draft void reason`

OPTIONAL on action items where the suggested action includes a "Void
envelope" option. When present, the content pre-fills the required
void-reason field in the void iframe. The user must confirm or edit the
reason before the void button becomes active (the void button is disabled
until the textarea has non-whitespace content).

When absent, the void-reason textarea starts empty and the user must type
a reason before they can submit.

### Format

Plain prose. No fenced code block. One or two sentences describing why
the envelope is being voided.

- Maximum recommended length: 200 characters. DocuSign displays the void
  reason to all recipients in the void notification email; keep it
  professional and concise.
- Must not contain guillemet characters (`«` or `»`). The view tool
  escapes them when building the connector envelope, but authors should
  avoid them for readability.
- The void reason is a user-facing string — recipients see it in DocuSign's
  void notification. Do NOT include internal references (ticket IDs,
  internal system names) unless the user's preferences explicitly allow it.
- Apply tone guidance from `data/instructions/agntux-docusign.md → # Notes`
  if available. Default to neutral professional prose.

### Example — contract terms changed

```markdown
## Draft void reason

The contract terms have changed since this envelope was sent. A revised
version will be re-sent shortly.
```

### Example — sent in error

```markdown
## Draft void reason

This envelope was sent in error. Please disregard.
```

### When to include

The void view is only offered when the plugin or the user explicitly
triggers a "Void envelope" flow. The ingest skill does not proactively
generate void-intent action items — the void view is opened by the user
from the hub's action card for an in-flight envelope. In that case:

- Include this section if context from the action body (e.g., a note the
  user added, or a prior dismiss reason) gives the agent enough information
  to draft a plausible reason.
- Omit if no context is available. The user will type the reason themselves.

In practice, most void-view opens will have an empty `## Draft void reason`
section; the field is intentionally left to the user because void reasons
are consequential (recipients see them).

### View tool contract

`agntux_docusign_void_view` lifts this section as:

```ts
draft_void_reason: draftSection.trim()  // "" when section absent
```

The component seeds the void-reason textarea with `draft_void_reason` on
first render via a `useEffect` that fires once when the payload arrives.
The `canSubmit` guard checks that `reason.trim().length > 0` before
enabling the "Void envelope" button — an all-whitespace seed is treated
as empty, keeping the button disabled until the user types a non-empty
reason.

The user's final textarea content — not the seeded value — is what goes
into the connector envelope as `voidedReason` when they click
"Void envelope". The envelope routes to DocuSign's `updateEnvelope`
connector tool with:

```json
{
  "accountId": "<account_id>",
  "envelopeId": "<envelope_id>",
  "envelopeUpdate": {
    "status": "voided",
    "voidedReason": "<user-confirmed reason>"
  }
}
```
