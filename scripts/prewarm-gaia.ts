/**
 * Warms the helper's cache with the Gaia patches the zoomed sky will ask for at the spots people
 * are most likely to zoom on (Viewer, 14 Nov): the five, the Surprise spots and a few showpieces.
 * A patch is slow from ESA only the first time anyone asks (3–13 s); after that the helper answers
 * from its cache, wherever the visitor is. Uses the page's own patch picker, so it warms exactly
 * what the page will request.
 *
 * Usage: npx tsx scripts/prewarm-gaia.ts [--conc 4]
 */
import { readFileSync } from 'node:fs';
import { patchesForView } from '../src/app/deepStars';

const HELPER = 'https://planetes-edge.planetes.workers.dev';
const conc = Number(process.argv[process.argv.indexOf('--conc') + 1]) || 4;

const spots: { name: string; ra: number; dec: number }[] = [];
for (const t of ['barnard', 'w0855', 'epsind-b', 'rw-aur', 'r-dra']) {
  const m = JSON.parse(readFileSync(`public/data/packs/dr1qr3/${t}/manifest.json`, 'utf8'));
  spots.push({ name: m.target.name, ra: m.grid.centre.ra, dec: m.grid.centre.dec });
}
const surprise = JSON.parse(readFileSync('public/data/surprise.json', 'utf8'));
for (const s of Array.isArray(surprise) ? surprise : (surprise.spots ?? surprise.stars ?? []))
  spots.push({ name: s.name, ra: s.ra, dec: s.dec });
spots.push(
  { name: 'Galactic centre', ra: 266.417, dec: -29.008 },
  { name: 'Orion Nebula', ra: 83.822, dec: -5.391 },
  { name: 'Pleiades', ra: 56.75, dec: 24.117 },
  { name: 'Betelgeuse', ra: 88.793, dec: 7.407 },
  { name: 'Vega', ra: 279.235, dec: 38.784 },
  { name: 'Arcturus', ra: 213.907, dec: 19.168 },
);

// The fields a visitor passes through zooming in to the floor (2°), on a ~1,350 px wide view.
const FOVS = [25, 18, 12, 8, 5, 3.5, 2];
const keys = new Set<string>();
for (const s of spots)
  for (const fov of FOVS)
    for (const p of patchesForView({ inside: true, centre: s, fov, cssPxPerDeg: 1350 / fov }))
      keys.add(`${p.tier.order}/${p.pix}`);

const todo = [...keys];
console.log(`${spots.length} spots, ${todo.length} patches, ${conc} at a time`);
let done = 0;
let hit = 0;
let failed = 0;
const t0 = Date.now();
async function worker(): Promise<void> {
  for (;;) {
    const k = todo.shift();
    if (!k) return;
    const [order, pix] = k.split('/');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`${HELPER}/v1/gaiapatch?order=${order}&pix=${pix}`);
        if (r.ok) {
          await r.arrayBuffer();
          if (r.headers.get('x-planetes-cache') === 'hit') hit++;
          break;
        }
        if (attempt === 2) failed++;
      } catch {
        if (attempt === 2) failed++;
      }
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
    if (++done % 50 === 0)
      console.log(
        `${done} done (${hit} already cached, ${failed} failed), ${Math.round((Date.now() - t0) / 1000)} s`,
      );
  }
}
await Promise.all(Array.from({ length: conc }, worker));
console.log(
  `all ${done} done: ${hit} were already cached, ${failed} failed, ${Math.round((Date.now() - t0) / 1000)} s`,
);
