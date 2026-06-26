import React, { useState, Suspense } from "react";
import { assertStructuredContent, ComponentErrorBoundary, ScrollablePanel, safeString, safeArray, safeObject, Spinner } from "@agntux/ui-primitives";
import {
  useToolResult,
  useAppsClient,
  useHostStyleVariables,
  useDocumentTheme,
} from "../../lib/apps-react/index.js";
import { buildCreateEnvelope } from "./lib/build-envelope.js";

interface Assignee {
  gid: string;
  name: string;
}

interface Project {
  gid: string;
  name: string;
}

interface CreatePayload {
  parent_task_title: string;
  draft_name: string;
  candidate_assignees: Assignee[];
  due_on: string;
  candidate_projects: Project[];
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

function parseProjects(raw: unknown[]): Project[] {
  const result: Project[] = [];
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

function CreateForm() {
  useHostStyleVariables();
  useDocumentTheme();

  const client = useAppsClient();
  const toolOutput = useToolResult();
  const raw = assertStructuredContent<CreatePayload>(
    toolOutput as Record<string, unknown> | undefined,
  );

  const parentTitle = safeString(raw?.parent_task_title);
  const candidates = parseAssignees(safeArray(raw?.candidate_assignees));
  const projects = parseProjects(safeArray(raw?.candidate_projects));

  const [taskName, setTaskName] = useState(safeString(raw?.draft_name));
  const [dueOn, setDueOn] = useState(safeString(raw?.due_on));
  const firstAssigneeGid = candidates.length > 0 ? candidates[0].gid : "";
  const firstProjectGid = projects.length > 0 ? projects[0].gid : "";
  const [assigneeGid, setAssigneeGid] = useState(firstAssigneeGid);
  const [projectGid, setProjectGid] = useState(firstProjectGid);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSend() {
    if (!taskName.trim()) return;
    setSending(true);
    setError("");
    try {
      const envelope = buildCreateEnvelope({
        name: taskName.trim(),
        assignee_gid: assigneeGid || undefined,
        due_on: dueOn || undefined,
        project_gid: projectGid || undefined,
      });
      await client.sendFollowUpMessage(envelope);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create task.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <ScrollablePanel title="Task created">
        <div className="p-4 text-sm text-green-700">
          Your follow-up task has been created in Asana.
        </div>
      </ScrollablePanel>
    );
  }

  const headerTitle = (
    <span className="text-sm font-semibold text-gray-900 truncate">
      Create follow-up task
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
        disabled={sending || !taskName.trim()}
        onClick={() => void handleSend()}
        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sending ? <Spinner size={4} /> : null}
        Create task
      </button>
    </div>
  );

  return (
    <ScrollablePanel title={headerTitle} footer={footer}>
      <div className="p-3 space-y-3">
        {/* Parent task context */}
        {parentTitle && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
            <div className="text-xs text-gray-500 mb-0.5">Follow-up on</div>
            <div className="font-medium text-gray-900 truncate">{parentTitle}</div>
          </div>
        )}

        {/* Task name */}
        <div>
          <label
            htmlFor="asana-task-name"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Task name
          </label>
          <input
            id="asana-task-name"
            type="text"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            placeholder="Enter task name..."
            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Assignee */}
        {candidates.length > 0 && (
          <div>
            <label
              htmlFor="asana-create-assignee"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Assignee
            </label>
            <select
              id="asana-create-assignee"
              value={assigneeGid}
              onChange={(e) => setAssigneeGid(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">No assignee</option>
              {candidates.map((a) => (
                <option key={a.gid} value={a.gid}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Due date */}
        <div>
          <label
            htmlFor="asana-create-due"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Due date
          </label>
          <input
            id="asana-create-due"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Project */}
        {projects.length > 0 && (
          <div>
            <label
              htmlFor="asana-create-project"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Project
            </label>
            <select
              id="asana-create-project"
              value={projectGid}
              onChange={(e) => setProjectGid(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.gid} value={p.gid}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </ScrollablePanel>
  );
}

export function CreateApp() {
  return (
    <ComponentErrorBoundary>
      <Suspense fallback={<Spinner />}>
        <CreateForm />
      </Suspense>
    </ComponentErrorBoundary>
  );
}
