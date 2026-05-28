// Typed assertion over already-unwrapped tool output. Returns null while initializing.

export function assertStructuredContent<T>(
  toolOutput: Record<string, unknown> | undefined,
): T | null {
  if (toolOutput === undefined || toolOutput === null) {
    return null;
  }
  return toolOutput as unknown as T;
}
