import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { rivet } from '@rivetjs/compiler/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [rivet(), tailwindcss()],
  // The published UI kit contains Rivet JSX; Vite's generic dependency
  // optimizer would otherwise transform those files as React JSX in dev.
  optimizeDeps: {
    exclude: ['@rivetjs/ui'],
    include: ['tailwind-variants', 'tailwind-variants/lite'],
  },
  resolve: {
    alias: { 'tetra-stream': fileURLToPath(new URL('../../libs/tetra-stream/src/index.ts', import.meta.url)) },
  },
  server: { host: '127.0.0.1', port: 5173, fs: { allow: ['../..'] } },
  build: {
    outDir: '../../dist/apps/playground', emptyOutDir: true,
    rolldownOptions: {
      input: {
        home: fileURLToPath(new URL('./index.html', import.meta.url)),
        guide: fileURLToPath(new URL('./guide/index.html', import.meta.url)),
      },
    },
  },
});
