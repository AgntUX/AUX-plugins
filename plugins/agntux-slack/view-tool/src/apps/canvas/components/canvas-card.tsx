// =============================================================================
// canvas-card.tsx — the editable Slack canvas summary card.
//
// Sections:
//   1. Editable title input (≤80 chars, char counter).
//   2. Four section blocks: TL;DR textarea, Decisions list editor,
//      Open questions list editor, Participants display.
//   3. Preview tab — renders the assembled canvas markdown.
//   4. Footer: "Create canvas + post link in thread", Discard.
//
// Briefing-learnings §1.12: commitState tracks idle→sending→sent|error.
// No <a href> — no external links needed in canvas card.
// =============================================================================

import { useState, useRef } from "react";
import type { CanvasPayload } from "../lib/types.js";
import type { DraftedCanvas } from "../lib/types.js";
import { ListEditor } from "./list-editor.js";
import { CanvasPreview } from "./canvas-preview.js";
import { Spinner } from "@agntux/ui-primitives";
import { buildCanvasEnvelope } from "../lib/build-canvas-envelope.js";
import { useAppsClient } from "../lib/apps-react/index.js";

type CommitState = "idle" | "sending" | "sent" | "error";
type ActiveTab = "edit" | "preview";

interface CanvasCardProps {
  payload: CanvasPayload;
}

const MAX_TITLE_CHARS = 80;

