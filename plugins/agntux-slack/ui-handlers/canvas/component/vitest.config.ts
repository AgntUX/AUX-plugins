import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Force development builds of React for tests, even when NODE_ENV=production
    // This ensures React.act() is available (required by @testing-library/react)
    conditions: ['development', 'browser'],
  },
  define: {
    // Override NODE_ENV for tests to ensure React uses development build
    // This is necessary because React's CJS build checks process.env.NODE_ENV
    'process.env.NODE_ENV': '"test"',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.tsx'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/components/**/*.tsx'],
      exclude: ['src/__tests__/**', 'src/lib/**'],
    },
  },
});
