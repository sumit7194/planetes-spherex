/**
 * A "what changed" film for a live colour-range series (queue #8; Physics' video rule, adopted
 * 14 Nov: films may show photo − all-dates sky as labelled pictures; numbers only from strict
 * same-colour matching).
 *
 * For each frame, a reference sky is built from the photos of OTHER dates (at least
 * `minGapDays` away) whose colour is nearest to this frame's: the per-pixel median of up to
 * `k` of them. A star that stayed put is in every reference photo and cancels; something that
 * moved sits in a different place on other dates, so the median drops it and it stands out as
 * a bright spot (where it is now), with no dark twin unless it was also here in the references.
 *
 * Stars change brightness with colour, so each frame's reference is scaled by one factor fitted
 * on the brighter reference pixels away from the target, clipped to 0.8-1.25; references must be
 * within one colour step (the band width); a smooth background plane is removed from every frame. SPHEREx stars are only ~2 px
 * wide and their exact shape changes with colour and with where they fall on a pixel, so both
 * images are first softened a little (Gaussian, `soften` px): measured on the five packs, that
 * halves the still-star leftovers (27% -> 13-21% of their brightness) while a point-like mover
 * stays as easy to see (its peak and the noise drop alike). A common per-frame shift removed only
 * ~10% of the leftovers, so it isn't applied. What remains, rings and small dark/bright pairs on
 * bright stars, comes from the blur, not from motion: the film must say so.
 *
 * Written during the event (14 Nov 2026). Pure function: no network, no DOM.
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion --
   Typed-array loops whose bounds are fixed by construction (n = size², chosen indices). */
import type { Tile } from '../pack/load';
import { FlagMask } from '../pack/types';

export interface FilmInput {
  tile: Tile;
  mjd: number;
  lambdaUm: number;
  /** The photo's band width at the spot (one colour step, µm); from the WCS-WAVE table. */
  bandwidthUm?: number;
  /** Detector 1-6, for a fallback colour step (λ/R) when the band width is missing. */
  detector?: number;
  /** The photo's orientation on the sky (position angle, degrees), for same-orientation references. */
  orientationDeg?: number;
}

export interface DifferenceFrame {
  /** This frame minus its reference, both softened (MJy/sr); NaN where unusable, saturated or bad. */
  pixels: Float32Array;
  /** Whether a reference could be built (enough other-date photos near this colour). */
  ok: boolean;
  /** How many photos made the reference. */
  refCount: number;
  /** Whether every reference photo had this photo's scan orientation (see FilmOptions). */
  sameOrientation: boolean;
  /** The largest colour gap among them, as a fraction of this frame's wavelength. */
  maxDlamFrac: number;
  /** ...and in colour steps (resolution elements: this frame's band width). */
  maxDlamSteps: number;
  /** The closest date gap among them, days. */
  minGapDays: number;
  /** The mean date (MJD) of the reference photos: a mover's "then" position. */
  refMeanMjd: number;
  /** The brightness factor the reference was scaled by (1 = none). */
  scale: number;
}

export interface FilmOptions {
  /** Reference photos per frame (median of up to this many). */
  k?: number;
  /** Fewest reference photos for a frame to be shown. */
  minRefs?: number;
  /** Reference photos must be at least this far apart in time, days (other passes). */
  minGapDays?: number;
  /**
   * ...and within this many colour steps (resolution elements) of this frame's colour. Physics,
   * 14 Nov: a fixed % of λ is ~2 steps on D1-D4 (R ~35-41) but ~5-6 on D5/D6 (R ~110-130), where
   * brown dwarfs' CH4 and CO bands would make a pure colour change look like a change.
   */
  maxDlamSteps?: number;
  /**
   * Pixels (grid x, y, radius) left out of the brightness fit: the target and any known mover,
   * so their own change isn't scaled away. Default: 4 px around the grid centre.
   */
  exclude?: { x: number; y: number; r: number }[];
  /** The brightness factor's limits. */
  scaleClip?: [number, number];
  /**
   * Prefer reference photos whose orientation is within this many degrees of the frame's
   * (Physics, 14 Nov: the blur's orientation flips between the half-year passes, leaving a small
   * date-signed pair on steady stars). Falls back to any orientation when too few remain.
   * Default 90° (only used when the inputs carry orientationDeg; pass photo.paDeg). Measured on
   * the packs (descriptive, after the method was set): with same-orientation references the steady
   * stars' date-signed pair across the motion fell from 60-62% / +0.13 px to 52-58% / +0.01-0.05
   * px, and Barnard's from +0.76 px to -0.05 px, while its pair along its motion grew (87% -> 97%).
   */
  orientationTolDeg?: number;
  /** Gaussian softening (sigma, grid px) applied to every frame before differencing; 0 = none. */
  soften?: number;
}

