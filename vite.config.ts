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
  },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
