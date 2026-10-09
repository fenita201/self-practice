import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev only: the API runs on PORT (default 3000), Vite serves the UI on DEV_UI_PORT and proxies /api.
const apiPort = Number(process.env.PORT ?? 3000);
const uiPort = Number(process.env.DEV_UI_PORT ?? 5173);

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: uiPort,
    strictPort: true,
    host: process.env.DEV_UI_HOST ?? '127.0.0.1',
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      '/healthz': `http://127.0.0.1:${apiPort}`,
      '/readyz': `http://127.0.0.1:${apiPort}`,
    },
  },
});
