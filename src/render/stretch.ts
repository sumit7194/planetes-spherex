/**
 * One brightness stretch shared by every tile being compared. A per-frame stretch would
 * normalise away real brightness changes, so it is never used for comparisons.
 */

export interface Stretch {
  /** Value mapped to black. */
  floor: number;
  /** Softening scale of the asinh: smaller shows fainter detail. */
  soft: number;
  /** Value mapped to white. */
  ceiling: number;
}

function percentile(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i] ?? 0;
}

/** A robust asinh stretch from all finite pixels of the given tiles together. */
export function sharedStretch(tiles: Float32Array[], { floorP = 0.05, ceilingP = 1 } = {}) {
  const values = new Float32Array(tiles.reduce((n, t) => n + t.length, 0));
  let n = 0;
  for (const t of tiles) for (const v of t) if (Number.isFinite(v)) values[n++] = v;
  const finite = values.subarray(0, n).sort();
  const floor = percentile(finite, floorP);
  const median = percentile(finite, 0.5);
  const ceiling = Math.max(percentile(finite, ceilingP), floor + 1e-6);
  const soft = Math.max((median - floor) * 2, (ceiling - floor) * 0.002);
  return { floor, soft, ceiling } satisfies Stretch;
}

/** Maps a value to 0–255 through the shared stretch; NaN maps to null ("no data"). */
export function toGrey(v: number, s: Stretch): number | null {
  if (!Number.isFinite(v)) return null;
  const top = Math.asinh((s.ceiling - s.floor) / s.soft);
  const t = Math.asinh(Math.max(0, v - s.floor) / s.soft) / top;
  return Math.round(255 * Math.min(1, Math.max(0, t)));
}
