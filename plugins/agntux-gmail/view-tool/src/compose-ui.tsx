import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppsProvider } from './lib/apps-react/index.js';
import { App } from './App.js';
import './globals.css';

// Iframe-height floor for the gmail compose view. See triage-ui.tsx in
// agntux-core for the full rationale.
const COMPOSE_MIN_HEIGHT_PX = 480;
if (typeof document !== 'undefined') {
  document.documentElement.style.minHeight = `${COMPOSE_MIN_HEIGHT_PX}px`;
  if (document.body) {
    document.body.style.minHeight = `${COMPOSE_MIN_HEIGHT_PX}px`;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  rootElement.style.minHeight = `${COMPOSE_MIN_HEIGHT_PX}px`;
  createRoot(rootElement).render(
    <StrictMode>
      <AppsProvider>
        <App />
      </AppsProvider>
    </StrictMode>,
  );
}
