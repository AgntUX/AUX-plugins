// =============================================================================
// compose-card.tsx — the editable Slack reply compose card.
//
// Sections:
//   1. Header bar: channel name (🔒 for DMs, # for channels), thread context
//      line, external-link button to slack_permalink.
//   2. Original thread panel (collapsible, collapsed by default): parent
//      excerpt + last reply excerpt + expand-all messages preview.
//   3. Editable textarea prefilled with drafted_body.
//   4. "Why this draft" disclosure (personalization_signals).
//   5. Mode tabs (Send now / Schedule / Save Slack draft). Schedule mode
//      reveals a datetime picker.
//   6. Footer: primary action button (label morphs by mode), Discard button.
//
// Briefing-learnings §1.7: no <a href> — uses ExternalLink for slack_permalink.
// Briefing-learnings §1.12: commitState tracks idle→sending→sent|error.
// =============================================================================

import { useState, useRef, useEffect } from "react";
import type { ComposePayload } from "../lib/types.js";
import type { ComposeMode } from "./mode-tabs.js";
import { ModeTabs } from "./mode-tabs.js";
import { DatetimePicker } from "./datetime-picker.js";
import { PersonalizationDisclosure } from "./personalization-disclosure.js";
import { MessagesPreview } from "./messages-preview.js";
import { ExternalLink } from "./external-link.js";
import { Spinner } from "./spinner.js";
import { formatDateTime, defaultScheduleTime } from "../lib/format-date.js";
import { useEmitCommit } from "../lib/emit-commit.js";

interface ComposeCardProps {
  payload: ComposePayload;
}

