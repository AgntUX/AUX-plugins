# Draft message body section — agntux-docusign

Wholesale additive reference for the `## Draft message` body section
written into DocuSign action files at Step 10 of the ingest skill.

This section is read at click time by `agntux_docusign_reminder_view`
(`view-tool/src/agntux-docusign-view.ts` `handleReminder`) via
`extractSection(body, "Draft message")`. Its content is used to seed the
optional-message textarea in the reminder iframe.

---

## Conditional body section: `## Draft message`

OPTIONAL on action items of kind `response-needed` where the connected user
sent an envelope and a signer is pending (the "stuck envelope" signal). When
present, the content of this section pre-fills the optional-message textarea
in the reminder iframe so the user has a starting draft. The user may edit or
clear it before sending.

When absent, the reminder iframe's textarea starts empty and the user may
type their own message or leave it blank to send a default DocuSign reminder.

### Format

Plain prose. No fenced code block. The content is a single block of text
that becomes the `emailBlurb` argument to the DocuSign `sendReminder` tool
when the user sends the reminder with a message.

- Maximum recommended length: 500 characters (matches DocuSign's
  `emailBlurb` field limit).
- Must not contain guillemet characters (`«` or `»`) — these are reserved
  as delimiters in the connector envelope; the view tool will escape them
  if present but authors should avoid them.
- Authored at Step 10.1 using the same tone signals as the user's
  `data/instructions/agntux-docusign.md → # Notes` section. If no Notes
  are set, use a neutral professional tone.
- Personalization signals that motivated the draft wording are NOT written
  here — they live in the `## Compose payload` section of other plugins.
  For DocuSign, the reminder message is short and unstructured; no
  separate signals block is needed.

### Example

```markdown
## Draft message

Hi Alice — just a quick follow-up on the NDA we sent over on Monday.
Could you take a look when you get a chance? Please let me know if you
have any questions.
```

### When to include

Include when:
- The envelope has been open for more than 3 days without signer movement
  (the "stuck envelope" signal).
- The user's `data/instructions/agntux-docusign.md → # Notes` provides
  tone guidance the agent can apply.

Omit when:
- The action item is for signal 1 ("Waiting on USER to sign") — the
  reminder view is not surfaced to self-signers.
- The agent cannot infer a meaningful draft from available context. An
  empty `## Draft message` section is functionally equivalent to omitting
  it (the view tool trims whitespace; an all-whitespace section produces
  `draft_message: ""`).

### View tool contract

`agntux_docusign_reminder_view` lifts this section as:

```ts
draft_message: draftSection.trim()  // "" when section absent
```

The component seeds the textarea with `draft_message` on first render via
a `useEffect` that fires once when the payload arrives. If the user has
already typed in the field, the seed is skipped (the `seeded` guard
prevents overwrite). The user's final textarea content — not the seeded
value — is what goes into the connector envelope when they click Send.
