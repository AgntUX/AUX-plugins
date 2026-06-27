/**
 * SignApp — protocol bridge for the DocuSign sign (open-in) view.
 * Edit `components/main-component.tsx`, not this file.
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
} from '../../lib/apps-react/index.js';
import {
  SignMainComponent,
  type SignMainComponentProps,
} from './components/main-component.js';
import { ComponentErrorBoundary, ServerErrorScreen, detectErrorEnvelope } from "@agntux/ui-primitives";

export function SignApp() {
  useDocumentTheme('light', 'dark');
  useHostStyleVariables();

  const client = useAppsClient();
  const toolResult = useToolResult();
  const toolInput = useToolInput();
  const hostContext = useHostContext();

  const [widgetState, setWidgetState] = useWidgetState<Record<string, unknown>>({});

  const { mode: displayMode, availableModes, requestMode } = useDisplayMode();
  const safeArea = useSafeAreaInsets();

  const [partialInput, setPartialInput] = useState<Record<string, unknown> | undefined>(undefined);
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

  const props: SignMainComponentProps = {
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
    openLink: (url: string) => void client.openLink(url),
  };

  return (
    <div className="h-full">
      <ComponentErrorBoundary>
        <SignMainComponent {...props} />
      </ComponentErrorBoundary>
    </div>
  );
}
