import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.NOVELWRITER_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: api, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000 },
});
