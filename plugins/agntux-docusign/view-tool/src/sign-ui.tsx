import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppsProvider } from './lib/apps-react/index.js';
import { SignApp } from './apps/sign/App.js';
import './globals.css';

const VIEW_MIN_HEIGHT_PX = 420;
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
        <SignApp />
      </AppsProvider>
    </StrictMode>,
  );
}
