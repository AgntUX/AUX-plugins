// Shared MainComponent props interface — used by both per-handler App files.
// Sourced from the canonical _template/view-tool/src/components/main-component.tsx.

export interface MainComponentProps {
  /** Data returned from the MCP tool. While `isStreaming=true` this is
   *  synthesized from the partial input stream (wrapped as `_meta.payload`). */
  toolOutput?: Record<string, unknown> | undefined;
  /** Input data sent to the tool (when available). */
  toolInput?: Record<string, unknown>;
  /** True while the host is streaming partial tool input; `toolOutput` is
   *  derived from the partial and will be replaced by the real tool-result. */
  isStreaming?: boolean;
  /** Host-persisted widget state for UI-only concerns (filters, selections). */
  widgetState: Record<string, unknown>;
  setWidgetState: (
    next:
      | Record<string, unknown>
      | ((prev: Record<string, unknown>) => Record<string, unknown>),
  ) => void;
  /** Call an MCP tool by name with optional arguments. */
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** Send a follow-up message to the host conversation for write-back operations. */
  sendFollowUpMessage: (prompt: string) => Promise<void>;
  /** Display mode: 'inline' | 'inline-card' | 'fullscreen' | 'pip' */
  displayMode: string;
  /** Available display modes that can be requested. */
  availableDisplayModes: string[];
  /** Request a different display mode from the host. */
  requestDisplayMode: (mode: 'inline' | 'fullscreen' | 'pip') => Promise<void>;
  /** Theme from the host ('light' or 'dark'). */
  theme: string;
  /** Locale from the host (e.g., 'en-US'). */
  locale: string;
  /** Safe area insets for layout constraints. */
  safeArea: { top: number; right: number; bottom: number; left: number };
  /** Viewport dimensions from the host. */
  viewport: { width: number; height: number };
  /** Platform identifier from the host (e.g., 'web', 'ios', 'android'). */
  platform: string;
}
