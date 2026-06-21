/**
 * App.tsx — protocol bridge for the imessage-reply handler.
 *
 * Bridges mcp-apps-kit hooks to ReplyComponent's props interface.
 * Mirror of the canonical _template App.tsx — edit components/ReplyComponent,
 * not this file.
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
import { ComponentErrorBoundary, ServerErrorScreen, detectErrorEnvelope } from "@agntux/ui-primitives";
import {
  ReplyComponent,
  type MainComponentProps,
} from './components/ReplyComponent.js';

export function App() {
  useDocumentTheme('light', 'dark');
  useHostStyleVariables();

  const client = useAppsClient();
  const toolResult = useToolResult();
  const toolInput = useToolInput();
  const hostContext = useHostContext();

  const [widgetState, setWidgetState] = useWidgetState<Record<string, unknown>>({});

  const { mode: displayMode, availableModes, requestMode } = useDisplayMode();
  const safeArea = useSafeAreaInsets();

  const [partialInput, setPartialInput] = useState<
    Record<string, unknown> | undefined
  >(undefined);
  useOnToolInputPartial((input) => setPartialInput(input));

  const toolOutput =
    toolResult && Object.keys(toolResult).length > 0
      ? (Object.values(toolResult)[0] as Record<string, unknown> | undefined)
      : undefined;

  const effectiveToolOutput =
    toolOutput ??
    (partialInput && Object.keys(partialInput).length > 0
      ? ({ _meta: { payload: partialInput } } as Record<string, unknown>)
      : undefined);

  const isStreaming = !toolOutput && !!partialInput;

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

  const props: MainComponentProps = {
    toolInput,
    toolOutput: effectiveToolOutput,
    isStreaming,
    theme: hostContext.theme,
    locale: hostContext.locale,
    displayMode,
    availableDisplayModes: availableModes,
    safeArea,
    viewport: hostContext.viewport,
    platform: hostContext.platform,
    widgetState,
    setWidgetState,
    callTool: client.callTool.bind(client),
    sendFollowUpMessage: client.sendFollowUpMessage.bind(client),
    requestDisplayMode: requestMode,
  };

  return (
    <div className="h-full">
      <ComponentErrorBoundary>
        <ReplyComponent {...props} />
      </ComponentErrorBoundary>
    </div>
  );
}
