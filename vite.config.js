import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ command }) => ({
  root: command === 'serve' ? resolve(__dirname, 'examples/vanilla') : __dirname,
  resolve: {
    alias: { '@itech/timeline': resolve(__dirname, 'src/index.js') },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      formats: ['es'],
      fileName: () => 'timeline.js',
      cssFileName: 'timeline',
    },
    rollupOptions: {
      output: { assetFileNames: 'timeline.[ext]' },
    },
    target: 'es2022',
  },
}));
