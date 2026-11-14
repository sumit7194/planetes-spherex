/**
 * SPHEREx's orbit from its published elements, and Earth's shape and turn: the plain numbers
 * behind the 3D scene. No three.js here, so it is cheap to test.
 *
 * Frame: equatorial (J2000-ish), x towards RA 0, y towards RA 90°, z to the north celestial pole.
 *
 * Sources:
 * - Orbit: Bock et al. 2025, "The SPHEREx Satellite Mission" (arXiv:2511.02985), Table 1:
 *   semi-major axis 7037.4 km, inclination 97.951°, eccentricity 0.00034, mean local time of
 *   the ascending node 6:00 AM (Sun-synchronous, so the node keeps that local time all year).
 * - Earth: WGS 84 radii.
 */

export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;

/** WGS 84: equatorial and polar radii, km. */
export const EARTH_EQ_KM = 6378.137;
export const EARTH_POLAR_KM = 6356.752;

/** SPHEREx's orbit (arXiv:2511.02985, Table 1). */
export const SPHEREX_ORBIT = {
  semiMajorKm: 7037.4,
  inclinationDeg: 97.951,
  eccentricity: 0.00034,
  /** Mean local time of the ascending node, hours. */
  ltanHours: 6,
  /** One orbit, minutes: 2π·sqrt(a³/μ) with μ = 398600.4418 km³/s². */
  periodMin: (2 * Math.PI * Math.sqrt(7037.4 ** 3 / 398600.4418)) / 60,
} as const;

/** Height above the equator, km (about 659 km). */
export const SPHEREX_ALT_KM = SPHEREX_ORBIT.semiMajorKm - EARTH_EQ_KM;

/** Days since J2000.0 (12h UT, 1 Jan 2000) for a Modified Julian Date. */
function daysJ2000(mjd: number): number {
  return mjd - 51544.5;
}

/** Greenwich mean sidereal time, degrees (IAU 1982, good to a fraction of a degree). */
export function gmstDeg(mjd: number): number {
  const d = daysJ2000(mjd);
  return (((280.46061837 + 360.98564736629 * d) % 360) + 360) % 360;
}

/** The mean Sun's right ascension, degrees: what "mean local time" is measured from. */
export function meanSunRaDeg(mjd: number): number {
  return (((280.46 + 0.9856474 * daysJ2000(mjd)) % 360) + 360) % 360;
}

/**
 * The ascending node's right ascension, degrees. A node at local time T lies (T − 12 h)·15°
 * east of the mean Sun, so 6:00 AM puts it 90° west of the Sun: on the dawn side of Earth.
 */
export function nodeRaDeg(mjd: number): number {
  const ra = meanSunRaDeg(mjd) + (SPHEREX_ORBIT.ltanHours - 12) * 15;
  return ((ra % 360) + 360) % 360;
}

/**
 * The orbit's frame on a date: `normal` is the way the orbit turns (the right-hand rule along
 * the motion), `node` points at the ascending node, and `ahead` is 90° on along the motion
 * (`normal × node`), so a point at argument of latitude u is node·cos u + ahead·sin u.
 */
export function orbitFrame(mjd: number): { normal: Vec3; node: Vec3; ahead: Vec3 } {
  const i = SPHEREX_ORBIT.inclinationDeg * RAD;
  const o = nodeRaDeg(mjd) * RAD;
  const node: Vec3 = [Math.cos(o), Math.sin(o), 0];
  const normal: Vec3 = [Math.sin(i) * Math.sin(o), -Math.sin(i) * Math.cos(o), Math.cos(i)];
  const ahead: Vec3 = [
    normal[1] * node[2] - normal[2] * node[1],
    normal[2] * node[0] - normal[0] * node[2],
    normal[0] * node[1] - normal[1] * node[0],
  ];
  return { normal, node, ahead };
}

/** SPHEREx's place, km from Earth's centre, at argument of latitude `u` (degrees). */
export function orbitPoint(mjd: number, u: number): Vec3 {
  const { node, ahead } = orbitFrame(mjd);
  const a = SPHEREX_ORBIT.semiMajorKm;
  const c = Math.cos(u * RAD);
  const s = Math.sin(u * RAD);
  return [
    a * (node[0] * c + ahead[0] * s),
    a * (node[1] * c + ahead[1] * s),
    a * (node[2] * c + ahead[2] * s),
  ];
}

/**
 * The argument of latitude whose overhead point (zenith) is closest to `look`. We have no
 * orbital phase for a photo, so this is how the scene places SPHEREx: where on its real orbit
 * it could have taken a photo looking that way (Physics: approximate, within ~35°).
 */
export function nearestU(mjd: number, look: Vec3): number {
  const { node, ahead } = orbitFrame(mjd);
  const x = look[0] * node[0] + look[1] * node[1] + look[2] * node[2];
  const y = look[0] * ahead[0] + look[1] * ahead[1] + look[2] * ahead[2];
  return (((Math.atan2(y, x) / RAD) % 360) + 360) % 360;
}
