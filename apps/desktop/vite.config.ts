import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_PACKAGES = ['@recall/core', '@recall/ui', '@recall/app'];

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: WORKSPACE_PACKAGES },
  // Tauri serves the built files from disk in production.
  base: './',
  // 5174 so the desktop dev server can run alongside the web app's 5173.
  // strictPort matters here: tauri.conf.json points at this exact URL, and a
  // silent fallback to another port would leave the window blank.
  server: {
    port: 5174,
    strictPort: true,
    watch: {
      // Vite must not watch the Rust build directory. Cargo holds locks on
      // .exe files there while it links, and the watcher dies with EBUSY —
      // which takes the whole `tauri dev` run down with it.
      ignored: ['**/src-tauri/**', '**/target/**'],
    },
  },
  // Tauri surfaces Rust errors on stderr; let Vite's own noise through too.
  clearScreen: false,
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
        widget: resolve(here, 'widget.html'),
        quick: resolve(here, 'quick.html'),
      },
    },
  },
});
