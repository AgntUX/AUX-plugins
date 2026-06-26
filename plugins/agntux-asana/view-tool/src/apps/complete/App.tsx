import React, { useState, Suspense } from "react";
import { assertStructuredContent, ComponentErrorBoundary, ScrollablePanel, safeString, safeBoolean, Spinner } from "@agntux/ui-primitives";
import {
  useToolResult,
  useAppsClient,
  useHostStyleVariables,
  useDocumentTheme,
} from "../../lib/apps-react/index.js";
import { buildCompleteEnvelope } from "./lib/build-envelope.js";
import { ExternalLink } from "../../components/external-link.js";

interface CompletePayload {
  task_gid: string;
  task_url: string;
  task_title: string;
  project_name: string;
  completed: boolean;
  due_on: string;
}

function CompleteForm() {
  useHostStyleVariables();
  useDocumentTheme();

  const client = useAppsClient();
  const toolOutput = useToolResult();
  const raw = assertStructuredContent<CompletePayload>(
    toolOutput as Record<string, unknown> | undefined,
  );

  const taskGid = safeString(raw?.task_gid);
  const taskUrl = safeString(raw?.task_url);
  const taskTitle = safeString(raw?.task_title, "Asana task");
  const projectName = safeString(raw?.project_name);

  const [completed, setCompleted] = useState(safeBoolean(raw?.completed));
  const [dueOn, setDueOn] = useState(safeString(raw?.due_on));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSend() {
    setSending(true);
    setError("");
    try {
      const envelope = buildCompleteEnvelope({ task_gid: taskGid, completed, due_on: dueOn });
      await client.sendFollowUpMessage(envelope);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update task.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <ScrollablePanel title="Task updated">
        <div className="p-4 text-sm text-green-700">
          Task updated successfully.
        </div>
      </ScrollablePanel>
    );
  }

  const headerTitle = (
    <span className="text-sm font-semibold text-gray-900 truncate">
      Update task
    </span>
  );

  const footer = (
    <div className="p-3 border-t border-gray-200 flex items-center justify-between gap-2">
      {error && (
        <span className="text-xs text-red-600 flex-1">{error}</span>
      )}
      {!error && <span className="flex-1" />}
      <button
        type="button"
        disabled={sending}
        onClick={() => void handleSend()}
        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sending ? <Spinner size={4} /> : null}
        Update task
      </button>
    </div>
  );

  return (
    <ScrollablePanel
      title={headerTitle}
      helpLabel="Open in Asana"
      footer={footer}
    >
      <div className="p-3 space-y-3">
        {/* Task context quote */}
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
          <div className="font-medium text-gray-900 truncate">{taskTitle}</div>
          {projectName && (
            <div className="mt-0.5 text-xs text-gray-500">
              Project: {projectName}
            </div>
          )}
          {taskUrl && (
            <ExternalLink
              href={taskUrl}
              className="mt-1 inline-block text-xs text-indigo-600 hover:underline"
            >
              Open in Asana
            </ExternalLink>
          )}
        </div>

        {/* Mark complete */}
        <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={completed}
            onChange={(e) => setCompleted(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          Mark complete
        </label>

        {/* Due date */}
        <div>
          <label
            htmlFor="asana-due-date"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Due date
          </label>
          <input
            id="asana-due-date"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>
    </ScrollablePanel>
  );
}

export function CompleteApp() {
  return (
    <ComponentErrorBoundary>
      <Suspense fallback={<Spinner />}>
        <CompleteForm />
      </Suspense>
    </ComponentErrorBoundary>
  );
}
