import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setupWidgetMatchers } from './matchers/index.js';

afterEach(() => {
  cleanup();
});

setupWidgetMatchers();
