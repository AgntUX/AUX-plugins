# `_template/` — parameterized UI handler scaffold

This directory is the parameterized scaffold the `ui-handler-author` specialist
copies from when adding a new MCP App UI handler to a plugin. It is **not** a
working plugin on its own — the placeholders below must be substituted into
concrete values before the handler will compile.

The worked-example reference for how a finished, substituted handler looks is
`AUX-plugins/canonical/ui-handlers/slack-thread/`. This `_template/` directory
generalizes that reference.

## Layout

```
_template/
├── TESTING.md                                 # Per-handler e2e runbook (substitute placeholders + drop next to handler)
├── fixtures/                                  # Four canonical fixture stubs (see "End-to-end fixtures" below)
│   ├── {{ui-name}}-empty.json
│   ├── {{ui-name}}-single-high.json
│   ├── {{ui-name}}-many.json
│   └── {{ui-name}}-error-payload.json
├── handler/
│   └── {{ui-name}}.md                         # Operational manifest skeleton
├── component/                                 # React + Vite single-file bundle
│   ├── AGENTS.md                              # Baked-in best-practices guide
│   ├── package.json                           # Vite + React 18 + vitest
│   ├── vite.config.ts                         # vite-plugin-singlefile
│   ├── tailwind.config.mjs                    # Light-mode-only semantic tokens
│   ├── src/
│   │   ├── App.tsx                            # Protocol wrapper (do-not-modify)
│   │   ├── components/
│   │   │   ├── main-component.tsx             # Skeleton with parsePayload, fieldset disabled, streaming indicator
│   │   │   ├── empty-state.tsx                # Default empty state
│   │   │   └── layouts.tsx                    # Display-mode layouts
│   │   ├── lib/
│   │   │   ├── apps-react/                    # MCP App SDK hooks
│   │   │   └── apps-client/                   # Protocol detection
│   │   ├── globals.css                        # Semantic CSS variables
│   │   └── __tests__/                         # Happy-path / empty / error / interaction
│   └── locales/en-US.json
└── mcp-server/
    └── src/
        ├── tools/
        │   └── {{ui-name}}-view.ts            # Stateless view tool scaffold
        └── ui-resources/
            └── {{ui-name}}.ts                 # ui:// resource registration (build-time embed)
```

## Placeholders the scaffolder substitutes

These `{{kebab-case}}` tokens are substituted at scaffold time. The scaffolder
derives every variant from a single canonical `{{ui-name}}` plus the plugin
manifest:

| Placeholder | Where it appears | Example |
|---|---|---|
| `{{plugin-slug}}` | `handler/*.md`, `mcp-server/src/**/*.ts`, AGENTS.md | `agntux-slack` |
| `{{ui-name}}` | filenames, `ui://...` URIs, manifest, ts-source | `slack-thread` |
| `{{view-tool-name}}` | tool descriptor, handler comments | `slack_thread_view` |
| `{{ui-name-camel}}` | TS exports (`slackThreadBundle`, `slackThreadBundleBase64`) | `slackThread` |
| `{{ui-name-pascal}}` | TS interface + handler names (`SlackThreadStructuredContent`, `handleSlackThreadView`) | `SlackThread` |
| `{{ui-display-name}}` | Markdown headings, descriptions, tool descriptions | `Slack thread` |
| `{{source-display}}` | "fetch from {{source-display}}" copy in handler doc | `Slack` |
| `{{source-noun}}` | Degraded-state copy ("That {{source-noun}} is no longer available") | `Slack thread` |
| `{{source-mcp-prefix}}` | `tools:` allow-list in handler frontmatter | `slack` |
| `{{primary-id-field}}` | Required input slot on the view tool | `thread_ts` |
| `{{primary-verb-phrase}}` | First entry in `operational.verb_phrases` | `display the slack thread UI for {ref}` |
| `{{primary-payload-fields}}` | Tool description copy | `thread messages and proposed reply` |
| `{{intent-key-1}}` | First entry in `operational.follow_up_intents` | `send-thread-reply` |
| `{{intent-prompt-template}}` | Body of the first `### intent-key:...` section | (multi-line prompt) |
| `{{field-1}}` … `{{field-2}}` | Concrete `structured_content_schema` entries | `thread_messages`, `proposed_reply` |
| `{{type-1}}` … `{{description-1}}` | Per-field type + prose in the schema table | `array`, `Messages in the thread` |
| `{{additional-degraded-state}}` | Optional extra degraded-state row | `draft_text_invalid` |
| `{{degraded-state-action}}` | Per-row degraded-state copy | `Surface 'The orchestrator drafted incomplete reply text'` |

