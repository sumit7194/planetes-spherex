/**
 * What changed between two looks (14 Nov, from the event viewer's difference mode): the later
 * look minus the earlier, pixel by pixel, in units of the difference's own noise, on a fixed
 * ±5σ scale, so a 2σ wobble never looks like a 5σ change.
 *
 * Strict mask: a pixel flagged (saturated or rejected) in either look is not compared; it is
 * drawn hatched, never as zero. The noise is 1.4826 × the median absolute deviation of the
 * compared pixels (robust: one moving star barely changes it), after removing the median
 * difference, which takes out a sky level that differs between the two looks.
 */

import type { Tile } from '../data/pack/load';
import { FlagMask } from '../data/pack/types';

export const DIFF_LIMIT = 5;
export const STRICT_MASK = FlagMask.saturated | FlagMask.rejected;
/** Fewer compared pixels than this and the noise estimate means little: no difference. */
const MIN_PIXELS = 64;
/** Each pack pixel is drawn as a block this many canvas pixels wide, so hatching fits inside. */
const BLOCK = 4;

/**
 * One look, made for a difference: per detector, the mean of its photos with every flagged
 * pixel left out (photo by photo, not stack by stack); then the equal-weight mean over
 * `detectors`, which should be the detectors both looks have, so both mix colours alike.
 * A pixel counts in a detector only where at least half of that detector's photos could use it
 * (a pixel saturated in most photos would otherwise be the mean of its few faint ones), and in
 * the look only where every detector counts it: never filled in by the others. Flags mark only
 * the pixels left out: "rejected", plus "saturated" if any photo was saturated there.
 */
export function strictLook(
  id: string,
  photos: { detector: number; tile: Tile }[],
  detectors: number[],
  mask = STRICT_MASK,
): Tile | null {
  const first = photos[0]?.tile;
  if (!first || !detectors.length) return null;
  const size = first.size;
  const n = size * size;
  const sum = new Float64Array(n);
  const saturated = new Uint8Array(n);
  const filled = new Uint8Array(n);
  for (const d of detectors) {
    const own = photos.filter((p) => p.detector === d && p.tile.size === size);
    const dSum = new Float64Array(n);
    const dCount = new Uint16Array(n);
    for (const { tile } of own) {
      for (let k = 0; k < n; k++) {
        const f = tile.flags[k] ?? 0;
        if (f & FlagMask.saturated) saturated[k] = 1;
        const v = tile.pixels[k] ?? NaN;
        if (f & mask || !Number.isFinite(v)) continue;
        dSum[k] = (dSum[k] ?? 0) + v;
        dCount[k] = (dCount[k] ?? 0) + 1;
      }
    }
    const enough = Math.max(1, Math.ceil(own.length / 2));
    for (let k = 0; k < n; k++) {
      if ((dCount[k] ?? 0) < enough) continue;
      sum[k] = (sum[k] ?? 0) + (dSum[k] ?? 0) / (dCount[k] ?? 1);
      filled[k] = (filled[k] ?? 0) + 1;
    }
  }
  const pixels = new Float32Array(n);
  const flags = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (filled[k] === detectors.length) pixels[k] = (sum[k] ?? 0) / detectors.length;
    else {
      pixels[k] = NaN;
      flags[k] = FlagMask.rejected | (saturated[k] ? FlagMask.saturated : 0);
    }
  }
  return { id, size, pixels, flags };
}

export interface Difference {
  /** Pixels in σ units (NaN where masked); flags are the union of both looks. */
  tile: Tile;
  /** Noise of the difference, in the tiles' own units (MJy/sr). */
  sigma: number;
  masked: number;
}

function median(xs: Float64Array): number {
  const s = xs.slice().sort();
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] ?? NaN) : ((s[m - 1] ?? NaN) + (s[m] ?? NaN)) / 2;
}

export function difference(early: Tile, late: Tile, mask = STRICT_MASK): Difference | null {
  if (early.size !== late.size) return null;
  const n = early.size * early.size;
  const raw = new Float64Array(n).fill(NaN);
  const flags = new Uint8Array(n);
  let masked = 0;
  for (let i = 0; i < n; i++) {
    const f = (early.flags[i] ?? 0) | (late.flags[i] ?? 0);
    flags[i] = f;
    const d = (late.pixels[i] ?? NaN) - (early.pixels[i] ?? NaN);
    if (f & mask || !Number.isFinite(d)) masked++;
    else raw[i] = d;
  }
  const kept = raw.filter(Number.isFinite);
  if (kept.length < MIN_PIXELS) return null;
  const mid = median(kept);
  const sigma = 1.4826 * median(kept.map((d) => Math.abs(d - mid)));
  if (!(sigma > 0)) return null;
  const pixels = new Float32Array(n);
  for (let i = 0; i < n; i++) pixels[i] = ((raw[i] ?? NaN) - mid) / sigma;
  return {
    tile: { id: `${late.id}-minus-${early.id}`, size: early.size, pixels, flags },
    sigma,
    masked,
  };
}

/** Grey for no change, white for brighter in the later look, black for fainter. */
const MID = [92, 97, 110];
const UP = [246, 247, 250];
const DOWN = [6, 8, 14];

/** The colour of a value in σ units, clamped to ±limit (shared with the legend). */
export function diffColour(z: number, limit = DIFF_LIMIT): [number, number, number] {
  const t = Math.max(-1, Math.min(1, z / limit));
  const end = t >= 0 ? UP : DOWN;
  const u = Math.abs(t);
  return [0, 1, 2].map((j) => Math.round((MID[j] ?? 0) + ((end[j] ?? 0) - (MID[j] ?? 0)) * u)) as [
    number,
    number,
    number,
  ];
}

export function diffGradient(limit = DIFF_LIMIT): string {
  const stops = [-1, -0.5, 0, 0.5, 1].map((t) => `rgb(${diffColour(t * limit, limit).join(' ')})`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Draws a difference tile: pack rows run south → north, so rows are flipped. */
export function renderDifference(tile: Tile, limit = DIFF_LIMIT): HTMLCanvasElement {
  const n = tile.size;
  const c = document.createElement('canvas');
  c.width = c.height = n * BLOCK;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(n * BLOCK, n * BLOCK);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const z = tile.pixels[row * n + col] ?? NaN;
      const fill = Number.isFinite(z) ? diffColour(z, limit) : null;
      for (let dy = 0; dy < BLOCK; dy++) {
        for (let dx = 0; dx < BLOCK; dx++) {
          // Masked: dark, with one diagonal stripe per pixel (hatched, never a value).
          const rgb = fill ?? ((dx + dy) % BLOCK === 0 ? [120, 128, 150] : [22, 26, 40]);
          const at = (((n - 1 - row) * BLOCK + dy) * n * BLOCK + col * BLOCK + dx) * 4;
          img.data.set([rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0, 255], at);
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
