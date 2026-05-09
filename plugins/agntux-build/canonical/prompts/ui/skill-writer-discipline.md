# Skill writer discipline

Behavioural rules for any agent producing a `SKILL.md` skill file (plus
optional supporting files) for an AgntUX plugin. Distilled from a prior
production skill-writer-agent prompt and adapted for the
`agntux-plugin-dev` toolkit. The rules below cover the **content** of the
skill file; the per-plugin substitution flow (which canonical templates
to copy, when) is owned by `ingest-prompt-author`.

## Output

`SKILL.md` (YAML frontmatter + markdown body) plus optional supporting
files under `plugins/{slug}/skills/{name}/` (e.g.,
`references/`, `templates/`).

You write to `plugins/{slug}/skills/`. You do **not** write to
`agents/`, `mcp-server/`, `marketplace/`, `hooks/`, or
`ui-handlers/` — those are owned by other specialists.

## MUST

- **Extract the plugin slug from the task description** (look for `slug: [PLUGIN_SLUG]` or `Plugin Slug: [PLUGIN_SLUG]`). Use this value VERBATIM to substitute every `{slug}` placeholder in the Universal Host Protocol block, the State Management section, the Configuration section, and any other built-in-tool references.
- The slug ALWAYS starts with `agntux-` (kebab-case in the plugin manifest) and the **built-in tool prefix** is the underscored form (e.g., plugin slug `agntux-slack` → tool prefix `agntux_slack` → tools `agntux_slack_read_file`, `agntux_slack_send_email`). The prefix exists to keep built-in file/email tool names from colliding with third-party MCP connector tool names (Slack's `slack_channels_list`, GitHub's `github_issues_create`, etc.).
- `name` field must use valid kebab-case: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`. Derive from skill name by lowercasing and replacing spaces with hyphens.
- SKILL.md body must be under 5k tokens.
- Frontmatter description must include WHAT the skill does AND WHEN to use it. Include specific trigger scenarios.
- Always use imperative/infinitive form ("Fetch the sprint data", not "You should fetch the sprint data").
- Include a `## Onboarding commands` section between Prerequisites and Workflow Steps, documenting the `onboard me` trigger phrase always, and `set up {app name}` only when this SKILL.md has a `## Onboarding` section.
- Include the Universal Host Protocol block VERBATIM between Workflow Steps and State Management. Substitute `{slug}` placeholders with the plugin's actual built-in-tool prefix.
- Always include the Customization section at the end of SKILL.md.
- Always include the universal "### User profile onboarding" sub-section in the Host Protocol VERBATIM (five fixed questions, sixth open-ended prompt, tri-state ledger).
- Always include the universal "### App onboarding" sub-section in the Host Protocol VERBATIM (text always present; runtime behavior gates on whether the spec declares onboarding requirements).
- After writing, run self-review and verify all checks before presenting.

## NEVER

- **NEVER derive the slug yourself.** Do NOT slugify the plugin name. Do NOT strip the `agntux_` prefix from built-in tool names. Do NOT use the component-id slug from `ui://` resource URIs — that is a per-component identifier, unrelated to the plugin slug. If the task description does not include a slug, STOP and ask.
- NEVER let any literal `{slug}` placeholder remain in the written file.
- NEVER instruct the host to fabricate, invent, or fill in data not returned by an MCP tool.
- NEVER duplicate Universal Host Protocol content (Step 0 hydration, error semantics, silent/compound classification, "never call callTool…") in the State Management section. The Host Protocol block carries those rules ONCE.
- NEVER create README.md, INSTALLATION_GUIDE.md, QUICK_REFERENCE.md, CHANGELOG.md, or any auxiliary documentation alongside SKILL.md. The skill should only contain information needed for the host to do the job.
- NEVER duplicate content between SKILL.md and reference files.
- NEVER skip steps in the relay chain — the host needs explicit instructions for each hop.
- NEVER mention file paths, code snippets, or technical jargon in user-facing messages. Reference deliverables by purpose ("Your skill instructions", "The workflow guide").

## Always

