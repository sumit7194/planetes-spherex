/**
 * "What's at this spot?" (D9): Physics' rules (15 Nov), fixed in code before any spot was tried.
 *
 * 1. Recentre: the brightest pixel within 1 px of the click in the later look, then the
 *    flux-weighted centroid of the 3×3 around it. Match radius 1.5 px = 9.2″ (v4's MATCH_ARCSEC).
 * 2. S/N gate first: the recentred spot must reach S/N ≥ 5 in the 2.5 px aperture (5–8 px annulus,
 *    as the live look) in at least one look; else "nothing clear at this pixel".
 * 3. Then, in order, listing every check that matched:
 *    0. on one of the five's pages, the page's own target at its predicted place (Physics, 15 Nov:
 *       WISE 0855 is in neither Gaia nor SkyBoT, so it could never be named otherwise);
 *    a. known asteroid: a SkyBoT object within R at the date of a look where the spot is ≥ 5σ;
 *    b. known star: Gaia DR3 or CatWISE2020 within R, moved by proper motion to that look's date;
 *    c. flagged: an artefact flag (v4's FIT_REJECT, by name) in the 3×3 in MORE THAN HALF of the
 *       photos where the spot is ≥ 5σ (a defect that is the spot persists; a union would pick up
 *       one-off cosmic rays). Each name's fraction is shown as information;
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
  let missing = 0;
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
        // A masked pixel (NaN: no data, or an artefact flag in a photo) is left out; a third of
        // the aperture missing gives no number.
        if (Number.isFinite(v)) ap.push(v);
        else missing++;
      } else if (d >= ANNULUS_PX[0] && d <= ANNULUS_PX[1] && Number.isFinite(v)) ann.push(v);
    }
  if (ap.length < 5 || missing * 3 > ap.length + missing || ann.length < 15) return null;
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

/** A known source within R of the light's centre, at its closest over the bright looks. */
export interface SpotSource {
  name: string;
  /** Arcsec from the light's centre. */
  sep: number;
  kind: 'target' | 'asteroid' | 'star';
}

export interface SpotFacts {
  /** S/N in each look (null: off the data). */
  sn: [number | null, number | null];
  /**
   * Every known source within R (the page's target at its predicted place, SkyBoT at a bright
   * look's dates, Gaia and CatWISE moved to each look's date). Without it, the name lists below
   * stand in (tests, and sources whose distance isn't known).
   */
  sources?: SpotSource[];
  /** On one of the five's pages: its name when its predicted place at a look's date is within R. */
  target?: string | null;
  /** Per look: known asteroids within R at that look's date (names). */
  asteroids: [string[], string[]];
  /** Per look: known stars within R at that look's date ("Gaia DR3 …", "CatWISE …"). */
  stars: [string[], string[]];
  /** Per look: artefact flag names counted by the majority rule, over that look's photos. */
  artefacts: [string[], string[]];
  /** Information flags seen (OUTLIER, SOURCE). */
  info: string[];
  /** D6: the spot stays put on the detector (Physics' rule, stuckOnDetector). */
  stuck?: boolean;
}

export type Verdict =
  | { kind: 'nothing' }
  | { kind: 'target'; name: string }
  | { kind: 'blend'; sources: SpotSource[] }
  | { kind: 'asteroid'; names: string[] }
  | { kind: 'star'; names: string[]; flagged: string[] }
  | { kind: 'artefact'; flags: string[]; stuck: boolean }
  | { kind: 'unknown'; faint: boolean };

/**
 * Physics' order (15 Nov, second rule): the gate; then every known source within R, with no
 * priority for the page's target. One source is the headline; two or more are a blend (nearest
 * first; 6″ pixels can't separate them). Then artefact (flags by the majority rule, or the spot
 * staying put on the detector), then unknown.
 */
export function verdict(f: SpotFacts): Verdict {
  const bright = f.sn.map((v) => v !== null && v >= SPOT_SN) as [boolean, boolean];
  if (!bright[0] && !bright[1]) return { kind: 'nothing' };
  const inBright = <T>(x: [T[], T[]]) => [
    ...new Set([...(bright[0] ? x[0] : []), ...(bright[1] ? x[1] : [])]),
  ];
  const flags = inBright(f.artefacts);
  const sources = (
    f.sources ?? [
      ...(f.target ? [{ name: f.target, sep: NaN, kind: 'target' as const }] : []),
      ...inBright(f.asteroids).map((name) => ({ name, sep: NaN, kind: 'asteroid' as const })),
      ...[...new Set([...f.stars[0], ...f.stars[1]])].map((name) => ({
        name,
        sep: NaN,
        kind: 'star' as const,
      })),
    ]
  )
    .slice()
    .sort((a, b) => (Number.isNaN(a.sep) ? 1 : Number.isNaN(b.sep) ? -1 : a.sep - b.sep));
  if (sources.length >= 2) return { kind: 'blend', sources };
  const one = sources[0];
  if (one?.kind === 'target') return { kind: 'target', name: one.name };
  if (one?.kind === 'asteroid') return { kind: 'asteroid', names: [one.name] };
  if (one) return { kind: 'star', names: [one.name], flagged: flags };
  if (flags.length || f.stuck) return { kind: 'artefact', flags, stuck: !!f.stuck };
  const best = Math.max(...f.sn.map((v) => v ?? -Infinity));
  return { kind: 'unknown', faint: best < FAINT_SN };
}

