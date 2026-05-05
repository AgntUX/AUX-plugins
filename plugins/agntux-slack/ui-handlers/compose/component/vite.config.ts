import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'out',
    emptyOutDir: true,
    // Ensure assets are inlined
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  // Resolve mcp-apps-kit packages from local paths
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
});
