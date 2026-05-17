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

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <AppsProvider>
        <App />
      </AppsProvider>
    </StrictMode>,
  );
}
