import { useState } from "react";
import {
  useAppsClient,
  useToolResult,
  useOnToolInputPartial,
  useDocumentTheme,
  useHostStyleVariables,
} from "../../lib/apps-react/index.js";
import { ComponentErrorBoundary, ServerErrorScreen, detectErrorEnvelope } from "@agntux/ui-primitives";
import { SchedulingLinkPanel } from "./components/scheduling-link-panel.js";

export function App() {
  useDocumentTheme("light", "dark");
  useHostStyleVariables();

  const client = useAppsClient();
  const toolResult = useToolResult();

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

  return (
    <div className="h-full">
      <ComponentErrorBoundary>
        <SchedulingLinkPanel
          toolOutput={effectiveToolOutput}
          isStreaming={isStreaming}
          sendFollowUpMessage={client.sendFollowUpMessage.bind(client)}
        />
      </ComponentErrorBoundary>
    </div>
  );
}
