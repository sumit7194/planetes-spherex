/**
 * Where the Sun is on the sky, and the path it follows through the year (the ecliptic).
 * Low-precision formulae (USNO / Meeus), good to about 0.01°: plenty for a map.
 */

import type { SkyPosition } from './coords';

const RAD = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12);

/** Days since J2000.0. */
function daysSinceJ2000(date: Date): number {
  return (date.getTime() - J2000_MS) / 86_400_000;
}

/** Mean obliquity of the ecliptic, degrees. */
function obliquity(n: number): number {
  return 23.439 - 0.0000004 * n;
}

/** Equatorial position of a point on the ecliptic at longitude `lon` (degrees). */
export function eclipticPoint(lon: number, date = new Date()): SkyPosition {
  const e = obliquity(daysSinceJ2000(date)) * RAD;
  const l = lon * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(l)) / RAD;
  return { ra: (ra + 360) % 360, dec };
}

/** The Sun's apparent ecliptic longitude on a date, degrees. */
export function sunLongitude(date: Date): number {
  const n = daysSinceJ2000(date);
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  return (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g) + 360) % 360;
}

/** The Sun's position on the sky on a date. */
export function sunPosition(date = new Date()): SkyPosition {
  return eclipticPoint(sunLongitude(date), date);
}

/** The ecliptic as a closed ring of positions, every `stepDeg` of longitude. */
export function eclipticRing(stepDeg = 3, date = new Date()): SkyPosition[] {
  const pts: SkyPosition[] = [];
  for (let lon = 0; lon <= 360; lon += stepDeg) pts.push(eclipticPoint(lon, date));
  return pts;
}
