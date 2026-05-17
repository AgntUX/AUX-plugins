/**
 * App.tsx - Protocol-Agnostic Widget Wrapper
 *
 * Bridges mcp-apps-kit hooks to the MainComponent props interface:
 * - Protocol detection (MCP Apps)
 * - Host context (theme, locale, display mode, safe area)
 * - Tool input/output — including streaming partial input
 * - Widget state persistence
 *
 * Coding agents: edit `components/main-component.tsx`, not this file.
 * The ONE exception: protocol-level additions (new host notifications) live
 * here. The `useOnToolInputPartial` wiring below is an example of that rule —
 * it bridges the streaming `ui/notifications/tool-input-partial` protocol
 * notification into a prop that MainComponent can read.
 */

import { useState } from 'react';
import {
  useAppsClient,
  useToolResult,
  useToolInput,
  useOnToolInputPartial,
  useHostContext,
  useWidgetState,
  useDisplayMode,
  useSafeAreaInsets,
  useDocumentTheme,
  useHostStyleVariables,
} from './lib/apps-react/index.js';
import {
  MainComponent,
  type MainComponentProps,
} from './components/main-component';
import {
  ComponentErrorBoundary,
  ServerErrorScreen,
  detectErrorEnvelope,
} from '@agntux/ui-primitives';

export function App() {
  // Apply theme class to document body
  useDocumentTheme('light', 'dark');

  // Apply host-provided CSS variables (overrides defaults in globals.css)
  useHostStyleVariables();

  // Core hooks
  const client = useAppsClient();
  const toolResult = useToolResult();
  const toolInput = useToolInput();
  const hostContext = useHostContext();

  // Widget state (persisted by host)
  const [widgetState, setWidgetState] = useWidgetState<Record<string, unknown>>(
    {},
  );

  // Display mode
  const { mode: displayMode, availableModes, requestMode } = useDisplayMode();

  // Safe area insets for mobile
  const safeArea = useSafeAreaInsets();

  // Progressive rendering: capture every streaming partial the host emits.
  // The host sends the FULL current arguments each time (not a delta).
  // Fields can be absent, null, or mid-key-transition — the component's
  // parsePayload() must tolerate them.
  const [partialInput, setPartialInput] = useState<
    Record<string, unknown> | undefined
  >(undefined);
  useOnToolInputPartial((input) => setPartialInput(input));

  // Unwrap tool-name key from toolResult
  const toolOutput =
    toolResult && Object.keys(toolResult).length > 0
      ? (Object.values(toolResult)[0] as Record<string, unknown> | undefined)
      : undefined;

  // Before the real tool-result arrives, synthesize a toolOutput envelope from
  // the partial input so MainComponent's parsePayload() can read from one
  // uniform shape. Wrap in `_meta.payload` to match the relay-pattern envelope.
  const effectiveToolOutput =
    toolOutput ??
    (partialInput && Object.keys(partialInput).length > 0
      ? ({ _meta: { payload: partialInput } } as Record<string, unknown>)
      : undefined);

  // True while the host is streaming partials but the real tool-result has
  // not yet arrived. Component MUST disable interactive controls while this
  // is true (see main-component.tsx for the fieldset-disabled pattern).
  const isStreaming = !toolOutput && !!partialInput;

  // Short-circuit when the tool result is an MCP-layer error envelope.
  // The adapter strips `isError`, but the user-facing text survives in
  // `_content[0].text` and the lack of any payload-shaped keys is the
  // signature of an envelope without `structuredContent`.
  const errorEnvelope = detectErrorEnvelope(toolOutput);
  if (errorEnvelope) {
    return (
      <div className="h-full">
        <ComponentErrorBoundary>
          <ServerErrorScreen message={errorEnvelope} />
        </ComponentErrorBoundary>
      </div>
    );
  }

  // Build props for MainComponent
  const props: MainComponentProps = {
    // Tool data
    toolInput,
    toolOutput: effectiveToolOutput,
    isStreaming,

    // Host context
    theme: hostContext.theme,
    locale: hostContext.locale,
    displayMode,
    availableDisplayModes: availableModes,
    safeArea,
    viewport: hostContext.viewport,
    platform: hostContext.platform,

    // Widget state
    widgetState,
    setWidgetState,

    // Actions
    callTool: client.callTool.bind(client),
    sendFollowUpMessage: client.sendFollowUpMessage.bind(client),
    openLink: client.openLink.bind(client),
    requestDisplayMode: requestMode,
  };

  return (
    <div className="h-full">
      <ComponentErrorBoundary>
        <MainComponent {...props} />
      </ComponentErrorBoundary>
    </div>
  );
}
