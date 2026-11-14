/**
 * The Milky Way's glow, from Gaia DR3 star counts (Physics, runs/viewer_data): how many Gaia
 * stars brighter than G = 18 fall in each nside-64 HEALPix pixel. Drawn as a soft glow, on a
 * log scale, under the stars. Catalogue data, not SPHEREx, and labelled so on screen.
 *
 *   milkyway-gaia-dr3-n64.bin  "GMW1", uint32 nside, uint32 npix, uint32 n_all[npix],
 *                              uint32 n_g18[npix], float32 g_flux_sum[npix], little-endian
 */

import type { SkyPosition } from '../data/coords';
import { ang2pixNest, npix } from '../data/healpix';

const MAGIC = 0x31574d47; // "GMW1" read as a little-endian uint32

/** Glow strength 0..1 on an equirectangular grid (RA 0→360 across, Dec +90→−90 down). */
export interface GlowMap {
  width: number;
  height: number;
  values: Float32Array;
}

/** Reads the counts and resamples log(n) onto a grid, scaled between the 5th and 99.5th percentiles. */
export function parseGlow(bin: ArrayBuffer, width = 720): GlowMap {
  const view = new DataView(bin);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Not a Milky Way file');
  const nside = view.getUint32(4, true);
  const n = view.getUint32(8, true);
  if (n !== npix(nside) || bin.byteLength !== 12 + 12 * n) throw new Error('Milky Way file size');
  const g18 = new Uint32Array(bin.slice(12 + 4 * n, 12 + 8 * n));
  const logs = Float32Array.from(g18, (c) => Math.log10(1 + c));
  const sorted = Float32Array.from(logs).sort();
  const lo = sorted[Math.floor(n * 0.05)] ?? 0;
  const hi = sorted[Math.floor(n * 0.995)] ?? 1;
  const height = width / 2;
  const values = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    const dec = 90 - ((j + 0.5) * 180) / height;
    for (let i = 0; i < width; i++) {
      const ra = ((i + 0.5) * 360) / width;
      const v = logs[ang2pixNest(nside, { ra, dec })] ?? lo;
      values[j * width + i] = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    }
  }
  return { width, height, values };
}

/** The glow at a sky position (nearest grid cell). */
export function glowAt(map: GlowMap, p: SkyPosition): number {
  const i = Math.floor(((((p.ra % 360) + 360) % 360) / 360) * map.width) % map.width;
  const j = Math.min(map.height - 1, Math.max(0, Math.floor(((90 - p.dec) / 180) * map.height)));
  return map.values[j * map.width + i] ?? 0;
}