const BAD = FlagMask.saturated | FlagMask.rejected;

/**
 * A Gaussian blur that ignores NaN pixels (normalised by the weight that landed), separable.
 * Pixels where less than half the weight came from real data stay NaN.
 */
export function softenNaN(src: Float32Array, size: number, sigma: number): Float32Array {
  if (!(sigma > 0)) return src;
  const r = Math.ceil(3 * sigma);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) =>
    Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)),
  );
  const ksum = k.reduce((a, b) => a + b, 0);
  const pass = (v: Float32Array, w: Float32Array, horizontal: boolean) => {
    const ov = new Float32Array(v.length);
    const ow = new Float32Array(v.length);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let sv = 0;
        let sw = 0;
        for (let t = -r; t <= r; t++) {
          const xx = horizontal ? x + t : x;
          const yy = horizontal ? y : y + t;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          const q = yy * size + xx;
          sv += k[t + r]! * v[q]!;
          sw += k[t + r]! * w[q]!;
        }
        ov[y * size + x] = sv;
        ow[y * size + x] = sw;
      }
    return [ov, ow] as const;
  };
  const v0 = new Float32Array(src.length);
  const w0 = new Float32Array(src.length);
  for (let p = 0; p < src.length; p++) {
    const ok = Number.isFinite(src[p]!);
    v0[p] = ok ? src[p]! : 0;
    w0[p] = ok ? 1 : 0;
  }
  const [v1, w1] = pass(v0, w0, true);
  const [v2, w2] = pass(v1, w1, false);
  const out = new Float32Array(src.length);
  for (let p = 0; p < src.length; p++) out[p] = w2[p]! >= 0.5 * ksum * ksum ? v2[p]! / w2[p]! : NaN;
  return out;
}

/** One colour step at this photo's colour: its band width, or λ/R when that is missing. */
function colourStep(f: FilmInput): number {
  if (f.bandwidthUm !== undefined && f.bandwidthUm > 0) return f.bandwidthUm;
  const r = f.detector !== undefined && f.detector >= 5 ? 120 : 38;
  return f.lambdaUm / r;
}

/**
 * Subtracts a fitted plane (a + b·x + c·y) from an image, fitted on its faint pixels only
 * (sources clipped twice at 2.5 robust sigma), NaN-aware. Physics: the frame median removes an
 * offset but not a slope, and DR1's zodiacal-light model changes shape along rows by up to ~15%.
 */
export function removePlane(img: Float32Array, size: number): Float32Array {
  let keep = Array.from(img, (v) => Number.isFinite(v));
  let coef: [number, number, number] = [0, 0, 0];
  for (let it = 0; it < 3; it++) {
    // Least squares for a + b x + c y on the kept pixels (3x3 normal equations).
    const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const rhs = [0, 0, 0];
    for (let p = 0; p < img.length; p++) {
      if (!keep[p]) continue;
      const x = (p % size) / size - 0.5;
      const y = Math.floor(p / size) / size - 0.5;
      const row = [1, x, y];
      for (let a = 0; a < 3; a++) {
        rhs[a]! += row[a]! * img[p]!;
        for (let b = 0; b < 3; b++) m[a * 3 + b]! += row[a]! * row[b]!;
      }
    }
    const solved = solve3(m, rhs);
    if (!solved) break;
    coef = solved;
    const res: number[] = [];
    for (let p = 0; p < img.length; p++) if (keep[p]) res.push(img[p]! - planeAt(coef, p, size));
    const med = median(res.slice());
    const sig = 1.4826 * median(res.map((r) => Math.abs(r - med)));
    keep = Array.from(
      img,
      (v, p) => Number.isFinite(v) && Math.abs(v - planeAt(coef, p, size) - med) <= 2.5 * sig,
    );
  }
  const out = new Float32Array(img.length);
  for (let p = 0; p < img.length; p++) out[p] = img[p]! - planeAt(coef, p, size);
  return out;
}

function planeAt(c: [number, number, number], p: number, size: number): number {
  return c[0] + c[1] * ((p % size) / size - 0.5) + c[2] * (Math.floor(p / size) / size - 0.5);
}

