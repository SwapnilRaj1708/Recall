import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const WORKSPACE_PACKAGES = ['@recall/core', '@recall/ui', '@recall/app'];

/**
 * The phone cannot reach "localhost" on the development machine.
 *
 * `tauri android dev` sets TAURI_DEV_HOST to an address the device can see and
 * expects the dev server to be listening on it. Without this the app installs
 * and launches to a blank screen, which looks like a build failure and is not.
 */
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: WORKSPACE_PACKAGES },
  base: './',
  server: {
    // 5175, so web (5173) and desktop (5174) can run at the same time.
    port: 5175,
    // The config points at this exact port; a silent fallback would leave the
    // phone showing an empty webview with no obvious cause.
    strictPort: true,
    host: host ?? false,
    hmr: host ? { protocol: 'ws', host, port: 5176 } : undefined,
    watch: {
      // Cargo holds locks in here while it links; watching it kills the run.
      ignored: ['**/src-tauri/**', '**/target/**'],
    },
  },
  clearScreen: false,
  build: {
    // Android WebView on a current device is Chromium; no need to down-level.
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
