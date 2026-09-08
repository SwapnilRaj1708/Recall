import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The workspace packages are consumed as TypeScript source rather than as built
 * bundles, which keeps the monorepo free of a build-orchestration step. Vite's
 * dependency optimiser has to be told to leave them alone, since it would
 * otherwise try to pre-bundle them as if they were published packages.
 */
const WORKSPACE_PACKAGES = ['@recall/core', '@recall/ui', '@recall/app'];

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Recall',
        short_name: 'Recall',
        description: 'One task list, on every screen you use.',
        theme_color: '#5b5bd6',
        background_color: '#f4f4f6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The app shell must load with no network so a capture can be made
        // offline; task data itself lives in IndexedDB, not in the cache.
        navigateFallback: '/index.html',
        // Never cache Supabase traffic — stale task data would be worse than
        // no data, and the sync engine already handles being offline.
        navigateFallbackDenylist: [/^\/auth/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  optimizeDeps: {
    exclude: WORKSPACE_PACKAGES,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
