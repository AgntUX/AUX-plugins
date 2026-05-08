// =============================================================================
// compose-card.tsx — the editable Gmail reply compose card.
//
// Sections:
//   1. Header bar: subject + thread context line, "Open in Gmail" external link.
//   2. Original thread panel (collapsible): parent excerpt + last message.
//   3. Recipients (To / Cc / Bcc).
//   4. Editable subject input.
//   5. Editable body textarea prefilled with drafted_body.
//   6. "Why this draft?" disclosure (personalization_signals).
//   7. "Prior conversations" disclosure (email_context).
//   8. Footer: "Save as Gmail draft & open" + Discard buttons.
//   9. Always-visible footer note explaining draft-then-send-from-Gmail flow.
// =============================================================================

import { useState, useRef, useEffect } from "react";
import type { ComposePayload } from "../lib/types.js";
import { RecipientsFields } from "./recipients-fields.js";
import { EmailContextDisclosure } from "./email-context-disclosure.js";
import { PersonalizationDisclosure } from "./personalization-disclosure.js";
import { ExternalLink } from "./external-link.js";
import { Spinner } from "@agntux/ui-primitives";
import { useEmitCommit } from "../lib/emit-commit.js";

interface ComposeCardProps {
  payload: ComposePayload;
}

export function ComposeCard({ payload }: ComposeCardProps) {
  const {
    action_id,
    thread,
    recipients: initialRecipients,
    reply_to_message_id,
    drafted_body,
    personalization_signals,
    email_context,
    gmail_thread_url,
    user_email,
    account_index,
  } = payload;

  const [recipients, setRecipients] = useState({
    to: initialRecipients.to,
    cc: initialRecipients.cc,
    bcc: initialRecipients.bcc,
  });
  const [subject, setSubject] = useState(
    thread.subject.startsWith("Re:") || thread.subject.startsWith("RE:")
      ? thread.subject
      : `Re: ${thread.subject}`,
  );
  const [editedBody, setEditedBody] = useState(drafted_body);
  const [discarded, setDiscarded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { commitState, commit, reset } = useEmitCommit();

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editedBody]);

  const isSending = commitState === "sending";

  const threadContextLine =
    thread.last_author_real_name && thread.total_messages > 1
      ? `Replying to ${thread.last_author_real_name} · ${thread.total_messages} messages`
      : `Reply to ${thread.parent_author_real_name || thread.parent_author_email}`;

  const canSubmit =
    !isSending &&
    commitState !== "sent" &&
    editedBody.trim().length > 0 &&
    recipients.to.length > 0;

  function handleSave() {
    void commit(
      action_id,
      subject,
      editedBody,
      recipients,
      reply_to_message_id,
      user_email,
      account_index,
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
          Discarded — no draft was saved. The action item is still open.
        </div>
      </div>
    );
  }

  const primaryLabel = (() => {
    if (isSending) return <Spinner size={4} label="Saving draft" />;
    if (commitState === "sent") return "Draft saved!";
    if (commitState === "error") return "Error — retry?";
    return "Save as Gmail draft & open";
  })();

  return (
    <div
      data-testid="compose-card"
      className="flex flex-col gap-3 bg-background text-foreground"
      aria-busy={isSending}
    >
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {thread.subject || "(no subject)"}
          </div>
          <div className="text-xs text-muted-foreground">{threadContextLine}</div>
        </div>
        <ExternalLink
          href={gmail_thread_url}
          ariaLabel="Open thread in Gmail"
          className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open in Gmail ↗
        </ExternalLink>
      </div>

      {/* ── Original thread panel ─────────────────────────────────────── */}
      <details
        data-testid="thread-panel"
        className="rounded border border-border text-sm"
      >
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
          Original thread ({thread.total_messages} message{thread.total_messages === 1 ? "" : "s"})
        </summary>
        <div className="space-y-2 px-3 pb-3 pt-1">
          {thread.parent_excerpt && (
            <blockquote
              data-testid="parent-excerpt"
              className="border-l-2 border-primary pl-2 text-xs text-muted-foreground"
            >
              <span className="font-medium">
                {thread.parent_author_real_name || thread.parent_author_email}:{" "}
              </span>
              {thread.parent_excerpt}
            </blockquote>
          )}
          {thread.last_excerpt && thread.last_message_id !== thread.parent_message_id && (
            <blockquote
              data-testid="last-message-excerpt"
              className="border-l-2 border-border pl-2 text-xs text-muted-foreground"
            >
              <span className="font-medium">
                {thread.last_author_real_name || thread.last_author_email}:{" "}
              </span>
              {thread.last_excerpt}
            </blockquote>
          )}
        </div>
      </details>

      {/* ── Recipients ────────────────────────────────────────────────── */}
      <RecipientsFields
        to={recipients.to}
        cc={recipients.cc}
        bcc={recipients.bcc}
        onChange={setRecipients}
        disabled={isSending || commitState === "sent"}
      />

      {/* ── Subject ───────────────────────────────────────────────────── */}
      <div className="flex items-baseline gap-2">
        <label
          htmlFor="compose-subject"
          className="w-10 shrink-0 text-xs font-medium text-muted-foreground"
        >
          Subject
        </label>
        <input
          id="compose-subject"
          data-testid="compose-subject"
          type="text"
          value={subject}
          disabled={isSending || commitState === "sent"}
          onChange={(e) => setSubject(e.target.value)}
          className={[
            "flex-1 rounded border border-input bg-background px-2 py-1 text-sm",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isSending || commitState === "sent" ? "opacity-50" : "",
          ].join(" ")}
        />
      </div>

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
          rows={6}
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

      {/* ── Prior conversations ───────────────────────────────────────── */}
      <EmailContextDisclosure context={email_context} />

      {/* ── Success banner ────────────────────────────────────────────── */}
      {commitState === "sent" && (
        <div
          role="status"
          aria-live="polite"
          data-testid="compose-success-banner"
          className="flex flex-col gap-1 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-[0.8125rem] text-green-800"
        >
          <span>
            Draft saved to your Gmail Drafts folder. Look for a link in chat —
            open it, review the draft in Gmail, then click Send there.
          </span>
        </div>
      )}

      {/* ── Footer (buttons) ──────────────────────────────────────────── */}
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
          onClick={commitState === "error" ? reset : handleSave}
          disabled={!canSubmit && commitState !== "error"}
          aria-busy={isSending}
          className={[
            "rounded px-3 py-1.5 text-sm font-medium transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            commitState === "sent"
              ? "bg-green-600 text-white"
              : commitState === "error"
                ? "bg-destructive text-destructive-foreground hover:opacity-90"
                : "bg-primary text-primary-foreground hover:opacity-90",
            !canSubmit && commitState !== "error" ? "opacity-50 cursor-not-allowed" : "",
          ].join(" ")}
        >
          {primaryLabel}
        </button>
      </div>

      {/* ── Always-visible footer note ────────────────────────────────── */}
      <p
        data-testid="footer-note"
        className="rounded border border-dashed border-border px-3 py-2 text-[0.6875rem] leading-snug text-muted-foreground"
      >
        Save creates a draft in your Gmail Drafts folder and opens it in a new
        tab. Review and click <span className="font-medium">Send</span> in
        Gmail itself to actually send the email — the Gmail integration has no
        send-from-here capability.
      </p>
    </div>
  );
}
