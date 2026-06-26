import React, { useState, Suspense } from "react";
import { assertStructuredContent, ComponentErrorBoundary, ScrollablePanel, safeString, Spinner } from "@agntux/ui-primitives";
import {
  useToolResult,
  useAppsClient,
  useHostStyleVariables,
  useDocumentTheme,
} from "../../lib/apps-react/index.js";
import { buildCommentEnvelope } from "./lib/build-envelope.js";
import { ExternalLink } from "../../components/external-link.js";

interface CommentPayload {
  task_gid: string;
  task_url: string;
  task_title: string;
  project_name: string;
  due_on: string;
  draft_body: string;
  personalization_signals: string;
}

function CommentForm() {
  useHostStyleVariables();
  useDocumentTheme();

  const client = useAppsClient();
  const toolOutput = useToolResult();
  const raw = assertStructuredContent<CommentPayload>(
    toolOutput as Record<string, unknown> | undefined,
  );

  const taskGid = safeString(raw?.task_gid);
  const taskUrl = safeString(raw?.task_url);
  const taskTitle = safeString(raw?.task_title, "Asana task");
  const projectName = safeString(raw?.project_name);
  const dueOn = safeString(raw?.due_on);

  const [body, setBody] = useState(safeString(raw?.draft_body));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSend() {
    if (!body.trim()) return;
    setSending(true);
    setError("");
    try {
      const envelope = buildCommentEnvelope({ task_gid: taskGid, body });
      await client.sendFollowUpMessage(envelope);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post comment.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <ScrollablePanel title="Comment posted">
        <div className="p-4 text-sm text-green-700">
          Your comment was posted to the task.
        </div>
      </ScrollablePanel>
    );
  }

  const headerTitle = (
    <span className="text-sm font-semibold text-gray-900 truncate">
      Comment on task
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
        disabled={sending || !body.trim()}
        onClick={() => void handleSend()}
        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sending ? <Spinner size={4} /> : null}
        Post comment
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
          {dueOn && (
            <div className="mt-0.5 text-xs text-gray-500">Due: {dueOn}</div>
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

        {/* Comment textarea */}
        <div>
          <label
            htmlFor="asana-comment-body"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Comment
          </label>
          <textarea
            id="asana-comment-body"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your comment..."
            className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
        </div>
      </div>
    </ScrollablePanel>
  );
}

export function CommentApp() {
  return (
    <ComponentErrorBoundary>
      <Suspense fallback={<Spinner />}>
        <CommentForm />
      </Suspense>
    </ComponentErrorBoundary>
  );
}
