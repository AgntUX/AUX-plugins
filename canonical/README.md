# canonical/ — Source of Truth for Plugin Templates

This directory is the **single source of truth** for the bytes that P6's plugin
generator copies into every generated plugin. Nothing in here is runtime code for
this repo — it is template material that flows downstream into `plugins/*/`.

> **Enforcement note:** The CI workflows referenced below
> (`hook-hash-check.yml`, `lint.yml`) ship via T11/T12. Until those PRs merge,
> the byte-freeze contract and prompt-lint gates rely on reviewer discipline
> against the rules documented in this README.

---

## Directory map

```
canonical/
├── hooks/                     # Byte-frozen license hook bundle (P2 §8)
│   ├── hooks.json             # SessionStart + PreToolUse wiring
│   ├── license-check.mjs      # SessionStart entrypoint
│   ├── license-validate.mjs   # PreToolUse entrypoint
│   ├── checksums.txt          # SHA-256 of every file in this bundle
│   ├── lib/
│   │   ├── jwt-verify.mjs
│   │   ├── cache.mjs
│   │   ├── refresh.mjs
│   │   ├── ui.mjs
│   │   ├── device.mjs
│   │   ├── scope.mjs
│   │   ├── public-key.mjs     # Template — substituted per plugin at copy time
│   │   └── agntux-plugins.mjs # Template — substituted per plugin at copy time
│   └── test/                  # Hook unit + integration tests (run in CI)
├── prompts/
│   ├── orchestrator/          # agntux-core prompt templates (T15)
│   └── ingest/                # Per-source ingest prompt templates (T16/T17)
├── mcp-server-templates/
│   ├── orchestrator/          # agntux-core MCP server TS source (T15)
│   └── ingest/                # Per-source ingest MCP server TS template (T19/T20)
└── kms-public-keys.json       # Active + retired Ed25519 public keys
```

---

## Ownership table

| Subdirectory | Owner plan | Owner task | Change process |
|---|---|---|---|
| `hooks/` | P2 §8 | T07 (shipped); updates via T13 redeploy | Byte-freeze workflow — see below |
| `prompts/orchestrator/` | P4 §3–§5, §8 | T15 | PR + linter must pass |
| `prompts/ingest/` | P5 §3–§4 | T16/T17 | PR + linter must pass |
| `mcp-server-templates/orchestrator/` | P4 §6 | T15 | PR + manual review |
| `mcp-server-templates/ingest/` | P5 §6–§7 | T19/T20 | PR + manual review |
| `kms-public-keys.json` | P2 §4.4, §11.3 | T05 (shipped); updates via key rotation | Key-rotation runbook — see below |

---

## hooks/ — Byte-freeze contract

`hooks/` is **byte-frozen**. Every file in this directory has a SHA-256 entry in
`hooks/checksums.txt`. CI (`hook-hash-check.yml`) verifies two invariants on every PR:

1. Every plugin's `hooks/` directory is byte-for-byte identical to `canonical/hooks/`
   for all files except `lib/public-key.mjs` and `lib/agntux-plugins.mjs`
   (the two template files substituted per plugin at copy time).
2. The checksums in `canonical/hooks/checksums.txt` match the actual bytes of
   `canonical/hooks/` on `main`.

**Never edit files in `hooks/` directly.** The only legitimate path to changing
`hooks/` is:

1. Open a PR that modifies the hook source.
2. Recompute checksums. The byte-freeze covers only the runtime bundle — `hooks.json`,
   `lib/*.mjs`, and the top-level `*.mjs` entry points. The `test/` tree is
   intentionally excluded (tests run in CI but are not part of the runtime surface
   plugins ship). Use this exact command:
   ```bash
   cd canonical/hooks && \
     find . -type f \( -name '*.mjs' -o -name '*.json' \) \
       -not -path './test/*' -not -name 'checksums.txt' \
     | sort \
     | xargs shasum -a 256 \
     | sed 's| \./| |' > checksums.txt
   ```
   Verify by running `shasum -a 256 -c checksums.txt` and confirming all-OK.
3. The CI `hook-hash-check.yml` workflow runs automatically and must pass.
4. A second maintainer approves. Merge.

After the merge, every plugin's `hooks/` must be updated to the new bytes in the
same PR or a coordinated follow-up. Use `/update-canonical-hooks` to walk through
the verification.

### Two template files

`lib/public-key.mjs` and `lib/agntux-plugins.mjs` are the only files in `hooks/`
that differ between plugins. They carry substitution placeholders:

| File | Placeholder | Substituted value | Substituted by |
|---|---|---|---|
| `lib/public-key.mjs` | `{{PUBLIC_KEY_KID}}` | `"agntux-license-v1"` | P6 generator at plugin-build time |
| `lib/public-key.mjs` | `{{PUBLIC_KEY_SPKI_PEM}}` | PEM string from `kms-public-keys.json` | P6 generator at plugin-build time |
| `lib/agntux-plugins.mjs` | `["{{AGNTUX_PLUGIN_SLUGS}}"]` | `["agntux-core","agntux-slack",...]` | P6 generator at plugin-build time |

**Important — array-bracketed special case for `AGNTUX_PLUGIN_SLUGS`:**

The placeholder in `lib/agntux-plugins.mjs` is wrapped in array brackets for ESM
syntactic validity:

```js
export const AGNTUX_PLUGIN_SLUGS = ["{{AGNTUX_PLUGIN_SLUGS}}"];
```

P6's substitution step replaces the **entire bracketed expression**
`["{{AGNTUX_PLUGIN_SLUGS}}"]` with a JSON array literal, e.g.:

