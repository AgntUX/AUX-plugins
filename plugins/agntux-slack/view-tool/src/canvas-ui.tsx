// =============================================================================
// canvas-ui.tsx — iframe entry for the agntux-slack canvas view.
// Vite (vite-plugin-singlefile) emits one self-contained HTML at
// dist/ui-resources/canvas.html.
//
// Mirrors the canonical main.tsx shape from the rich UI tree
// (apps/canvas/main.tsx is byte-identical to apps/compose/main.tsx, so
// the per-UI bridge lives at this top-level entry instead): wraps the
// canvas <App /> in <StrictMode> + <AppsProvider>. The provider gives
// useAppsClient() / useToolResult() / useDocumentTheme() etc. a
// concrete client backed by the JSON-RPC 2.0 postMessage adapter; the
// rich main-component reads its props off that context.
// =============================================================================

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppsProvider } from './apps/canvas/lib/apps-react/index.js';
import { App } from './apps/canvas/App.js';
import './globals.css';

// Iframe-height floor for the canvas view. See triage-ui.tsx in
// agntux-core for the full rationale. The canvas summariser needs ~480px
// to show the title row + summary body + commit action row without
// scrolling.
const CANVAS_MIN_HEIGHT_PX = 480;
if (typeof document !== 'undefined') {
  document.documentElement.style.minHeight = `${CANVAS_MIN_HEIGHT_PX}px`;
  if (document.body) {
    document.body.style.minHeight = `${CANVAS_MIN_HEIGHT_PX}px`;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  rootElement.style.minHeight = `${CANVAS_MIN_HEIGHT_PX}px`;
  createRoot(rootElement).render(
    <StrictMode>
      <AppsProvider>
        <App />
      </AppsProvider>
    </StrictMode>,
  );
}