export function ComposeCard({ payload }: ComposeCardProps) {
  const {
    action_id,
    initial_verb,
    channel,
    thread,
    messages_preview,
    messages_truncated,
    drafted_body,
    personalization_signals,
    proposed_send_time,
    slack_permalink,
  } = payload;

  const [editedBody, setEditedBody] = useState(drafted_body);
  const [mode, setMode] = useState<ComposeMode>(initial_verb);
  const [sendAt, setSendAt] = useState<string | null>(
    proposed_send_time ?? defaultScheduleTime(),
  );
  const [showAllMessages, setShowAllMessages] = useState(false);
  // 3.0.0: discard is a pure local action — no host round-trip. Setting
  // `discarded` collapses the form into a "Discarded" banner so the user
  // gets immediate feedback without sending a no-op prompt to chat.
  const [discarded, setDiscarded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { commitState, commit, reset } = useEmitCommit();

  // Auto-resize textarea on body changes.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editedBody]);

  const isSending = commitState === "sending";
  const channelPrefix = channel.is_dm ? "🔒" : "#";
  const channelLabel = `${channelPrefix}${channel.name}`;

  const threadContextLine =
    thread.last_reply_author_real_name && thread.total_replies > 0
      ? `Replying to @${thread.last_reply_author_real_name} · ${thread.total_replies} repl${thread.total_replies === 1 ? "y" : "ies"}`
      : thread.total_replies > 0
        ? `${thread.total_replies} repl${thread.total_replies === 1 ? "y" : "ies"}`
        : `Reply to @${thread.parent_author_real_name}`;

  function handleSend() {
    void commit(
      action_id,
      mode === "draft" ? "send" : mode,
      editedBody,
      channel,
      { parent_ts: thread.parent_ts },
      mode === "schedule" ? (sendAt ?? undefined) : undefined,
    );
  }

  function handleDiscard() {
    setDiscarded(true);
  }

  if (discarded) {
    return (
      <div
        data-testid="compose-card"
        className="flex flex-col gap-2 bg-background text-foreground"
      >
        <div
          role="status"
          aria-live="polite"
          data-testid="compose-discarded-banner"
          className="rounded-md border border-border bg-muted px-3 py-2 text-[0.8125rem] text-muted-foreground"
        >
          Discarded — no message was sent. The action item is still open.
        </div>
      </div>
    );
  }

  const primaryLabel = (() => {
    if (isSending) return <Spinner size={4} label="Sending" />;
    if (commitState === "sent") return "Sent!";
    if (commitState === "error") return "Error — retry?";
    if (mode === "schedule" && sendAt) return `Schedule for ${formatDateTime(sendAt)}`;
    if (mode === "save_draft") return "Save as Slack draft";
    return "Send";
  })();

  return (
    <div
      data-testid="compose-card"
      className="flex flex-col gap-3 bg-background text-foreground"
      aria-busy={isSending}
    >
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground">
            {channelLabel}
          </div>
          <div className="text-xs text-muted-foreground">{threadContextLine}</div>
        </div>
        <ExternalLink
          href={slack_permalink}
          ariaLabel="Open in Slack"
          className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open ↗
        </ExternalLink>
      </div>

      {/* ── Original thread panel (collapsible) ───────────────────────── */}
      <details
        data-testid="thread-panel"
        className="rounded border border-border text-sm"
      >
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
          Original thread ({thread.total_replies} repl{thread.total_replies === 1 ? "y" : "ies"})
        </summary>
        <div className="px-3 pb-3 pt-1 space-y-2">
          {thread.parent_excerpt && (
            <blockquote
              data-testid="parent-excerpt"
              className="border-l-2 border-primary pl-2 text-xs text-muted-foreground"
            >
              <span className="font-medium">{thread.parent_author_real_name}: </span>
              {thread.parent_excerpt}
            </blockquote>
          )}
          {thread.last_reply_excerpt && (
            <blockquote
              data-testid="last-reply-excerpt"
              className="border-l-2 border-border pl-2 text-xs text-muted-foreground"
            >
              <span className="font-medium">
                {thread.last_reply_author_real_name ?? "Someone"}:{" "}
              </span>
              {thread.last_reply_excerpt}
            </blockquote>
          )}
          {messages_preview.length > 0 && !showAllMessages && (
            <button
              type="button"
              data-testid="expand-all-messages"
              onClick={() => setShowAllMessages(true)}
              className="text-xs text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Expand all messages
            </button>
          )}
          {showAllMessages && (
            <MessagesPreview
              messages={messages_preview}
              truncated={messages_truncated}
            />
          )}
        </div>
      </details>

      {/* ── Editable body ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="compose-body"
          className="text-xs font-medium text-muted-foreground"
        >
          Reply
        </label>
        <textarea
          id="compose-body"
          ref={textareaRef}
          data-testid="compose-body"
          value={editedBody}
          rows={4}
          disabled={isSending || commitState === "sent"}
          onChange={(e) => setEditedBody(e.target.value)}
          className={[
            "w-full resize-none rounded border border-input bg-background px-3 py-2 text-sm",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isSending || commitState === "sent" ? "opacity-50" : "",
          ].join(" ")}
          aria-label="Draft reply body"
        />
        <div className="text-right text-xs text-muted-foreground">
          {editedBody.length}/4000
        </div>
      </div>

      {/* ── Why this draft ────────────────────────────────────────────── */}
      <PersonalizationDisclosure signals={personalization_signals} />

      {/* ── Mode tabs ─────────────────────────────────────────────────── */}
      <ModeTabs value={mode} onChange={setMode} disabled={isSending} />

      {/* ── Schedule datetime picker (schedule mode only) ─────────────── */}
      {mode === "schedule" && (
        <DatetimePicker
          value={sendAt}
          onChange={setSendAt}
          min={new Date().toISOString()}
          disabled={isSending}
        />
      )}

      {/* ── Success banner ────────────────────────────────────────────── */}
      {commitState === "sent" && (
        <div
          role="status"
          aria-live="polite"
          data-testid="compose-success-banner"
          className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-[0.8125rem] text-green-800"
        >
          {(() => {
            switch (mode) {
              case "schedule":
                return `Success — reply scheduled for ${formatDateTime(sendAt ?? "")} in #${channel.name}.`;
              case "save_draft":
                return `Success — saved as a Slack draft in #${channel.name}.`;
              default:
                return `Success — reply sent to #${channel.name}.`;
            }
          })()}
        </div>
      )}

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          data-testid="discard-button"
          onClick={handleDiscard}
          disabled={isSending}
          className="rounded border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          Discard
        </button>
        {commitState === "error" && (
          <button
            type="button"
            data-testid="error-reset"
            onClick={reset}
            className="text-xs text-destructive underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reset
          </button>
        )}
        <button
          type="button"
          data-testid="primary-action"
          onClick={commitState === "error" ? reset : handleSend}
          disabled={isSending || commitState === "sent" || editedBody.trim().length === 0}
          aria-busy={isSending}
          className={[
            "rounded px-3 py-1.5 text-sm font-medium transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            commitState === "sent"
              ? "bg-green-600 text-white"
              : commitState === "error"
                ? "bg-destructive text-destructive-foreground hover:opacity-90"
                : "bg-primary text-primary-foreground hover:opacity-90",
            isSending || commitState === "sent" || editedBody.trim().length === 0
              ? "opacity-50 cursor-not-allowed"
              : "",
          ].join(" ")}
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}
