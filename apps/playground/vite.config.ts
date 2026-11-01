import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { rivetRouter } from '@rivetjs/router/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ isSsrBuild }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    rivetRouter({
      mode: 'static',
      locales: ['en-US'],
      adapter: 'cloudflare',
      trailingSlash: 'always',
      styles: ['src/style.css'],
    }),
    tailwindcss(),
  ],
  // The published UI kit contains Rivet JSX; Vite's generic dependency
  // optimizer would otherwise transform those files as React JSX in dev.
  optimizeDeps: {
    exclude: ['@rivetjs/ui'],
    include: ['tailwind-variants', 'tailwind-variants/lite'],
  },
  resolve: {
    alias: {
      'tetra-stream': fileURLToPath(
        new URL('../../libs/tetra-stream/src/index.ts', import.meta.url),
      ),
    },
  },
  server: { host: '127.0.0.1', port: 5173, fs: { allow: ['../..'] } },
  build: {
    outDir: `../../dist/apps/playground/${isSsrBuild ? 'server' : 'client'}`,
    emptyOutDir: true,
  },
}));
