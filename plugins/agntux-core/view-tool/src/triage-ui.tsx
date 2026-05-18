import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppsProvider } from './lib/apps-react/index.js';
import { App } from './App.js';
import './globals.css';

// Iframe-height floor for the triage view. The MCP Apps protocol lets the
// iframe report its rendered size to the host (`ui/notifications/size-
// changed`, wired automatically via ResizeObserver in simple-mcp-app.ts)
// but hosts often commit to a small default iframe height on first paint
// and ignore later notifications. Setting min-height on documentElement
// + body BEFORE mount guarantees the first reported scrollHeight is at
// least this floor, regardless of inner data state — the triage table
// needs ~640px to show priority groups + handled-recent section without
// clipping.
const TRIAGE_MIN_HEIGHT_PX = 640;
if (typeof document !== 'undefined') {
  document.documentElement.style.minHeight = `${TRIAGE_MIN_HEIGHT_PX}px`;
  if (document.body) {
    document.body.style.minHeight = `${TRIAGE_MIN_HEIGHT_PX}px`;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  rootElement.style.minHeight = `${TRIAGE_MIN_HEIGHT_PX}px`;
  createRoot(rootElement).render(
    <StrictMode>
      <AppsProvider>
        <App />
      </AppsProvider>
    </StrictMode>,
  );
}