function solve3(m: number[], r: number[]): [number, number, number] | null {
  const det = (a: number[]) =>
    a[0]! * (a[4]! * a[8]! - a[5]! * a[7]!) -
    a[1]! * (a[3]! * a[8]! - a[5]! * a[6]!) +
    a[2]! * (a[3]! * a[7]! - a[4]! * a[6]!);
  const d = det(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  const col = (k: number) => m.map((v, i) => (i % 3 === k ? r[Math.floor(i / 3)]! : v));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

function median(v: number[]): number {
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : 0.5 * (v[m - 1]! + v[m]!);
}

export function differenceFilm(frames: FilmInput[], opts: FilmOptions = {}): DifferenceFrame[] {
  const k = opts.k ?? 7;
  const minRefs = opts.minRefs ?? 3;
  const gap = opts.minGapDays ?? 30;
  const maxSteps = opts.maxDlamSteps ?? 1;
  const soften = opts.soften ?? 0.6;
  const [clipLo, clipHi] = opts.scaleClip ?? [0.8, 1.25];
  // Bad pixels out first, then the same softening and smooth-background removal for every frame.
  const soft = frames.map((f) => {
    const v = new Float32Array(f.tile.pixels.length);
    for (let p = 0; p < v.length; p++) v[p] = f.tile.flags[p]! & BAD ? NaN : f.tile.pixels[p]!;
    return removePlane(softenNaN(v, f.tile.size, soften), f.tile.size);
  });
  return frames.map((f, i) => {
    const n = f.tile.pixels.length;
    const none: DifferenceFrame = {
      pixels: new Float32Array(n).fill(NaN),
      ok: false,
      refCount: 0,
      sameOrientation: false,
      maxDlamFrac: NaN,
      maxDlamSteps: NaN,
      minGapDays: NaN,
      refMeanMjd: NaN,
      scale: 1,
    };
    if (!Number.isFinite(f.lambdaUm)) return none;
    const step = colourStep(f);
    const tol = opts.orientationTolDeg ?? 90;
    const sameOri = (g: FilmInput) =>
      f.orientationDeg === undefined ||
      g.orientationDeg === undefined ||
      Math.abs(((g.orientationDeg - f.orientationDeg + 540) % 360) - 180) <= tol;
    const candidates = frames
      .map((g, j) => ({ g, j, d: Math.abs(g.lambdaUm - f.lambdaUm) / step }))
      .filter(
        ({ g, j, d }) =>
          j !== i &&
          g.tile.pixels.length === n &&
          Math.abs(g.mjd - f.mjd) >= gap &&
          Number.isFinite(d) &&
          d <= maxSteps,
      )
      .sort((a, b) => a.d - b.d);
    const matched = candidates.filter((c) => sameOri(c.g)).slice(0, k);
    const sameOrientation = f.orientationDeg !== undefined && matched.length >= minRefs;
    const refs = sameOrientation ? matched : candidates.slice(0, k);
    if (refs.length < minRefs) return { ...none, refCount: refs.length };

    // The per-pixel median of the references, leaving out their saturated or bad pixels.
    const ref = new Float32Array(n).fill(NaN);
    const vals: number[] = [];
    for (let p = 0; p < n; p++) {
      vals.length = 0;
      for (const { j } of refs) {
        const v = soft[j]![p]!;
        if (Number.isFinite(v)) vals.push(v);
      }
      // A majority of the references must agree on a pixel for it to count.
      if (vals.length * 2 > refs.length) ref[p] = median(vals);
    }

    // One brightness factor: least squares on the brighter reference pixels (top 10%), where
    // colour-driven changes show, leaving out the target and known movers (Physics: otherwise
    // the target's own change is scaled away); clipped narrowly for the same reason.
    const size = f.tile.size;
    const ex = opts.exclude ?? [{ x: (size - 1) / 2, y: (size - 1) / 2, r: 4 }];
    const usable = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      const x = p % size;
      const y = Math.floor(p / size);
      usable[p] = ex.some((e) => Math.hypot(x - e.x, y - e.y) <= e.r) ? 0 : 1;
    }
    const bright: number[] = [];
    for (let p = 0; p < n; p++) if (usable[p] && Number.isFinite(ref[p]!)) bright.push(ref[p]!);
    bright.sort((a, b) => a - b);
    const cut = bright.length ? bright[Math.floor(bright.length * 0.9)]! : Infinity;
    let sfr = 0;
    let srr = 0;
    const mine = soft[i]!;
    for (let p = 0; p < n; p++) {
      const r = ref[p]!;
      const v = mine[p]!;
      if (usable[p] && r >= cut && r > 0 && Number.isFinite(v)) {
        sfr += v * r;
        srr += r * r;
      }
    }
    const scale = srr > 0 ? Math.min(clipHi, Math.max(clipLo, sfr / srr)) : 1;

    const out = new Float32Array(n);
    for (let p = 0; p < n; p++) out[p] = mine[p]! - scale * ref[p]!;
    return {
      pixels: out,
      ok: true,
      refCount: refs.length,
      sameOrientation,
      maxDlamFrac: Math.max(...refs.map((r) => (r.d * step) / f.lambdaUm)),
      maxDlamSteps: Math.max(...refs.map((r) => r.d)),
      minGapDays: Math.min(...refs.map((r) => Math.abs(r.g.mjd - f.mjd))),
      refMeanMjd: refs.reduce((a, r) => a + r.g.mjd, 0) / refs.length,
      scale,
    };
  });
}
