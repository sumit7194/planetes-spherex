/**
 * The Equal Earth projection (Šavrič, Patterson and Jenny 2018): equal-area like Hammer–Aitoff,
 * but with flat poles and a rounded-rectangle outline that fills its 2:1 box better, so a full-page
 * sky map wastes less of the page (Viewer, 14 Nov). Longitude λ from the map's centre (east
 * positive), latitude φ, in radians. x lies in [−XMAX, XMAX], y in [−YMAX, YMAX].
 */
const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;

export function equalEarth(lambda: number, phi: number): [number, number] {
  const t = Math.asin(M * Math.sin(phi));
  const t2 = t * t;
  const t6 = t2 * t2 * t2;
  const x =
    (2 * Math.sqrt(3) * lambda * Math.cos(t)) /
    (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1));
  const y = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x, y];
}

export const EE_XMAX = equalEarth(Math.PI, 0)[0];
export const EE_YMAX = equalEarth(0, Math.PI / 2)[1];

/** The inverse (Newton on the parametric latitude), or null outside the outline. */
export function unEqualEarth(x: number, y: number): [number, number] | null {
  if (Math.abs(y) > EE_YMAX) return null;
  let t = y / A1;
  for (let i = 0; i < 12; i++) {
    const t2 = t * t;
    const t6 = t2 * t2 * t2;
    const fy = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - y;
    const fpy = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
    const dt = fy / fpy;
    t -= dt;
    if (Math.abs(dt) < 1e-12) break;
  }
  const t2 = t * t;
  const t6 = t2 * t2 * t2;
  const lambda =
    (3 * x * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))) / (2 * Math.sqrt(3) * Math.cos(t));
  if (Math.abs(lambda) > Math.PI + 1e-9) return null;
  const phi = Math.asin(Math.max(-1, Math.min(1, Math.sin(t) / M)));
  return [lambda, phi];
}
