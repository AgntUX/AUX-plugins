// =============================================================================
// emit-commit.ts — wraps sendFollowUpMessage for the gmail compose-card commit
// flow. Tracks in-flight state (idle → sending → sent | error) per the
// action-feedback discipline.
// =============================================================================

import { useState, useCallback, useRef } from "react";
import { useAppsClient } from "./apps-react/index.js";
import {
  buildEnvelope,
  type ComposeEnvelopeRecipients,
} from "./build-envelope.js";

export type CommitState = "idle" | "sending" | "sent" | "error";

export interface UseEmitCommitResult {
  commitState: CommitState;
  commit: (
    action_id: string,
    edited_subject: string,
    edited_body: string,
    recipients: ComposeEnvelopeRecipients,
    reply_to_message_id: string,
    user_email: string | null,
    account_index: number | null,
  ) => Promise<void>;
  reset: () => void;
}

export function useEmitCommit(): UseEmitCommitResult {
  const client = useAppsClient();
  const [commitState, setCommitState] = useState<CommitState>("idle");
  const inFlightRef = useRef(false);

  const commit = useCallback(
    async (
      action_id: string,
      edited_subject: string,
      edited_body: string,
      recipients: ComposeEnvelopeRecipients,
      reply_to_message_id: string,
      user_email: string | null,
      account_index: number | null,
    ) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setCommitState("sending");
      try {
        const prompt = buildEnvelope(
          action_id,
          edited_subject,
          edited_body,
          recipients,
          reply_to_message_id,
          user_email,
          account_index,
        );
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
