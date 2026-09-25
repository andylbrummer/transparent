import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Resolve the workspace core package from source, not its built dist/, so dev,
// tests and typecheck never run against a stale or missing build.
const coreSrc = fileURLToPath(new URL('../packages/core/src', import.meta.url));

export default defineConfig({
  root: '.',
  // Relative asset URLs, so the build works under the GitHub Pages project
  // path (/<repo>/) as well as at a domain root.
  base: './',
  resolve: {
    alias: [{ find: /^@transparent-earth\/core(.*)$/, replacement: `${coreSrc}$1` }],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
  },
});
