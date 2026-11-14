/**
 * Known asteroids and comets on a photo (14 Nov), as lens marks: SkyBoT's positions for the
 * photo's own time (src/data/live/skybot.ts asks once per quarter day and moves each object to
 * every photo's time with its rates) turned into pack pixels, keeping only what is in the field
 * and bright enough for SPHEREx to show. Near-Earth objects are marked approximate: the
 * positions are seen from the Earth's centre, not from SPHEREx.
 */

import type { SkyPosition } from '../data/coords';
import type { KnownMover } from '../data/live/skybot';

/** Fainter than this, SPHEREx can't show it (about V 18): leave it off the picture. */
export const MAX_VMAG = 19;

export interface MoverMark {
  east: number;
  north: number;
  dEast: number;
  dNorth: number;
  name: string;
  vmag: number | null;
  nearEarth: boolean;
}

/** Each object in pack pixels from `centre` (east left, north up), if in the field and bright. */
export function marksAt(
  movers: KnownMover[],
  centre: SkyPosition,
  size: number,
  scaleArcsec: number,
): MoverMark[] {
  const cosDec = Math.cos((centre.dec * Math.PI) / 180) || 1;
  const half = size / 2 + 1;
  const out: MoverMark[] = [];
  for (const m of movers) {
    if (m.vmag !== null && m.vmag > MAX_VMAG) continue;
    const east = ((((m.ra - centre.ra + 540) % 360) - 180) * cosDec * 3600) / scaleArcsec;
    const north = ((m.dec - centre.dec) * 3600) / scaleArcsec;
    if (Math.abs(east) > half || Math.abs(north) > half) continue;
    out.push({
      east,
      north,
      // SkyBoT's RA rate already includes cos(dec): arcsec of sky per hour.
      dEast: m.raRateArcsecH,
      dNorth: m.decRateArcsecH,
      name: m.name,
      vmag: m.vmag,
      nearEarth: m.kind.startsWith('NEA'),
    });
  }
  return out;
}

/** The search radius for a field: half its diagonal. */
export function fieldRadiusDeg(size: number, scaleArcsec: number): number {
  return (size * scaleArcsec * Math.SQRT1_2) / 3600;
}
