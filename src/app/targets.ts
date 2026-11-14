import type { TargetId } from '../data/pack/types';
import type { SkyPosition } from '../data/coords';

export interface Wanderer {
  id: TargetId;
  /** Position at 2026.0 (Gaia DR3 / CatWISE2020, propagated by Physics). */
  at: SkyPosition;
  /** Whether a pack exists for this release yet. */
  ready: boolean;
  /** Proper motion, mas/yr (pmRA includes cos dec); pipeline/targets.json. 0 for the variables. */
  pm: { ra: number; dec: number };
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
  {
    id: 'barnard',
    at: { ra: 269.446268, dec: 4.768204 },
    ready: true,
    pm: { ra: -801.551, dec: 10362.394 },
  },
  { id: 'w0855', at: { ra: 133.760052, dec: -7.242598 }, ready: true, pm: { ra: -8118, dec: 673 } },
  {
    id: 'epsind-b',
    at: { ra: 331.09665, dec: -56.800664 },
    ready: true,
    pm: { ra: 3966.7, dec: -2536.2 },
  },
  { id: 'rw-aur', at: { ra: 76.95609, dec: 30.401128 }, ready: true, pm: { ra: 0, dec: 0 } },
  { id: 'r-dra', at: { ra: 248.167233, dec: 66.755024 }, ready: true, pm: { ra: 0, dec: 0 } },
];

/** The epoch of the wanderers' positions (`at`). */
export const WANDERER_EPOCH = 2026.0;

export interface PastPlace {
  /** The year the wanderer was closest to the typed spot (straight-line motion). */
  year: number;
  /** How far it has moved from there to its 2026 place, arcsec. */
  movedArcsec: number;
  /** How far the typed spot is from that past place, arcsec. */
  missArcsec: number;
}

/**
 * Whether a typed position is where a moving wanderer used to be: the year on its straight
 * track closest to the spot, if the spot lies within `tolArcsec` of the track and the year is at
 * least `minYears` from 2026. Null otherwise (including for the variables, which don't move).
 * Proper motion only: parallax (≤ 0.55″ here) and Barnard's perspective acceleration (≈ 0.4″
 * since 2000) are ignored, both ≪ the 15″ tolerance (Physics, 14 Nov). Positions are ICRS (J2000);
 * a B1950/FK4 position would be off by up to ~0.7° from precession, not motion, so it isn't
 * converted here (the search box says so).
 */
export function pastPlace(
  w: Wanderer,
  typed: SkyPosition,
  tolArcsec = 15,
  minYears = 2,
): PastPlace | null {
  const vx = w.pm.ra / 1000; // arcsec/yr east
  const vy = w.pm.dec / 1000; // north
  const v2 = vx * vx + vy * vy;
  if (v2 < 0.01) return null;
  const cosd = Math.cos((w.at.dec * Math.PI) / 180);
  let dra = typed.ra - w.at.ra;
  if (dra > 180) dra -= 360;
  if (dra < -180) dra += 360;
  const dx = dra * cosd * 3600;
  const dy = (typed.dec - w.at.dec) * 3600;
  const dt = (dx * vx + dy * vy) / v2;
  const miss = Math.hypot(dx - vx * dt, dy - vy * dt);
  if (miss > tolArcsec || Math.abs(dt) < minYears) return null;
  return {
    year: WANDERER_EPOCH + dt,
    movedArcsec: Math.hypot(vx * dt, vy * dt),
    missArcsec: miss,
  };
}

/** Typed positions this close to a wanderer open its case (the challenge's WISE 0855 coordinate is 2.1′ off). */
export const NEAR_WANDERER_DEG = 5 / 60;