/**
 * D6, Physics' rule (15 Nov): the spot stays put on the detector when the photos that show it put
 * it at no more than 2 detector places, and at either place the same pixel is bright (S/N ≥ 5) in
 * more than half of at least 3 photos looking elsewhere.
 */
export function stuckOnDetector(places: number, probes: { bright: number; n: number }[]): boolean {
  return places <= 2 && probes.some((p) => p.n >= 3 && p.bright * 2 > p.n);
}

/** Physics' majority rule: flag names set in more than half of the photos that show the spot. */
export function majorityFlags(perPhoto: Set<string>[]): {
  counted: string[];
  fractions: [string, number][];
} {
  const n = perPhoto.length;
  const counts = new Map<string, number>();
  for (const flags of perPhoto) for (const f of flags) counts.set(f, (counts.get(f) ?? 0) + 1);
  const fractions = [...counts].sort((a, b) => b[1] - a[1]) as [string, number][];
  return {
    counted: fractions
      .filter(([name, k]) => ARTEFACT_FLAGS.has(name) && k * 2 > n)
      .map(([name]) => name),
    fractions,
  };
}

/** Two known sources within this of the spot blend at SPHEREx's 6.15″ pixels (2 px). */
export const BLEND_ARCSEC = 2 * 6.15;

/**
 * D6, the detector test (information only until Physics sets the rule). A real source moves with
 * the sky, so across photos it lands on many different detector pixels; a defect stays put on one.
 */
export interface DetectorPlace {
  det: number;
  x: number;
  y: number;
}

/** How many different places on the detectors (more than `minPx` apart) these photos put the spot. */
export function distinctPlaces(places: DetectorPlace[], minPx = 2): number {
  return placesOf(places, minPx).length;
}

/** One photo per different place on the detectors (more than `minPx` apart), first seen first. */
export function placesOf<T extends DetectorPlace>(places: T[], minPx = 2): T[] {
  const kept: T[] = [];
  for (const p of places)
    if (!kept.some((k) => k.det === p.det && Math.hypot(k.x - p.x, k.y - p.y) <= minPx))
      kept.push(p);
  return kept;
}

/**
 * The spot itself must land at least this far from the probed pixel (16 px = 98″): the probe's
 * aperture and 5–8 px background ring then sit well clear of the source's own light. (5 px was
 * tried first: on WISE 0855's page the G 16.3 star's own light lit the probe in 8 of 8.)
 */
export const ELSEWHERE_PX = 16;

/**
 * Photos to read at the reference pixel: the same detector, with the spot itself landing at least
 * ELSEWHERE_PX away, so that pixel looks at other sky. At most `n`, spread through the list.
 */
export function samePixelProbes<T extends DetectorPlace>(
  ref: DetectorPlace,
  list: T[],
  n = 8,
): T[] {
  const ok = list.filter(
    (p) => p.det === ref.det && Math.hypot(p.x - ref.x, p.y - ref.y) >= ELSEWHERE_PX,
  );
  const step = Math.max(1, ok.length / n);
  return Array.from({ length: Math.min(n, ok.length) }, (_, i) => ok[Math.floor(i * step)]).filter(
    (p): p is T => !!p,
  );
}

/**
 * One photo's box as a grid to measure in, with every pixel carrying an artefact flag (v4's
 * FIT_REJECT, by the file's own bit names) masked out. Found on WISE 0855's page (15 Nov): a dead
 * pixel (value 563, flagged NONFUNC) under the spot read as S/N 1,872 in one photo.
 */
export function photoGrid(
  image: Float32Array,
  flags: Int32Array,
  w: number,
  h: number,
  bits: Record<string, number>,
): Grid {
  let reject = 0;
  for (const [name, bit] of Object.entries(bits)) if (ARTEFACT_FLAGS.has(name)) reject |= 1 << bit;
  return {
    w,
    h,
    at: (x, y) => ((flags[y * w + x] ?? 0) & reject ? NaN : (image[y * w + x] ?? NaN)),
  };
}

/**
 * Which known stars within R count toward the verdict (provisional, 15 Nov, for Physics to
 * confirm): a Gaia star more than `dmag` magnitudes fainter than the brightest Gaia star there
 * gives under 1% of its light, so it isn't named in a blend. Found on Barnard's Star (G 8.2) with
 * three G ≈ 21 stars inside R. Sources without a G magnitude (CatWISE) always count.
 */
export const BLEND_DMAG = 5;
export function relevantStars<T extends { mag?: number | null }>(
  stars: T[],
  dmag = BLEND_DMAG,
): T[] {
  const mags = stars.map((x) => x.mag).filter((m): m is number => typeof m === 'number');
  if (!mags.length) return stars;
  const brightest = Math.min(...mags);
  return stars.filter((x) => typeof x.mag !== 'number' || x.mag <= brightest + dmag);
}
