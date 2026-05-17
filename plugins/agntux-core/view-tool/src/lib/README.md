# Inlined Library Code

This directory contains code inlined from @mcp-apps-kit packages.

## Source

- **@mcp-apps-kit/ui** v0.5.0
- **@mcp-apps-kit/ui-react** v0.5.0
- Original repo: https://github.com/agntux/mcp-apps-kit
- Date inlined: 2026-01-24

## Structure

```
src/lib/
├── apps-client/              # From @mcp-apps-kit/ui
│   ├── adapters/
│   │   ├── mcp.ts            # MCP Apps protocol adapter
│   │   ├── mock.ts           # Development/testing mock
│   │   └── types.ts          # Adapter interfaces
│   ├── debug/
│   │   ├── logger.ts         # Debug logging system
│   │   └── index.ts
│   ├── utils/
│   │   ├── theme.ts          # Theme utilities
│   │   ├── styles.ts         # Style utilities
│   │   └── index.ts
│   ├── client.ts             # Core client implementation
│   ├── config.ts             # Configuration
│   ├── constants.ts          # Constants
│   ├── detection.ts          # Protocol detection
│   ├── errors.ts             # Error classes
│   ├── types.ts              # Type definitions
│   └── index.ts              # Main exports
└── apps-react/               # From @mcp-apps-kit/ui-react
    ├── context.tsx           # AppsProvider component
    ├── hooks.ts              # React hooks (useAppsClient, useToolResult, etc.)
    └── index.ts              # Main exports
```

## DO NOT MODIFY (with exceptions)

Most code in this directory should **not be modified** except for critical bug fixes.

**Why:**

- Changes here may break compatibility with future mcp-apps-kit updates
- Bugs should be fixed in the upstream mcp-apps-kit repo when possible
- Custom modifications fragment the codebase

**Exception: SimpleMcpApp** (`apps-client/simple-mcp-app.ts`) is our own implementation
of the MCP Apps postMessage protocol. It can be modified as needed for CSP compliance,
protocol updates, or bug fixes.

**If you need to modify other files:**

1. Document the change with a comment: `// MODIFIED: [reason] [date]`
2. Consider if the fix should be contributed back to mcp-apps-kit
3. Keep changes minimal and isolated

## MCP Apps Protocol Implementation

This library implements the MCP Apps postMessage protocol directly using
`SimpleMcpApp` (located in `apps-client/simple-mcp-app.ts`).

**Why not use @modelcontextprotocol/ext-apps?**

- MCP Jam requires strict CSP without 'unsafe-eval'
- ext-apps uses Zod, which uses eval for JIT compilation
- Per official MCP Apps docs: "The App class is a convenience wrapper, not a requirement.
  You can implement the postMessage protocol directly."
- Our implementation is CSP-compliant, has zero dependencies, and is ~200-300 lines

See: https://modelcontextprotocol.io/docs/extensions/apps.md

## Usage

Import from the library directories:

```typescript
// From apps-client (protocol adapters, client creation)
import { createClient, AppsClient, detectProtocol } from './lib/apps-client';

// From apps-react (React hooks and context)
import {
  AppsProvider,
  useAppsClient,
  useToolResult,
  useHostContext,
} from './lib/apps-react';
```

## Testing

For testing components that use these libraries, use the test utilities in `src/__tests__/test-utils/`:

- `TestMockAdapter` - Extended mock adapter with test assertions
- `renderWithProvider` - Render components with AppsProvider context
- `createMainComponentProps` - Create props with spies for MainComponent testing

See `AGENTS.md` for complete testing documentation.
