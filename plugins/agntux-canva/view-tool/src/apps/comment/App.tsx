import React, { useState, Suspense } from "react";
import { assertStructuredContent, ComponentErrorBoundary, ScrollablePanel, safeString, Spinner } from "@agntux/ui-primitives";
import {
  useToolResult,
  useAppsClient,
  useHostStyleVariables,
  useDocumentTheme,
} from "../../lib/apps-react/index.js";
import { buildCommentEnvelope } from "./lib/build-envelope.js";
import { ExternalLink } from "../external-link.js";

interface CommentPayload {
  design_url: string;
  design_id: string;
  design_title: string;
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

  const designId = safeString(raw?.design_id);
  const designUrl = safeString(raw?.design_url);
  const designTitle = safeString(raw?.design_title, "Canva design");
  const personalizationSignals = safeString(raw?.personalization_signals);

  const [body, setBody] = useState(safeString(raw?.draft_body));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSend() {
    if (!body.trim()) return;
    setSending(true);
    setError("");
    try {
      const envelope = buildCommentEnvelope({
        design_id: designId,
        message_plaintext: body,
      });
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
      <ScrollablePanel title="Comment added">
        <div className="p-4 text-sm text-green-700">
          Your comment was added to the design.
        </div>
      </ScrollablePanel>
    );
  }

  const headerTitle = (
    <span className="text-sm font-semibold text-gray-900 truncate">
      {designTitle || "Comment on design"}
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
        Add comment
      </button>
    </div>
  );

  return (
    <ScrollablePanel
      title={headerTitle}
      onHelpClick={designUrl ? () => void client.openLink(designUrl) : undefined}
      helpLabel="Open in Canva ↗"
      footer={footer}
    >
      <div className="p-3 space-y-3">
        {/* Design context + open link */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500 truncate">
            Canva design
            {designUrl && (
              <>
                {" · "}
                <ExternalLink
                  href={designUrl}
                  className="text-indigo-600 hover:underline"
                  ariaLabel="Open design in Canva"
                >
                  Open ↗
                </ExternalLink>
              </>
            )}
          </span>
        </div>

        {/* Comment textarea */}
        <div>
          <label
            htmlFor="canva-comment-body"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Your comment
          </label>
          <textarea
            id="canva-comment-body"
            rows={5}
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your comment..."
            className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
          <div className="mt-0.5 flex items-center justify-between">
            {personalizationSignals ? (
              <p className="text-xs text-gray-400">
                Draft based on your profile tone
              </p>
            ) : (
              <span />
            )}
            <p className="text-xs text-gray-400 text-right">
              {body.length}/1000
            </p>
          </div>
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
