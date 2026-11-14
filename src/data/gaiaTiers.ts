/**
 * Fainter stars as the sky zooms in (Sumit, 14 Nov): Gaia DR3 by sky patch, in tiers. Each tier
 * is a HEALPix order (patch size) and a G-magnitude range, chosen so about 16 patches cover the
 * view and a patch holds at most a few thousand stars even in the Milky Way. Shared by the cloud
 * helper (cloud/live: which rows a patch query returns) and the page (which patches a view needs),
 * so the two can't drift.
 *
 * Gaia's own source_id carries its HEALPix level-12 NESTED cell (source_id / 2^35), so a patch is
 * a fast source_id range on ESA's archive, not a geometry search.
 */

export interface GaiaTier {
  /** HEALPix order: nside = 2^order, NESTED. */
  order: number;
  /** G range [lo, hi). */
  gLo: number;
  gHi: number;
}

/** Patch edge ≈ 58.6° / 2^order: 7.3°, 1.8°, 27′, 7′, 1.7′. */
export const GAIA_TIERS: readonly GaiaTier[] = [
  { order: 3, gLo: 7.5, gHi: 10 },
  { order: 5, gLo: 10, gHi: 12 },
  { order: 7, gLo: 12, gHi: 14 },
  { order: 9, gLo: 14, gHi: 16 },
  { order: 11, gLo: 16, gHi: 18 },
];

/** Most rows one patch may return (brightest first), so a dense cell can't flood the page. */
export const GAIA_PATCH_MAX = 5000;

/** Gaia DR3 source_id range [lo, hi] of a NESTED pixel at `order` (exact, as BigInt). */
export function sourceIdRange(order: number, pix: number): [bigint, bigint] {
  const per = 4n ** BigInt(12 - order) * 2n ** 35n;
  const lo = BigInt(pix) * per;
  return [lo, lo + per - 1n];
}

export function tierOf(order: number): GaiaTier | undefined {
  return GAIA_TIERS.find((t) => t.order === order);
}
