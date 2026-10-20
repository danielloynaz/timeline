// Serves the repository root so Playwright can load examples/ and tests/**/*.html.
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: __dirname,
  resolve: { alias: { '@itech/timeline': resolve(__dirname, 'src/index.js') } },
  server: { host: '127.0.0.1' },
});
