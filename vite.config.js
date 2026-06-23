import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';

const MARKER_FILE = resolve(import.meta.dirname, '.vite-dev');
const PORT = 5173;

// Inside DDEV the dev server is reached over the project's HTTPS hostname on the
// exposed port (see .ddev/config.local.yaml -> web_extra_exposed_ports). DDEV
// sets DDEV_HOSTNAME (e.g. my-site.ddev.site). Elsewhere fall back to localhost.
const ddevHost = process.env.DDEV_HOSTNAME;
const ORIGIN = ddevHost
  ? `https://${ddevHost}:${PORT}`
  : `http://localhost:${PORT}`;

/**
 * Vite plugin that writes a .vite-dev marker when the dev server starts so
 * the Drupal theme PHP can detect it and load assets from the dev server.
 * The marker stores the full public origin (not just the port) so the theme
 * can point at the dev server correctly under DDEV or on a bare localhost.
 * The marker is removed when the server closes or a production build runs.
 */
function viteDevMarker() {
  return {
    name: 'drupal-vite-dev-marker',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        writeFileSync(MARKER_FILE, ORIGIN);
      });
      server.httpServer?.once('close', () => {
        if (existsSync(MARKER_FILE)) unlinkSync(MARKER_FILE);
      });
    },
    closeBundle() {
      if (existsSync(MARKER_FILE)) unlinkSync(MARKER_FILE);
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    viteDevMarker(),
  ],

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'src/main.js'),
      },
      // Emit predictable, unhashed filenames so the theme's .libraries.yml can
      // reference dist/main.js and dist/main.css directly. Cache-busting is
      // handled by Drupal's own asset query string, not by Vite hashing.
      output: {
        entryFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },

  server: {
    // Listen on all interfaces so the DDEV router can reach the dev server.
    host: '0.0.0.0',
    port: PORT,
    strictPort: true,
    // Public origin used for generated asset URLs.
    origin: ORIGIN,
    cors: { origin: '*' },
    // Allow Drupal (on any host) to load assets from this dev server.
    allowedHosts: 'all',
    // Under DDEV, HMR runs over the secure router on the exposed port.
    ...(ddevHost
      ? { hmr: { protocol: 'wss', host: ddevHost, clientPort: PORT } }
      : {}),
  },
});