Single-curly tokens like `{ref}`, `{ids}`, `{text}`, `{action_id}` are runtime
slots filled by the host at click time — they are **NOT** scaffolder-substituted.
They appear inside `verb_phrases` and intent-prompt templates only.

## Distribution model — git-native build-time embed

This template ships the component bundle inside the plugin tree, not via S3.
After substitution, the per-plugin layout is:

```
plugins/{slug}/ui-handlers/{ui-name}/
├── component/                                 # React source
│   └── out/index.html                        # Generated by `npm run build`
└── mcp-server/                                # Compiled by the embed step
    └── src/ui-resources/{ui-name}.ts          # __EMBED__{ui-name}__INDEX_HTML__ placeholder
```

At MCP server build time, `scripts/embed-bundle.mjs` (delivered by the
scaffolder alongside the template) reads each `out/index.html` and replaces
the matching `__EMBED__<name>__INDEX_HTML__` placeholder with the bundle's
base64 contents in the compiled JS output. The CI workflow runs
`scripts/check-bundle-sync.mjs` which fails if `out/index.html` and the embed
are out of sync.

This eliminates: S3 signing, runtime filesystem reads, network failures
during `resources/read`, and any per-host content distribution. It matches the
"stateless view tool" discipline from `relay-pattern.md` — the component
bundle ships inline with the server that serves it.

## Wire-in steps after substitution

1. **Handler manifest** — copied to `agents/ui-handlers/{ui-name}.md`. Lists
   the verb phrases, structured-content schema, and follow-up intents.
2. **View tool** — copied to `mcp-server/src/tools/{ui-name}-view.ts`. Register
   it in the plugin's `mcp-server/src/index.ts` alongside any other view tools:
   ```ts
   import { viewToolDescriptor, handle{{ui-name-pascal}}View } from "./tools/{{ui-name}}-view.js";
   const VIEW_TOOLS = {
     [viewToolDescriptor.name]: {
       description: viewToolDescriptor.description,
       inputSchema: viewToolDescriptor.inputSchema,
       handler: handle{{ui-name-pascal}}View,
     },
   };
   ```
3. **UI resource fragment** — merged into `mcp-server/src/ui-resources.ts`.
   The bundle base64 placeholder will be replaced at build time.
4. **Component scaffold** — copied to
   `plugins/{slug}/ui-handlers/{ui-name}/component/`. Run `npm install`,
   `npm run build`, `npm test` from inside that directory.
5. **MCP server build** — the plugin's `npm run build` script must invoke
   `scripts/embed-bundle.mjs` after `tsc` so each compiled JS file has its
   bundle placeholders replaced. The scaffolder ships this hook in
   `mcp-server/package.json#scripts.build`.
6. **SKILL.md intent-key section** — the scaffolder appends a stub
   `## intent-key:{name}` heading to the plugin's SKILL.md so the host knows
   how to fulfil follow-up intents from the component.
7. **Marketplace metadata** — the `manifest-author` specialist appends the
   handler to `listing.yaml.ux_components[]` so the marketplace knows the
   plugin ships a UI.

## End-to-end fixtures

