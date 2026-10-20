import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const here = import.meta.dirname;

export default defineConfig(({ command }) => ({
  root: command === 'serve' ? resolve(here, 'examples/vanilla') : here,
  resolve: {
    alias: { '@danielloynaz/timeline': resolve(here, 'src/index.js') },
  },
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(here, 'src/index.js'),
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
