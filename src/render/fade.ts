/**
 * Fade between the two looks (3b, Viewer's design, 15 Nov): the pixel values blended,
 * (1 − t)·earlier + t·later, shown through the pair's one shared stretch. A steady star is the
 * same in both looks, so it keeps its full brightness at every t; only a mover dims in one place
 * while it brightens in the other. (Fading two layers by opacity would dim everything halfway.)
 * A pixel missing in either look stays missing, and the flags of both are kept.
 */
import type { Tile } from '../data/pack/load';

export function fadedTile(early: Tile, late: Tile, t: number): Tile {
  const n = early.size * early.size;
  const k = Math.max(0, Math.min(1, t));
  const pixels = new Float32Array(n);
  const flags = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = early.pixels[i] ?? NaN;
    const b = late.pixels[i] ?? NaN;
    pixels[i] = Number.isFinite(a) && Number.isFinite(b) ? (1 - k) * a + k * b : NaN;
    flags[i] = (early.flags[i] ?? 0) | (late.flags[i] ?? 0);
  }
  return { id: `fade-${Math.round(k * 100)}`, size: early.size, pixels, flags };
}
