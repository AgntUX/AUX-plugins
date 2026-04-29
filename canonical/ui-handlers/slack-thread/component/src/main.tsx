import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MainComponent } from './components/main-component';

// Standalone entry point for vite build / dev server.
// In production the component is loaded inside an MCP App iframe via App.tsx
// (from the full plugin's component tree). This file provides a minimal
// mount for the singlefile build output that the plugin's MCP server serves.

const rootElement = document.getElementById('root');
if (rootElement) {
  // Minimal stub props for standalone build — the real host injects these
  // via the @mcp-apps-kit/ui-react hooks wired in App.tsx.
  const stubProps = {
    toolOutput: undefined,
    toolInput: undefined,
    isStreaming: false,
    widgetState: {},
    setWidgetState: () => {},
    callTool: async () => ({}),
    sendFollowUpMessage: async () => {},
    displayMode: 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
    requestDisplayMode: async () => {},
    theme: 'light',
    locale: 'en-US',
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    viewport: { width: 400, height: 600 },
    platform: 'web',
  };

  createRoot(rootElement).render(
    <StrictMode>
      <MainComponent {...stubProps} />
    </StrictMode>,
  );
}
