import type { TargetId } from '../data/pack/types';
import type { SkyPosition } from '../data/coords';

export interface Wanderer {
  id: TargetId;
  /** Position at 2026.0 (Gaia DR3 / CatWISE2020, propagated by Physics). */
  at: SkyPosition;
  /** Whether a pack exists for this release yet. */
  ready: boolean;
}

/**
 * Releases per kind of data. The entry's packs and weekly coverage are DR1+QR3 only, made during
 * the event (IRSA: QR3 and DR1 supersede QR2), as is the sky index behind "click anywhere".
 */
export const PACK_RELEASES = ['dr1qr3'] as const;
export const COVERAGE_RELEASES = ['dr1qr3'] as const;

/** QR3's first exposure (IRSA TAP, 13 Nov 2026: DR1 ends at MJD 61174.49, QR3 starts at 61174.506). */
export const QR3_START_MJD = 61174.5;

/** Which SPHEREx releases a dr1qr3 pack's frames actually come from, e.g. ['DR1'] or ['DR1', 'QR3']. */
export function framesReleases(mjds: number[]): string[] {
  const out: string[] = [];
  if (mjds.some((m) => m < QR3_START_MJD)) out.push('DR1');
  if (mjds.some((m) => m >= QR3_START_MJD)) out.push('QR3');
  return out;
}

export const WANDERERS: Wanderer[] = [
  { id: 'barnard', at: { ra: 269.446268, dec: 4.768204 }, ready: true },
  { id: 'w0855', at: { ra: 133.760052, dec: -7.242598 }, ready: true },
  { id: 'epsind-b', at: { ra: 331.09665, dec: -56.800664 }, ready: true },
  { id: 'rw-aur', at: { ra: 76.95609, dec: 30.401128 }, ready: true },
  { id: 'r-dra', at: { ra: 248.167233, dec: 66.755024 }, ready: true },
];

/** Typed positions this close to a wanderer open its case (the challenge's WISE 0855 coordinate is 2.1′ off). */
export const NEAR_WANDERER_DEG = 5 / 60;
