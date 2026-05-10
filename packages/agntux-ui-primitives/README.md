# @agntux/ui-primitives

Shared React primitives for AgntUX UI-handler component bundles.

> **Internal AgntUX workspace package.** Never published to npmjs.org.

## What's in here

| Export | Purpose |
|---|---|
| `ScrollablePanel` | Sticky-header / scrollable-body / sticky-footer layout primitive. The default frame for any inline-iframe view. |
| `AgntuxLogo` | Two-tone wordmark (`Agnt` adapts to `currentColor`; `UX` renders in the brand gradient). |
| `Spinner` | Inline pulsing-dot indicator with a status role. |
| `ComponentErrorBoundary` | Class boundary with a "Something went wrong" + Retry surface. Wrap `MainComponent` with this. |
| `ServerErrorScreen` | Full-surface renderer for any tool-level error envelope (rate limit, auth failure, upstream 5xx). Pair with `detectErrorEnvelope`. |
| `detectErrorEnvelope` | Recognises an MCP error-envelope shape from `tools/call`. Returns the user-facing text or `null`. |
| `safeArray`, `safeString`, `safeNumber`, `safeBoolean`, `safeObject`, `safeEnum`, `safeDate`, `formatTime`, `daysSince` | Defensive coercion helpers for streaming/partial tool payloads. |

## How to consume

Each UI handler's `component/package.json` declares this package as a workspace
dependency:

```json
{
  "dependencies": {
    "@agntux/ui-primitives": "*"
  }
}
```

Imports use the package name:

```ts
import {
  ScrollablePanel,
  AgntuxLogo,
  ComponentErrorBoundary,
  ServerErrorScreen,
  detectErrorEnvelope,
  safeArray,
  safeString,
} from "@agntux/ui-primitives";
```

The handler's Vite + `vite-plugin-singlefile` build inlines this package into
the per-handler bundle through standard node-module-resolution. No build
config change is required beyond declaring the dependency.

### Tailwind content discovery

The primitives use Tailwind utility classes. Each handler's
`tailwind.config.mjs` must include the package source in its `content` glob so
the classes are picked up:

```js
content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}',
  '../../../../../packages/agntux-ui-primitives/src/**/*.{js,ts,jsx,tsx}',
],
```

## Why no apps-react dependency

`ScrollablePanel` accepts an optional `onHelpClick` callback rather than
calling `useAppsClient().openLink(...)` itself. Each handler vendors its own
copy of the apps-client SDK shim, so the shared primitive intentionally stays
free of that dependency. The caller wires the deep-link dispatch.

## License

[Apache License 2.0](../../LICENSE).
