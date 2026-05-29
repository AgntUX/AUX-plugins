// Typed assertion over already-unwrapped tool output. Returns null while initializing.
export function assertStructuredContent(toolOutput) {
    if (toolOutput === undefined || toolOutput === null) {
        return null;
    }
    return toolOutput;
}
