// =============================================================================
// emit-commit.ts — wraps sendFollowUpMessage for the compose-card commit flow.
//
// Tracks in-flight state (idle → sending → sent | error) per the
// action-feedback discipline (briefing-learnings §1.12). The component
// disables interactive controls while state === "sending".
// =============================================================================

import { useState, useCallback } from "react";
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

  const commit = useCallback(
    async (
      action_id: string,
      mode: CommitMode,
      edited_body: string,
      send_at?: string,
    ) => {
      if (commitState === "sending") return; // guard double-click
      setCommitState("sending");
      try {
        const prompt = buildEnvelope(action_id, mode, edited_body, send_at);
        await client.sendFollowUpMessage(prompt);
        setCommitState("sent");
      } catch {
        setCommitState("error");
      }
    },
    [client, commitState],
  );

  const reset = useCallback(() => {
    setCommitState("idle");
  }, []);

  return { commitState, commit, reset };
}
