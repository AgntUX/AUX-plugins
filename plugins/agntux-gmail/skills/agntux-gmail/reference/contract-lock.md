# Gmail schema.lock self-heal — Step 0 sub-step 2.5

Companion to `../SKILL.md` Step 0. Gmail-specific defensive lock check
that mirrors the validator's `schema.lock.json` lookup so the skill
can fail fast (or self-heal inline) when `plugin_contracts["agntux-gmail"]`
is missing — typically because Mode B hasn't been re-run since this
plugin was installed.

## Read order

`<agntux project root>/data/schema/schema.lock.json` — read it after
the contract markdown (sub-steps 1–2) and verify
`plugin_contracts["agntux-gmail"]` is present. The validator hook
(`validate-schema.mjs`) trusts `schema.lock.json`, not the markdown
contract — the markdown is informational; the lock is what gates
writes. Mirroring the validator's lookup here lets you fail fast
instead of doing entity work that will be wasted at action-write time.

## When the entry is missing

### Scheduled-task fire (no user present)

Exit cleanly. Append a `contract-not-registered` entry to
`sync.md → errors`. The validator emits a self-healing runbook on the
next interactive invocation that triggers an action write — that's the
right moment to update the lock, not now.

### Interactive invocation

Register the plugin inline now (you already have the contract parsed
in working memory, so re-emitting the validator's runbook would
round-trip for no reason):

1. Edit `<root>/data/schema/schema.lock.json`. Add a sibling key
   `agntux-gmail` under `plugin_contracts` populated from the contract
   markdown:
   - `schema_version` — frontmatter field of the contract.
   - `allowed_subtypes` — extracted from the contract body section
     that enumerates the entity subtypes the plugin may write (the
     `## Owned subtypes` section in the current gmail contract).
   - `allowed_action_classes` — extracted from the body section that
     enumerates action classes (the `## reason_class enum` section in
     the current gmail contract).
   - `approved_at` — current RFC 3339 timestamp.
   - `source_id_format` — copied from contract frontmatter.
2. Bump `schema.lock.json → generated_at` to the same RFC 3339
   timestamp.

Then continue.

## Authority boundaries

This skill MAY add a missing `plugin_contracts["agntux-gmail"]` entry
to `data/schema/schema.lock.json` only when:

- The invocation is interactive (a user is present to see the inline
  self-heal narration).
- The contract markdown sits at `status: approved`.
- All values come from the contract markdown — no invention.

This is a fast-path mirror of the architect's Mode B sweep. The skill
MUST NOT touch any other section of `schema.lock.json` or any other
file under `data/schema/`.
