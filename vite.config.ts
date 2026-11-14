import { existsSync, createReadStream, statSync } from 'node:fs';
import { resolve, join, normalize } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Dev only: while the event pipeline fills public/data/, serve any data file it has not
 * written yet from a local folder named in PLANETES_DATA (e.g. the practice app's data).
 * Never part of a build: the deployed site serves only what is in public/data/.
 */
function devDataFallback(): Plugin {
  const dir = process.env['PLANETES_DATA'];
  return {
    name: 'dev-data-fallback',
    apply: 'serve',
    configureServer(server) {
      if (!dir) return;
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        if (!path.startsWith('/data/')) return next();
        const rel = normalize(decodeURIComponent(path.slice('/data/'.length)));
        if (rel.startsWith('..')) return next();
        if (existsSync(join(import.meta.dirname, 'public/data', rel))) return next();
        const file = join(dir, rel);
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('X-Data-Fallback', 'practice');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  // Relative base: the site works on GitHub Pages under /<repo>/ and when embedded.
  base: './',
  plugins: [devDataFallback()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        credits: resolve(import.meta.dirname, 'credits.html'),
        tests: resolve(import.meta.dirname, 'tests.html'),
        fieldguide: resolve(import.meta.dirname, 'fieldguide.html'),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
