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
 * Stars change brightness with colour, so each frame's reference is scaled by one robust factor
 * (fitted on the brighter reference pixels) before subtracting. SPHEREx stars are only ~2 px
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
}

export interface DifferenceFrame {
  /** This frame minus its reference, both softened (MJy/sr); NaN where unusable, saturated or bad. */
  pixels: Float32Array;
  /** Whether a reference could be built (enough other-date photos near this colour). */
  ok: boolean;
  /** How many photos made the reference. */
  refCount: number;
  /** The largest colour gap among them, as a fraction of this frame's wavelength. */
  maxDlamFrac: number;
  /** The closest date gap among them, days. */
  minGapDays: number;
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
  /** ...and within this colour gap, as a fraction of the wavelength. */
  maxDlamFrac?: number;
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

function median(v: number[]): number {
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : 0.5 * (v[m - 1]! + v[m]!);
}

export function differenceFilm(frames: FilmInput[], opts: FilmOptions = {}): DifferenceFrame[] {
  const k = opts.k ?? 7;
  const minRefs = opts.minRefs ?? 3;
  const gap = opts.minGapDays ?? 30;
  const maxD = opts.maxDlamFrac ?? 0.05;
  const soften = opts.soften ?? 0.6;
  // Bad pixels out first, then the same softening for every frame.
  const soft = frames.map((f) => {
    const v = new Float32Array(f.tile.pixels.length);
    for (let p = 0; p < v.length; p++) v[p] = f.tile.flags[p]! & BAD ? NaN : f.tile.pixels[p]!;
    return softenNaN(v, f.tile.size, soften);
  });
  return frames.map((f, i) => {
    const n = f.tile.pixels.length;
    const none: DifferenceFrame = {
      pixels: new Float32Array(n).fill(NaN),
      ok: false,
      refCount: 0,
      maxDlamFrac: NaN,
      minGapDays: NaN,
      scale: 1,
    };
    if (!Number.isFinite(f.lambdaUm)) return none;
    const refs = frames
      .map((g, j) => ({ g, j, d: Math.abs(g.lambdaUm - f.lambdaUm) / f.lambdaUm }))
      .filter(
        ({ g, j, d }) =>
          j !== i &&
          g.tile.pixels.length === n &&
          Math.abs(g.mjd - f.mjd) >= gap &&
          Number.isFinite(d) &&
          d <= maxD,
      )
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
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
    // colour-driven changes show; clipped, so a real change can't be scaled away entirely.
    const bright: number[] = [];
    for (let p = 0; p < n; p++) if (Number.isFinite(ref[p]!)) bright.push(ref[p]!);
    bright.sort((a, b) => a - b);
    const cut = bright.length ? bright[Math.floor(bright.length * 0.9)]! : Infinity;
    let sfr = 0;
    let srr = 0;
    const mine = soft[i]!;
    for (let p = 0; p < n; p++) {
      const r = ref[p]!;
      const v = mine[p]!;
      if (r >= cut && r > 0 && Number.isFinite(v)) {
        sfr += v * r;
        srr += r * r;
      }
    }
    const scale = srr > 0 ? Math.min(1.5, Math.max(0.67, sfr / srr)) : 1;

    const out = new Float32Array(n);
    for (let p = 0; p < n; p++) out[p] = mine[p]! - scale * ref[p]!;
    return {
      pixels: out,
      ok: true,
      refCount: refs.length,
      maxDlamFrac: Math.max(...refs.map((r) => r.d)),
      minGapDays: Math.min(...refs.map((r) => Math.abs(r.g.mjd - f.mjd))),
      scale,
    };
  });
}
