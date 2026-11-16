import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 2000,
    // Fonts are always files under /assets (hashed, cached for a year), never data: URLs (the CSP's font-src is 'self').
    assetsInlineLimit: (file: string) => (file.endsWith('.woff2') ? false : undefined),
  },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
