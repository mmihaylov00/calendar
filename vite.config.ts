import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

// Multi-page build: / -> display (Raspberry Pi screen), /admin/ -> management panel.
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [preact()],
  // Build version used to refresh the calendar after an update.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    // The HEIC decoder (heic-to, ~3 MB) is its own lazily imported chunk, loaded only when a HEIC photo is picked.
    chunkSizeWarningLimit: 3300,
    rollupOptions: {
      input: {
        display: resolve(root, 'web/index.html'),
        admin: resolve(root, 'web/admin/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/auth': { target: 'http://localhost:3000', changeOrigin: false },
      '/media': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
});
