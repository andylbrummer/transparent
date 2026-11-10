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
    rollupOptions: {
      output: {
        // three.js is four-fifths of the startup script and changes only when
        // the dependency does: in a chunk of its own, a returning visitor's
        // browser keeps it across every release of the app's own code.
        manualChunks: { three: ['three'] },
      },
    },
    // That chunk is one library, as small as it tree-shakes: nothing to split further.
    chunkSizeWarningLimit: 600,
  },
  // Exposure: loopback. Serving to a phone on the LAN is a posture change the
  // project has not declared; pass `--host` for a one-off session instead.
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
