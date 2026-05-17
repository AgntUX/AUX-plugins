// =============================================================================
// canvas-preview.tsx — read-only markdown preview of the canvas.
//
// Uses template literals only — no markdown library. This keeps the bundle
// small and avoids an additional dependency.
// =============================================================================

import type { DraftedCanvas } from "../lib/types.js";

interface CanvasPreviewProps {
  title: string;
  canvas: DraftedCanvas;
}

/**
 * CanvasPreview — renders the assembled canvas as a read-only markdown preview.
 * The markdown is generated from template literals; it is displayed as
 * preformatted text so the user can review it before creating.
 */
export function CanvasPreview({ title, canvas }: CanvasPreviewProps) {
  const lines: string[] = [
    `# ${title || "Untitled"}`,
    "",
    "## TL;DR",
    "",
    canvas.tldr || "_No summary provided._",
    "",
  ];

  if (canvas.decisions.length > 0) {
    lines.push("## Decisions", "");
    for (const d of canvas.decisions) {
      lines.push(`- ${d}`);
    }
    lines.push("");
  }

  if (canvas.open_questions.length > 0) {
    lines.push("## Open Questions", "");
    for (const q of canvas.open_questions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }

  if (canvas.participants.length > 0) {
    lines.push("## Participants", "");
    lines.push(canvas.participants.join(", "));
    lines.push("");
  }

  const markdown = lines.join("\n");

  return (
    <div
      data-testid="canvas-preview"
      className="rounded border border-border bg-muted p-3 overflow-y-auto text-xs font-mono whitespace-pre-wrap text-foreground"
      style={{ maxHeight: "280px" }}
    >
      {markdown}
    </div>
  );
}
