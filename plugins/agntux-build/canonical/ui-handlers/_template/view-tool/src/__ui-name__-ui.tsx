import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppsProvider } from './lib/apps-react/index.js';
import { App } from './App.js';
import './globals.css';

// Iframe-height floor. The MCP Apps protocol lets the iframe report its
// rendered size via `ui/notifications/size-changed` (wired in
// simple-mcp-app.ts), but hosts often commit to a small default iframe
// height on first paint and ignore later notifications. Setting
// min-height on documentElement + body BEFORE mount guarantees the first
// reported scrollHeight is at least this floor, regardless of inner data
// state. Tune this to whatever your view needs (compose/canvas: 480px;
// table-shaped views like triage: 640px).
const VIEW_MIN_HEIGHT_PX = 480;
if (typeof document !== 'undefined') {
  document.documentElement.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  if (document.body) {
    document.body.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  rootElement.style.minHeight = `${VIEW_MIN_HEIGHT_PX}px`;
  createRoot(rootElement).render(
    <StrictMode>
      <AppsProvider>
        <App />
      </AppsProvider>
    </StrictMode>,
  );
}