- Always use specific tool names and expected parameters.
- Always describe WHAT to do, not HOW Claude works internally.
- Always define the data flow between connectors and AgntUX tools.
- Always include error handling for common failure modes.
- Always use numbered steps for the main workflow.
- Always list ALL required MCP connectors by name.
- Always document the plugin slug as a prerequisite.
- Use entity names consistent with the spec — if the spec uses "Acme Corp", use "Acme Corp" in examples.
- For host-composed emails, include formatting guidance: "Format the email with clean, professional HTML: single-column layout, neutral colors (dark text on white), clear headings, concise and scannable."

## Workflow

1. **Read context files** — the plugin's `marketplace/listing.yaml` (verb phrases, supported_prompts, ux_components), any prior `app-spec.md` or design document, and the relevant canonical prompt template that `ingest-prompt-author` is substituting from.
2. **Understand MCP server configuration** — identify configured tools (names, inputSchema, outputStructure), resources, data flow. Record the plugin slug from the task description.
3. **Write SKILL.md** — at `plugins/{slug}/skills/{name}/SKILL.md`. Follow YAML frontmatter + markdown body format. Inject the Universal Host Protocol block between "Workflow Steps" and "State Management".
4. **Create supporting files (only if genuine value)** — `references/input-schema.json` (tool input schema reference), `references/api-reference.md` (relevant API docs). Don't pad the folder.
5. **Add State Management section (app-specific)** — only if the spec has a State Management section; otherwise omit.
6. **Add Data Freshness section (if applicable)** — only if the spec has heartbeat steps.
7. **Add Configuration section (only if spec declares identity requirements)**.
8. **Add Learning Preferences section (only when the spec has discoverable preferences)**.
9. **Add Email Notifications section (if applicable)**.
10. **Self-review** — verify YAML, kebab-case `name`, slug substitution complete, tool name accuracy, workflow steps form a complete Relay Pattern loop, body under 5k tokens.

## Closed list of substitutable placeholders

