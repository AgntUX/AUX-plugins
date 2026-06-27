import React, { useState, Suspense } from "react";
import { assertStructuredContent, ComponentErrorBoundary, ScrollablePanel, safeString, Spinner } from "@agntux/ui-primitives";
import {
  useToolResult,
  useAppsClient,
  useHostStyleVariables,
  useDocumentTheme,
} from "../../lib/apps-react/index.js";
import { buildReplyEnvelope } from "./lib/build-envelope.js";
import { ExternalLink } from "../external-link.js";

interface ReplyPayload {
  design_url: string;
  design_id: string;
  design_title: string;
  comment_id: string;
  comment_author: string;
  comment_excerpt: string;
  draft_body: string;
  personalization_signals: string;
}

function ReplyForm() {
  useHostStyleVariables();
  useDocumentTheme();

  const client = useAppsClient();
  const toolOutput = useToolResult();
  const raw = assertStructuredContent<ReplyPayload>(
    toolOutput as Record<string, unknown> | undefined,
  );

  const designId = safeString(raw?.design_id);
  const designUrl = safeString(raw?.design_url);
  const designTitle = safeString(raw?.design_title, "Canva design");
  const commentId = safeString(raw?.comment_id);
  const commentAuthor = safeString(raw?.comment_author);
  const commentExcerpt = safeString(raw?.comment_excerpt);
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
      const envelope = buildReplyEnvelope({
        design_id: designId,
        comment_id: commentId,
        message_plaintext: body,
      });
      await client.sendFollowUpMessage(envelope);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send reply.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <ScrollablePanel title="Reply sent">
        <div className="p-4 text-sm text-green-700">
          Your reply was posted to the comment.
        </div>
      </ScrollablePanel>
    );
  }

  const headerTitle = (
    <span className="text-sm font-semibold text-gray-900 truncate">
      {designTitle || "Reply to comment"}
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
        Send reply
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

        {/* Quoted comment block */}
        {(commentAuthor || commentExcerpt) && (
          <div className="rounded-md border-l-4 border-indigo-300 bg-indigo-50 p-3 text-sm">
            {commentAuthor && (
              <div className="text-xs font-semibold text-indigo-700 mb-1">
                {commentAuthor}
              </div>
            )}
            {commentExcerpt && (
              <div className="text-gray-700 italic line-clamp-4">
                {commentExcerpt}
              </div>
            )}
          </div>
        )}

        {/* Reply textarea */}
        <div>
          <label
            htmlFor="canva-reply-body"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Your reply
          </label>
          <textarea
            id="canva-reply-body"
            rows={5}
            maxLength={2048}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your reply..."
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
              {body.length}/2048
            </p>
          </div>
        </div>
      </div>
    </ScrollablePanel>
  );
}

export function ReplyApp() {
  return (
    <ComponentErrorBoundary>
      <Suspense fallback={<Spinner />}>
        <ReplyForm />
      </Suspense>
    </ComponentErrorBoundary>
  );
}