```js
export const AGNTUX_PLUGIN_SLUGS = ["agntux-core", "agntux-slack", "agntux-gmail"];
```

Do **not** write a substitution that replaces only the bare token `{{AGNTUX_PLUGIN_SLUGS}}`
— that would produce `["agntux-core, agntux-slack, agntux-gmail"]` (a single-element
array containing a comma-separated string), which is wrong.

These two files are exempt from the byte-identity CI check. All other files in
`hooks/` must be byte-identical to `canonical/hooks/`.

---

## prompts/ — Change process

Prompt templates in `prompts/orchestrator/` and `prompts/ingest/` are copied verbatim
(with placeholder substitution) by P6's generator. Changes affect every plugin
generated after the change.

Change process:
1. Open a PR modifying the prompt template(s).
2. The CI `lint.yml` workflow runs the P15 linter against the templates.
3. Review: confirm the change is intentional and the bump rules (P7 §5) are respected
   (a prompt behaviour change that breaks user expectations is a MAJOR bump for
   every plugin that ships the template).
4. A second maintainer approves. Merge.

Placeholders use `{{double-curly}}` format. See each subdirectory's `STUBS.md` for
the full placeholder inventory.

---

## mcp-server-templates/ — Change process

MCP server TypeScript templates in `mcp-server-templates/` are copied and compiled
by P6's generator. Changes affect every plugin generated after the change.

Change process:
1. Open a PR modifying the template source.
2. CI runs TypeScript compilation against the template (`tsc --noEmit`).
3. **Manual review required**: MCP server changes can break the tool-call protocol
   between the UI and the host. A maintainer must smoke-test the compiled output
   against a local plugin before approving.
4. A second maintainer approves. Merge.

---

## kms-public-keys.json — Key rotation

`kms-public-keys.json` records the active and retired Ed25519 public keys used by
the license hook (`lib/public-key.mjs`) and the render-token gate
(`component-template/src/lib/license.ts`).

**To rotate a key:**

1. Follow the runbook at `~/.claude/plans/p2-keys.md` to provision a new key pair
   in AWS KMS and verify the public key export.
2. Add the new key entry to `kms-public-keys.json` with `"status": "active"` and
   `"rotation_status": "primary"`.
3. Set the old key's `"rotation_status"` to `"retiring"` (keep `"status": "active"`
   during the transition window so tokens signed with the old key remain valid).
4. Open a PR. CI validates the JSON schema.
5. After merge, P6 regenerates plugins with the new `PUBLIC_KEY_SPKI_PEM`. The next
   plugin version bump ships the new key to end users.
6. After the transition window (≥24 h, matching JWT lifetime), set the old key's
   `"status": "retired"`. Tokens signed with it are now naturally expired.

Key rotation propagates to `canonical/hooks/lib/public-key.mjs` on the next T13
redeploy (P6 reads `kms-public-keys.json` from `canonical/` at plugin-build time).
The `checksums.txt` is recomputed as part of that redeploy because `public-key.mjs`
is one of the two template files exempt from the byte-identity check.

Private keys never leave AWS KMS. This file contains public keys only.

---

## Substitution placeholders — full inventory

All placeholders across `canonical/` use `{{double-curly}}` format exclusively.
No `${}`, `%s`, or other formats are used.

| Placeholder | Location | Substituted by | Notes |
|---|---|---|---|
| `{{PUBLIC_KEY_KID}}` | `hooks/lib/public-key.mjs` | P6 generator | Reads from `kms-public-keys.json` |
| `{{PUBLIC_KEY_SPKI_PEM}}` | `hooks/lib/public-key.mjs` | P6 generator | Reads from `kms-public-keys.json` |
| `["{{AGNTUX_PLUGIN_SLUGS}}"]` | `hooks/lib/agntux-plugins.mjs` | P6 generator | **Array-bracketed** — replace entire expression |
| `{{plugin-slug}}` | `prompts/ingest/orchestrator.md`, `prompts/ingest/ingest.md` | P6 generator | e.g. `agntux-slack` (every AgntUX plugin slug starts with `agntux-`) |
| `{{source-display-name}}` | `prompts/ingest/orchestrator.md`, `prompts/ingest/ingest.md` | P6 generator | e.g. `Apple Notes` |
| `{{source-slug}}` | `prompts/ingest/ingest.md` | P6 generator | e.g. `notes` |
| `{{recommended-cadence}}` | `prompts/ingest/orchestrator.md`, `prompts/ingest/ingest.md` | P6 generator | e.g. `Daily 09:00` |
| `{{source-cursor-semantics}}` | `prompts/ingest/ingest.md` | P6 generator | e.g. `local-file modification time (RFC 3339)` |
| `{{source-mcp-tools}}` | `prompts/ingest/ingest.md` | P6 generator | e.g. `the local filesystem MCP server` |
| `{{ui-handler-trigger-list}}` | `prompts/ingest/orchestrator.md` | P6 generator | One bullet per UI component, or `(unused)` |
| `{{plugin-version}}` | `prompts/ingest/ingest.md` | P6 generator | e.g. `1.0.0` |
| `{{AGNTUX_APP_ID}}` | `mcp-server-templates/*/` | P6 generator | Per-plugin app ID |
| `{{ui-name}}` | `mcp-server-templates/ingest/` | P6 generator | Per view tool, e.g. `thread` |

The `AGNTUX_PLUGIN_SLUGS` special case is the only placeholder where the substitution
target includes the surrounding array brackets. All other placeholders replace the
`{{token}}` only.