The canonical sync-skill template at
`canonical/prompts/ingest/skills/sync/SKILL.md` (in the **consumer
repo's** root, per the Path conventions section in `skills/author/SKILL.md`)
declares these substitution tokens. Hyphenated only:

`{{plugin-slug}}`, `{{plugin-version}}`, `{{source-display-name}}`,
`{{source-slug}}`, `{{recommended-cadence}}`,
`{{source-cursor-semantics}}`, `{{source-mcp-tools}}`,
`{{ui-handler-trigger-list}}`, `{{ui-handler-name}}`,
`{{ui-handler-display-name}}`, `{{ui-name}}`,
`{{primary-verb-phrase}}`, `{{structured-content-field-1}}`,
`{{structured-content-field-2}}`, `{{structured-content-field-3}}`,
`{{primary-intent-key}}`, `{{CONNECTOR_DIRECTORY_URL}}`.

Underscored variants are NOT in canonical templates — never substitute
against them.

### Fail loud on missing placeholder values

If the spec does not have a value for a required placeholder:
- Do NOT guess or invent a value.
- Do NOT leave the `{{placeholder}}` token in place.
- Surface "Missing value for `{{placeholder_name}}` — please source it from spec/manifest and retry." and stop.

## Universal Host Protocol — substitution rule

Inject the "## Host Protocol" block VERBATIM between "## Workflow Steps"
and "## State Management". Do NOT edit rules per-app. Only substitution
allowed: replace every `{slug}` placeholder with the plugin's built-in
tool prefix (e.g., `agntux_slack`).

The Host Protocol's `{app name}` placeholder is a RUNTIME instruction —
leave it as `{app name}` verbatim inside the Host Protocol block so the
host resolves it against the active plugin's frontmatter.

The Host Protocol covers (do NOT duplicate elsewhere):
- Component vs host responsibilities
- Step 0 — read state at conversation start (PER-COMPONENT)
- Cache reuse within a conversation
- Reading log-style files
- File tool error semantics
- User action classification (silent persistence / compound autosend / compound draft-for-review / compound non-publishing)
- `sendFollowUpMessage` handling
- After render: silence (with two narrow exceptions: proactive introduction and user-invoked onboarding)
- Never fabricate data
- Preferences protocol (persistence triggers, routing, type coercion, teaching counter, proactive introduction dual-trigger, onboarding trigger-phrase appends)
- User profile onboarding (universal, fixed)
- App onboarding (universal block; behavior no-ops when the spec doesn't declare onboarding)
- Cross-app delegation (lazy load)
- Third-party data is canonical

## Concise is key

- Context window is a public good — every token matters.
- SKILL.md metadata: ~100 tokens.
- SKILL.md body: <5k tokens.
- Put detailed references in `references/` (loaded on demand).
- If a section isn't adding value, delete it.

## Write-back actions

Every write-back — file, email, or third-party connector — goes through
`sendFollowUpMessage`. The component updates local React state
optimistically, then describes the intent to the host.

**Wire format — sigil envelope.** Every example `sendFollowUpMessage`
payload MUST use the same `@key:value` sigils the file's schema uses
(no `title='...'` quoted interpolation). User-provided text is passed
through `inline()`/`block()` helpers on the component side.

**Silent persistence examples:**
- Create: `"User created a new task. Prepend to tasks.md: @id:<id> @priority:<p> @due:<YYYY-MM-DD> <title>\n  <indented description>"`
- Delete: `"User deleted task @id:<id>. Read tasks.md, drop the @id:<id> line and any 2-space-indented continuation lines, then write_file the result."`

**Compound action examples:**
- `"[Natural-language intent with sigils]"` → Host calls `[connector_tool]`, then `{slug}_edit_file` to record the result.
- Email: `"Send an email to [recipient] with subject '[subject]' containing [source/content]. Format as clean HTML."` → Host drafts body and calls `{slug}_send_email`.

## Relay Pattern accuracy

Every workflow step must clearly show the data flow direction:

```
Host → Third-Party Connector → Host → AgntUX Tool → UI → User → sendFollowUpMessage → Host → Third-Party Connector
```

- Never skip steps in the relay chain.
- Specify what data to extract from connector responses and how to format it for AgntUX tools.
- **Data dependencies between connector calls:** When one connector call returns IDs needed by a subsequent call, SKILL.md must (1) order the calls so the dependency is fetched first, (2) explicitly state where to extract the IDs from the prior response, (3) show the exact parameters for the dependent call.
- **Polymorphic tool parameters:** When a tool accepts a type discriminator (e.g., `objectType`), always specify the exact value.

## Self-review checklist (key items)

- **Frontmatter** — Valid YAML with `name` (kebab-case) and `description` (what + when).
- **Conciseness** — Body under 5k tokens.
- **Universal Host Protocol present** — Block injected between Workflow Steps and State Management with rules unchanged; every `{slug}` substituted.
- **Slug correctness** — Plugin slug taken verbatim from task description. NO literal `{slug}` placeholder remains. Built-in tool prefix uses the underscored form (`agntux_slack`, not `agntux-slack` or stripped). Third-party connector tool references (Slack's `slack_channels_list`, GitHub's `github_issues_create`) stay unchanged.
- **Onboarding commands section** — Top-level `## Onboarding commands` between Prerequisites and Workflow Steps. Documents `onboard me` always, `set up {app name}` only when this SKILL.md has a `## Onboarding` section.
- **Tool accuracy** — All built-in file tool names use the plugin's slug prefix.
- **Input schema alignment** — Tool call examples pass data fields that exist in the registered inputSchema.
- **Data dependencies** — When one connector call provides IDs needed by another, SKILL.md states (1) which prior response to extract from, (2) correct call order, (3) exact tool parameters.
- **Entity name consistency** — Examples use entity names consistent with the spec.
- **Relay Pattern** — Data flow follows the correct relay chain.
- **No protocol duplication** — State Management does NOT re-state Step 0 hydration, file-tool error semantics, silent/compound classification, or "component never calls file tools" warnings.
- **Customization section** — Present at end.

## Circuit breaker

After 3 consecutive failures producing the SAME error on the SAME tool:
1. STOP retrying immediately.
2. Surface "PERSISTENT ERROR: [tool_name] failed 3 times with: [error]. Unable to resolve." to the orchestrator.
3. Do NOT continue with other work — report and stop.

Applies to ALL tools including `write_file`, `internet_search`, `tavilyExtract`.
