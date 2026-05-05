// =============================================================================
// messages-preview.tsx — renders the expanded messages_preview[] list.
// =============================================================================

import type { MessagePreview } from "../lib/types.js";

interface MessagesPreviewProps {
  messages: MessagePreview[];
  truncated: boolean;
}

/**
 * MessagesPreview — renders recent thread messages as a compact timeline.
 * Shown inside the collapsible original-thread panel.
 */
export function MessagesPreview({ messages, truncated }: MessagesPreviewProps) {
  if (messages.length === 0) return null;

  return (
    <div data-testid="messages-preview" className="space-y-2 pt-2">
      {messages.map((msg, i) => (
        <div
          key={msg.ts || i}
          data-testid={`message-preview-${i}`}
          className="border-l-2 border-border pl-2"
        >
          <div className="text-xs font-medium text-foreground">{msg.author}</div>
          <div className="text-xs text-muted-foreground">{msg.body_excerpt}</div>
        </div>
      ))}
      {truncated && (
        <p
          data-testid="messages-truncated-notice"
          className="text-xs text-muted-foreground italic"
        >
          Additional messages not shown.
        </p>
      )}
    </div>
  );
}