Every shipped UI handler should ship four fixtures under
`plugins/{slug}/ui-handlers/{ui-name}/fixtures/`. The starter stubs
in `_template/fixtures/` are documentation-shaped — replace the
`_doc` field with your own, and adjust `structuredContent` to match
the schema the view tool produces.

| Fixture | Asserts |
|---|---|
| `{{ui-name}}-empty.json` | Bootstrap-period empty state — reassuring tone, no FORBIDDEN words, not stuck in skeleton. |
| `{{ui-name}}-single-high.json` | Single high-priority item with the primary action surface visible at 600px viewport. |
| `{{ui-name}}-many.json` | Wide scope — internal scroll discipline, sticky headers, no horizontal scroll. |
| `{{ui-name}}-error-payload.json` | Invalid / partial structuredContent — component degrades gracefully, `consoleErrors` MUST be empty. |

The `TESTING.md` template lives in this directory; copy it next to
the fixtures and substitute `{{ui-name}}` and `{{view-tool-name}}`
along with the rest of the placeholder set. The full e2e workflow
(build ordering, harness flags, action-feedback verification, viewport
budget) is canonical at
`canonical/prompts/ui/workflow-testing.md` — `TESTING.md` is the
per-handler quick-reference, not a substitute.

## Shared UI primitives

Cross-handler primitives — `ScrollablePanel`, `AgntuxLogo`, `Spinner`,
`ComponentErrorBoundary`, `ServerErrorScreen`, `detectErrorEnvelope`,
and the `safe-accessors` helpers (`safeArray`, `safeString`,
`safeNumber`, `safeBoolean`, `safeObject`, `safeEnum`, `safeDate`,
`formatTime`, `daysSince`) — live in the marketplace's
`@agntux/ui-primitives` workspace package, not in this template.
After scaffolding a new handler, import them from the package:

```tsx
import {
  ScrollablePanel,
  AgntuxLogo,
  Spinner,
  ComponentErrorBoundary,
  ServerErrorScreen,
  detectErrorEnvelope,
  safeArray,
  safeString,
  safeEnum,
} from '@agntux/ui-primitives';
```

The template's `package.json` already declares the workspace
dependency at `file:../../../../../packages/agntux-ui-primitives`
(matches the AUX-plugins marketplace layout). The template's
`tailwind.config.mjs` content array also includes the package's
source so Tailwind picks up the primitives' utility classes.

For consumers outside the AUX-plugins marketplace tree, replace the
`file:` path with whatever points at the package's location, or
vendor the primitives locally.

**Modals are forbidden in inline iframes** — see
`canonical/prompts/ui/briefing-learnings.md` §2.4 for the retirement
record. The retired `ScrollableModal` primitive's replacement is
`<ScrollablePanel>` (non-modal layout, no overlay, no focus-trap;
the iframe boundary is the focus trap).

## What this template does NOT do

- **Replicate the briefing component's full architecture.** The briefing is
  a complex production reference (3,000+ LOC). Most plugin UIs should be much
  simpler. See `canonical/prompts/ui/briefing-learnings.md` Section 2 for the
  patterns we explicitly do not encode (fire-and-poll via `*-pending.md`,
  `PendingAction` cross-app union, custom hotkey layers).
- **Ship a workflow-test harness.** The agent test loop runs through the
  Stream C harness (`plugin-toolkit/test-harness/`); the template only
  declares vitest happy-path / empty / error scenarios for the renderer.
- **Bundle a pre-rendered example.** `out/index.html` is gitignored on
  purpose — every plugin builds its own bundle from substituted source.

## See also

- `AUX-plugins/canonical/ui-handlers/slack-thread/` — concrete worked example.
- `canonical/prompts/ui/mcp-apps-protocol.md` — wire protocol reference.
- `canonical/prompts/ui/relay-pattern.md` — host ↔ plugin data flow.
- `canonical/prompts/ui/briefing-learnings.md` — durable patterns + anti-patterns.
- `canonical/prompts/ui/state-management.md` — `widgetState` vs `useState` rules.
