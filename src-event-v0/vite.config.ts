import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Relative base so the site works on GitHub Pages under /<repo>/ and when embedded.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), about: resolve(__dirname, 'about.html') } },
  },
});
