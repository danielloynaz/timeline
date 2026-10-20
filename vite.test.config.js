// Serves the repository root so Playwright can load examples/ and tests/**/*.html.
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: { '@itech/timeline': resolve(import.meta.dirname, 'src/index.js') } },
  server: { host: '127.0.0.1', hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
