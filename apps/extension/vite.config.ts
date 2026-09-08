import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_PACKAGES = ['@recall/core', '@recall/ui', '@recall/app'];

/**
 * Copies the manifest and icons into the build output.
 *
 * `public/` would normally handle this, but the manifest lives at the package
 * root so that `scripts/generate-extension-key.mjs` can rewrite it in place
 * without reaching into a build directory.
 */
function copyExtensionAssets(): Plugin {
  return {
    name: 'recall-copy-extension-assets',
    apply: 'build',
    closeBundle() {
      const out = resolve(here, 'dist');
      mkdirSync(resolve(out, 'icons'), { recursive: true });
      copyFileSync(resolve(here, 'manifest.json'), resolve(out, 'manifest.json'));
      for (const file of readdirSync(resolve(here, 'public/icons'))) {
        copyFileSync(resolve(here, 'public/icons', file), resolve(out, 'icons', file));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionAssets()],
  optimizeDeps: { exclude: WORKSPACE_PACKAGES },
  // Chrome loads these files directly from disk, so every reference has to be
  // relative rather than rooted at the server origin.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // Manifest V3 forbids remote code, and readable output makes the
    // extension reviewable; there is no bundle-size pressure here.
    minify: false,
    rollupOptions: {
      input: {
        popup: resolve(here, 'popup.html'),
        options: resolve(here, 'options.html'),
        background: resolve(here, 'src/background.ts'),
      },
      output: {
        // The manifest names `background.js` literally, so entry filenames
        // cannot be hashed.
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
  },
});
