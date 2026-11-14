/**
 * The Hammer–Aitoff projection: the whole sky in a 2:1 ellipse, equal-area, so a patch near a
 * pole looks as big as the same patch on the equator (Physics: an honest all-sky map, as
 * astronomers draw them; the plain RA–Dec grid it replaces stretched the poles into bands).
 *
 * Longitude λ is measured from the map's centre, positive to the east (drawn to the left, as
 * the sky is seen from Earth); latitude φ is declination. Both in radians.
 * x lies in [−2√2, 2√2], y in [−√2, √2].
 */

const SQRT2 = Math.SQRT2;

export function hammer(lambda: number, phi: number): [number, number] {
  const c = Math.cos(phi);
  const d = Math.sqrt(1 + c * Math.cos(lambda / 2));
  return [(2 * SQRT2 * c * Math.sin(lambda / 2)) / d, (SQRT2 * Math.sin(phi)) / d];
}

/** The inverse, or null outside the ellipse. */
export function unhammer(x: number, y: number): [number, number] | null {
  if ((x / (2 * SQRT2)) ** 2 + (y / SQRT2) ** 2 > 1) return null;
  const z = Math.sqrt(1 - (x / 4) ** 2 - (y / 2) ** 2);
  const lambda = 2 * Math.atan2(z * x, 2 * (2 * z * z - 1));
  const phi = Math.asin(Math.max(-1, Math.min(1, z * y)));
  return [lambda, phi];
}
