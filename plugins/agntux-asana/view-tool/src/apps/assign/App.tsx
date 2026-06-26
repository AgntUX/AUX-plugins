import React, { useState, Suspense } from "react";
import { assertStructuredContent, ComponentErrorBoundary, ScrollablePanel, safeString, safeArray, safeObject, Spinner } from "@agntux/ui-primitives";
import {
  useToolResult,
  useAppsClient,
  useHostStyleVariables,
  useDocumentTheme,
} from "../../lib/apps-react/index.js";
import { buildAssignEnvelope } from "./lib/build-envelope.js";
import { ExternalLink } from "../../components/external-link.js";

interface Assignee {
  gid: string;
  name: string;
}

interface AssignPayload {
  task_gid: string;
  task_url: string;
  task_title: string;
  current_assignee: string;
  candidate_assignees: Assignee[];
  note_body: string;
}

function parseAssignees(raw: unknown[]): Assignee[] {
  const result: Assignee[] = [];
  for (const item of raw) {
    const o = safeObject(item);
    const gid = safeString(o["gid"]);
    const name = safeString(o["name"]);
    if (gid && name) {
      result.push({ gid, name });
    }
  }
  return result;
}

function AssignForm() {
  useHostStyleVariables();
  useDocumentTheme();

  const client = useAppsClient();
  const toolOutput = useToolResult();
  const raw = assertStructuredContent<AssignPayload>(
    toolOutput as Record<string, unknown> | undefined,
  );

  const taskGid = safeString(raw?.task_gid);
  const taskUrl = safeString(raw?.task_url);
  const taskTitle = safeString(raw?.task_title, "Asana task");
  const currentAssignee = safeString(raw?.current_assignee);
  const candidates = parseAssignees(safeArray(raw?.candidate_assignees));

  const firstGid = candidates.length > 0 ? candidates[0].gid : "";
  const [selectedGid, setSelectedGid] = useState(firstGid);
  const [note, setNote] = useState(safeString(raw?.note_body));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentWithComment, setSentWithComment] = useState(false);
  const [error, setError] = useState("");

  async function handleSend() {
    if (!selectedGid) return;
    setSending(true);
    setError("");
    try {
      const trimmedNote = note.trim();
      const envelopeArgs: Parameters<typeof buildAssignEnvelope>[0] = {
        task_gid: taskGid,
        assignee_gid: selectedGid,
      };
      if (trimmedNote) envelopeArgs.note = trimmedNote;
      const envelope = buildAssignEnvelope(envelopeArgs);
      await client.sendFollowUpMessage(envelope);
      if (trimmedNote) setSentWithComment(true);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reassign task.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    const successMessage = sentWithComment
      ? "Task has been reassigned and the note has been posted as a comment."
      : "Task has been reassigned.";
    return (
      <ScrollablePanel title="Task reassigned">
        <div className="p-4 text-sm text-green-700">
          {successMessage}
        </div>
      </ScrollablePanel>
    );
  }

  const headerTitle = (
    <span className="text-sm font-semibold text-gray-900 truncate">
      Reassign task
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
        disabled={sending || !selectedGid}
        onClick={() => void handleSend()}
        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sending ? <Spinner size={4} /> : null}
        Reassign task
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
          {currentAssignee && (
            <div className="mt-0.5 text-xs text-gray-500">
              Currently assigned to: {currentAssignee}
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

        {/* Assignee select */}
        <div>
          <label
            htmlFor="asana-assignee-select"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Assign to
          </label>
          {candidates.length > 0 ? (
            <select
              id="asana-assignee-select"
              value={selectedGid}
              onChange={(e) => setSelectedGid(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {candidates.map((a) => (
                <option key={a.gid} value={a.gid}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-gray-500">No candidates available.</p>
          )}
        </div>

        {/* Optional note */}
        <div>
          <label
            htmlFor="asana-assign-note"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Note (optional)
          </label>
          <textarea
            id="asana-assign-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note about this reassignment..."
            className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
        </div>
      </div>
    </ScrollablePanel>
  );
}

export function AssignApp() {
  return (
    <ComponentErrorBoundary>
      <Suspense fallback={<Spinner />}>
        <AssignForm />
      </Suspense>
    </ComponentErrorBoundary>
  );
}
