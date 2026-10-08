import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

function gitVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

const api = process.env.NOVELWRITER_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(gitVersion()) },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: api, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000 },
});
