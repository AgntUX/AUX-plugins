// =============================================================================
// emit-commit.ts — wraps sendFollowUpMessage for the compose-card commit flow.
//
// Tracks in-flight state (idle → sending → sent | error) per the
// action-feedback discipline (briefing-learnings §1.12). The component
// disables interactive controls while state === "sending".
// =============================================================================

import { useState, useCallback, useRef } from "react";
import { useAppsClient } from "./apps-react/index.js";
import { buildEnvelope, type CommitMode } from "./build-envelope.js";

export type CommitState = "idle" | "sending" | "sent" | "error";

export interface UseEmitCommitResult {
  commitState: CommitState;
  commit: (
    action_id: string,
    mode: CommitMode,
    edited_body: string,
    send_at?: string,
  ) => Promise<void>;
  reset: () => void;
}

/**
 * useEmitCommit — hook that wraps sendFollowUpMessage with action-feedback
 * state tracking. Renders:
 *   idle    → primary action button enabled
 *   sending → button shows spinner, aria-busy=true
 *   sent    → button shows checkmark briefly, then re-enables (or parent unmounts)
 *   error   → button shows error state, reset() re-enables
 */
export function useEmitCommit(): UseEmitCommitResult {
  const client = useAppsClient();
  const [commitState, setCommitState] = useState<CommitState>("idle");
  // Ref-based double-click guard. Reading commitState from the closure is racy
  // — if a user double-clicks before React commits the "sending" state, both
  // invocations see the closure's stale "idle" value. The ref is mutated
  // synchronously, before any await, so the second click sees `true` and bails.
  const inFlightRef = useRef(false);

  const commit = useCallback(
    async (
      action_id: string,
      mode: CommitMode,
      edited_body: string,
      send_at?: string,
    ) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setCommitState("sending");
      try {
        const prompt = buildEnvelope(action_id, mode, edited_body, send_at);
        await client.sendFollowUpMessage(prompt);
        setCommitState("sent");
      } catch {
        setCommitState("error");
      } finally {
        inFlightRef.current = false;
      }
    },
    [client],
  );

  const reset = useCallback(() => {
    setCommitState("idle");
    inFlightRef.current = false;
  }, []);

  return { commitState, commit, reset };
}
