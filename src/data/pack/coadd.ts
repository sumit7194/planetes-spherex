/**
 * Adding photos together: the mean of many photos on the same grid, pixel by pixel, skipping
 * squares a photo doesn't cover (NaN). The challenge suggests it per detector array, to lift
 * faint things out of the noise; the noise of a mean of n photos falls roughly as 1/√n.
 */

import type { Tile } from './load';

/** The mean of same-size tiles; flags are OR'd, so nothing a photo flagged is lost. */
export function coadd(id: string, tiles: Tile[]): Tile {
  const first = tiles[0];
  if (!first) throw new Error('nothing to add up');
  const n = first.size * first.size;
  const sum = new Float64Array(n);
  const count = new Uint16Array(n);
  const flags = new Uint8Array(n);
  for (const t of tiles) {
    if (t.size !== first.size) throw new Error(`${t.id} is not ${first.size} × ${first.size}`);
    for (let k = 0; k < n; k++) {
      const v = t.pixels[k] ?? NaN;
      if (Number.isFinite(v)) {
        sum[k] = (sum[k] ?? 0) + v;
        count[k] = (count[k] ?? 0) + 1;
      }
      flags[k] = (flags[k] ?? 0) | (t.flags[k] ?? 0);
    }
  }
  const pixels = new Float32Array(n);
  for (let k = 0; k < n; k++) pixels[k] = (count[k] ?? 0) ? (sum[k] ?? 0) / (count[k] ?? 1) : NaN;
  return { id, size: first.size, pixels, flags };
}