export function CanvasCard({ payload }: CanvasCardProps) {
  const { action_id, channel, drafted_canvas, proposed_followup_message } = payload;

  const [title, setTitle] = useState(drafted_canvas.title);
  const [tldr, setTldr] = useState(drafted_canvas.tldr);
  const [decisions, setDecisions] = useState<string[]>(drafted_canvas.decisions);
  const [openQuestions, setOpenQuestions] = useState<string[]>(drafted_canvas.open_questions);
  const [activeTab, setActiveTab] = useState<ActiveTab>("edit");
  const [commitState, setCommitState] = useState<CommitState>("idle");
  // 3.0.0: discard is a pure local action — no host round-trip. Setting
  // `discarded` collapses the form into a "Discarded" banner so the user
  // gets immediate feedback without sending a no-op prompt to chat.
  const [discarded, setDiscarded] = useState(false);
  // Ref-based double-click guard — see emit-commit.ts for rationale. The
  // disabled={isSending} prop on the primary button mitigates this in the
  // common case, but ref-based gating is bulletproof against fast event
  // dispatches that beat React's commit phase.
  const inFlightRef = useRef(false);

  const client = useAppsClient();
  const isSending = commitState === "sending";

  async function handleCreate() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setCommitState("sending");
    try {
      const prompt = buildCanvasEnvelope(
        action_id,
        title,
        tldr,
        decisions,
        openQuestions,
        proposed_followup_message,
        channel,
        { parent_ts: payload.thread.parent_ts },
      );
      await client.sendFollowUpMessage(prompt);
      setCommitState("sent");
    } catch {
      setCommitState("error");
    } finally {
      inFlightRef.current = false;
    }
  }

  function handleDiscard() {
    setDiscarded(true);
  }

  if (discarded) {
    return (
      <div
        data-testid="canvas-card"
        className="flex flex-col gap-2 bg-background text-foreground"
      >
        <div
          role="status"
          aria-live="polite"
          data-testid="canvas-discarded-banner"
          className="rounded-md border border-border bg-muted px-3 py-2 text-[0.8125rem] text-muted-foreground"
        >
          Discarded — no canvas was created. The action item is still open.
        </div>
      </div>
    );
  }

  const currentCanvas: DraftedCanvas = {
    title,
    tldr,
    decisions,
    open_questions: openQuestions,
    participants: drafted_canvas.participants,
  };

  const primaryLabel = (() => {
    if (isSending) return <Spinner size={4} label="Creating canvas" />;
    if (commitState === "sent") return "Canvas created!";
    if (commitState === "error") return "Error — retry?";
    return "Create canvas + post link in thread";
  })();

  return (
    <div
      data-testid="canvas-card"
      className="flex flex-col gap-3 bg-background text-foreground"
      aria-busy={isSending}
    >
      {/* ── Header line ─────────────────────────────────────────────── */}
      <div className="text-xs text-muted-foreground">
        #{channel.name} · {payload.thread.total_replies} repl{payload.thread.total_replies === 1 ? "y" : "ies"}
      </div>

      {/* ── Tab bar: Edit / Preview ──────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Canvas view mode"
        className="flex gap-1 rounded-md border border-border bg-muted p-1"
      >
        {(["edit", "preview"] as ActiveTab[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={activeTab === tab}
            data-testid={`canvas-tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            disabled={isSending}
            className={[
              "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors capitalize",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeTab === tab
                ? "bg-card text-card-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              isSending ? "opacity-50 cursor-not-allowed" : "",
            ].join(" ")}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "edit" ? (
        <div className="flex flex-col gap-3">
          {/* ── Title ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <label htmlFor="canvas-title" className="text-xs font-medium text-muted-foreground">
              Title
            </label>
            <input
              id="canvas-title"
              type="text"
              data-testid="canvas-title"
              value={title}
              maxLength={MAX_TITLE_CHARS}
              disabled={isSending}
              onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE_CHARS))}
              className={[
                "rounded border border-input bg-background px-2 py-1 text-sm",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSending ? "opacity-50" : "",
              ].join(" ")}
              aria-label="Canvas title"
            />
            <div className="text-right text-xs text-muted-foreground">
              {title.length}/{MAX_TITLE_CHARS}
            </div>
          </div>

          {/* ── TL;DR ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <label htmlFor="canvas-tldr" className="text-xs font-medium text-muted-foreground">
              TL;DR
            </label>
            <textarea
              id="canvas-tldr"
              data-testid="canvas-tldr"
              value={tldr}
              rows={3}
              disabled={isSending}
              onChange={(e) => setTldr(e.target.value)}
              className={[
                "w-full resize-none rounded border border-input bg-background px-2 py-1 text-sm",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSending ? "opacity-50" : "",
              ].join(" ")}
              aria-label="Canvas TL;DR"
            />
          </div>

          {/* ── Decisions ─────────────────────────────────────────────── */}
          <ListEditor
            label="Decisions"
            items={decisions}
            onChange={setDecisions}
            placeholder="Add a decision…"
            maxItems={8}
            disabled={isSending}
            testIdPrefix="decisions-editor"
          />

          {/* ── Open questions ────────────────────────────────────────── */}
          <ListEditor
            label="Open Questions"
            items={openQuestions}
            onChange={setOpenQuestions}
            placeholder="Add an open question…"
            maxItems={8}
            disabled={isSending}
            testIdPrefix="open-questions-editor"
          />

          {/*
            ── Participants (READ-ONLY by design) ─────────────────────────
            Participants are derived from the source thread context (Slack
            user IDs → real names) by the sync skill at ingest time and lifted by canvas_view. They
            are NOT included in the committed envelope (see
            ui-handlers/canvas/component/src/lib/build-canvas-envelope.ts).
            The skill re-reads the original participants list from the
            canvas_view args when it assembles the canvas markdown in
            Step 7. If a future change makes participants editable here:
              1. Add `participants` to buildCanvasEnvelope's signature.
              2. Add a participants capture group to the canvas regex in
                 SKILL.md Step 6.5 and envelope-shape.test.ts.
              3. Update Step 7's "participants — not in the canvas envelope"
                 note to read from the envelope instead.
            Don't silently swallow the edits.
          */}
          {drafted_canvas.participants.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Participants</span>
              <div
                data-testid="canvas-participants"
                className="text-xs text-muted-foreground"
              >
                {drafted_canvas.participants.join(", ")}
              </div>
            </div>
          )}
        </div>
      ) : (
        <CanvasPreview title={title} canvas={currentCanvas} />
      )}

      {/* ── Success banner ──────────────────────────────────────────── */}
      {commitState === "sent" && (
        <div
          role="status"
          aria-live="polite"
          data-testid="canvas-success-banner"
          className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-[0.8125rem] text-green-800"
        >
          Success — canvas created and link posted to #{channel.name}.
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────── */}
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
            onClick={() => setCommitState("idle")}
            className="text-xs text-destructive underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reset
          </button>
        )}
        <button
          type="button"
          data-testid="primary-action"
          onClick={commitState === "error" ? () => setCommitState("idle") : () => void handleCreate()}
          disabled={isSending || commitState === "sent" || title.trim().length === 0}
          aria-busy={isSending}
          className={[
            "rounded px-3 py-1.5 text-sm font-medium transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            commitState === "sent"
              ? "bg-green-600 text-white"
              : commitState === "error"
                ? "bg-destructive text-destructive-foreground hover:opacity-90"
                : "bg-primary text-primary-foreground hover:opacity-90",
            isSending || commitState === "sent" || title.trim().length === 0
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
