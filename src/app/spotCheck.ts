/**
 * "What's at this spot?" (D9): Physics' rules (15 Nov), fixed in code before any spot was tried.
 *
 * 1. Recentre: the brightest pixel within 1 px of the click in the later look, then the
 *    flux-weighted centroid of the 3×3 around it. Match radius 1.5 px = 9.2″ (v4's MATCH_ARCSEC).
 * 2. S/N gate first: the recentred spot must reach S/N ≥ 5 in the 2.5 px aperture (5–8 px annulus,
 *    as the live look) in at least one look; else "nothing clear at this pixel".
 * 3. Then, in order, listing every check that matched:
 *    a. known asteroid: a SkyBoT object within R at the date of a look where the spot is ≥ 5σ;
 *    b. known star: Gaia DR3 or CatWISE2020 within R, moved by proper motion to that look's date;
 *    c. flagged: an artefact flag (v4's FIT_REJECT, by name) in the 3×3, in a look where ≥ 5σ;
 *    d. otherwise unknown. A known star with a flag stays a known star, with a note.
 * 4. Flags by name only, from each file's own header. OUTLIER (fires on real asteroids) and
 *    SOURCE (a catalogue map) never count; they are shown as information.
 * 5. Unknowns are "candidates", never discoveries; 5 ≤ S/N < 7 adds "faint: likely noise".
 */
import type { Tile } from '../data/pack/load';

export const MATCH_PX = 1.5;
export const MATCH_ARCSEC = MATCH_PX * 6.15;
export const SPOT_SN = 5;
export const FAINT_SN = 7;
const APER_PX = 2.5;
const ANNULUS_PX: [number, number] = [5, 8];

/** v4's FIT_REJECT flags (qr3-adapter src/smo/data/flags.py), matched by name. */
export const ARTEFACT_FLAGS = new Set([
  'TRANSIENT',
  'OVERFLOW',
  'SUR_ERROR',
  'PHANTOM',
  'REFERENCE',
  'NONFUNC',
  'DICHROIC',
  'MISSING_DATA',
  'HOT',
  'COLD',
  'PHANMISS',
  'NONLINEAR',
  'PERSIST',
  'CROSSTALK',
  'GHOST',
  'GHOST_FPA',
  'GHOST_EXT',
  'STREAK',
  'BLOOM',
  'SNOWBALL',
  'HALO',
  'SATELLITE_HALO',
]);
/** Shown, never counted: OUTLIER fires on real asteroids; SOURCE is a catalogue map. */
export const INFO_FLAGS = new Set(['OUTLIER', 'SOURCE']);

/** Pixel values row-major (row 0 = the image's first row); a 2-D image to measure in. */
export interface Grid {
  w: number;
  h: number;
  at(x: number, y: number): number;
}

export function tileGrid(t: Tile): Grid {
  return { w: t.size, h: t.size, at: (x, y) => t.pixels[y * t.size + x] ?? NaN };
}

/**
 * The click recentred: the brightest pixel within 1 px of (x, y), then the flux-weighted centroid
 * of the 3×3 around it (values above the 3×3's minimum, so a flat background doesn't pull it).
 */
export function recentre(g: Grid, x: number, y: number): { x: number; y: number } {
  const xi = Math.round(x);
  const yi = Math.round(y);
  let bx = xi;
  let by = yi;
  let best = -Infinity;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const v = g.at(xi + dx, yi + dy);
      if (Number.isFinite(v) && v > best) {
        best = v;
        bx = xi + dx;
        by = yi + dy;
      }
    }
  const box: [number, number, number][] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const v = g.at(bx + dx, by + dy);
      if (Number.isFinite(v)) box.push([bx + dx, by + dy, v]);
    }
  if (!box.length) return { x, y };
  const floor = Math.min(...box.map((b) => b[2]));
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (const [px, py, v] of box) {
    const w = v - floor;
    sw += w;
    sx += w * px;
    sy += w * py;
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: bx, y: by };
}

/** S/N in the 2.5 px aperture at (x, y), 5–8 px annulus median and scatter; null if off the data. */
export function apertureSN(g: Grid, x: number, y: number): number | null {
  const ap: number[] = [];
  const ann: number[] = [];
  const r = ANNULUS_PX[1];
  for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++)
    for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      const d = Math.hypot(xx - x, yy - y);
      const outside = xx < 0 || yy < 0 || xx >= g.w || yy >= g.h;
      // An aperture running off the image gives no number (an annulus may be partly off).
      if (outside) {
        if (d <= APER_PX) return null;
        continue;
      }
      const v = g.at(xx, yy);
      if (d <= APER_PX) {
        if (!Number.isFinite(v)) return null;
        ap.push(v);
      } else if (d >= ANNULUS_PX[0] && d <= ANNULUS_PX[1] && Number.isFinite(v)) ann.push(v);
    }
  if (ap.length < 5 || ann.length < 15) return null;
  ann.sort((a, b) => a - b);
  const bk = ann[ann.length >> 1] ?? 0;
  const dev = ann.map((v) => Math.abs(v - bk)).sort((a, b) => a - b);
  const sd = 1.4826 * (dev[dev.length >> 1] ?? 0);
  if (!(sd > 0)) return null;
  const sum = ap.reduce((s, v) => s + (v - bk), 0);
  return sum / (sd * Math.sqrt(ap.length * (1 + ap.length / ann.length)));
}

/** Flag names set anywhere in the 3×3 around a detector pixel, decoded from the file's own bits. */
export function flagNamesNear(
  words: Int32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  bits: Record<string, number>,
): Set<string> {
  let or = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.round(x) + dx;
      const yy = Math.round(y) + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) or |= words[yy * w + xx] ?? 0;
    }
  const out = new Set<string>();
  for (const [name, bit] of Object.entries(bits)) if ((or >>> bit) & 1) out.add(name);
  return out;
}

export interface SpotFacts {
  /** S/N in each look (null: off the data). */
  sn: [number | null, number | null];
  /** Per look: known asteroids within R at that look's date (names). */
  asteroids: [string[], string[]];
  /** Per look: known stars within R at that look's date ("Gaia DR3 …", "CatWISE …"). */
  stars: [string[], string[]];
  /** Per look: artefact flag names seen in the 3×3, over that look's photos. */
  artefacts: [string[], string[]];
  /** Information flags seen (OUTLIER, SOURCE). */
  info: string[];
}

export type Verdict =
  | { kind: 'nothing' }
  | { kind: 'asteroid'; names: string[] }
  | { kind: 'star'; names: string[]; flagged: string[] }
  | { kind: 'artefact'; flags: string[] }
  | { kind: 'unknown'; faint: boolean };

/** Physics' order: the gate, then asteroid, known star, artefact, unknown. */
export function verdict(f: SpotFacts): Verdict {
  const bright = f.sn.map((v) => v !== null && v >= SPOT_SN) as [boolean, boolean];
  if (!bright[0] && !bright[1]) return { kind: 'nothing' };
  const inBright = <T>(x: [T[], T[]]) => [
    ...new Set([...(bright[0] ? x[0] : []), ...(bright[1] ? x[1] : [])]),
  ];
  const asteroids = inBright(f.asteroids);
  if (asteroids.length) return { kind: 'asteroid', names: asteroids };
  const stars = [...new Set([...f.stars[0], ...f.stars[1]])];
  const flags = inBright(f.artefacts);
  if (stars.length) return { kind: 'star', names: stars, flagged: flags };
  if (flags.length) return { kind: 'artefact', flags };
  const best = Math.max(...f.sn.map((v) => v ?? -Infinity));
  return { kind: 'unknown', faint: best < FAINT_SN };
}
