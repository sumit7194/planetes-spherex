/**
 * Stepping out from SPHEREx: where the camera is and where it looks, for a scroll position
 * n from 0 (through SPHEREx's eye) to 1 (Earth and the orbit from space). Plain numbers, so
 * the path can be tested; the sky and the 3D scene both read it.
 *
 * The plan (Neural's pacing and comfort rules, Physics' true scale):
 * - Distance from SPHEREx grows log-linearly with scroll, so each tenfold step costs the same
 *   scroll: 0 → CLOSE_M (backing out), a short hold at the close-up (the telescope you were
 *   looking through, at true size), then out to the end, and a short hold there.
 * - The camera backs out behind SPHEREx along its track, a little above and to its sunlit
 *   side, aim on SPHEREx: Earth's horizon lies just below it, and the day-night line (which
 *   the orbit follows) runs ahead to the horizon, as in NASA's own artist's view (PIA26531).
 *   Pulling back, SPHEREx shrinks against a curving Earth: the motion has something to be
 *   measured against. Only in the last decades does the camera arc to the Sun's side of Earth
 *   and the aim slide to Earth's centre. North stays up (the sky's camera never rolls).
 * - Everything is at true relative scale; the stars are directions at infinity, so the sky
 *   behind is the same pinhole whatever the camera's position.
 *
 * Units: Earth radii (equatorial), the sky's axes.
 */
import { EARTH_EQ_KM, type Vec3 } from './orbit';

/** The close-up distance from SPHEREx, metres (it is 2.6 m tall, 3.2 m across). */
export const CLOSE_M = 3.5;
/** Where the close-up hold ends, metres. */
const HOLD_M = 5.5;
/** The end: the camera this far from Earth's centre, Earth radii (Earth ~26° across). */
export const END_RE = 4.5;
/** Scroll fractions: backing out, the close-up hold, and the hold at the end. */
const BACK = 0.1;
const HOLD = 0.18;
const OUT = 0.92;

const M_PER_RE = EARTH_EQ_KM * 1000;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Spherical interpolation between unit vectors (straight lerp when nearly parallel). */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  const ang = Math.acos(c);
  if (ang < 1e-6) return a;
  const s = Math.sin(ang);
  const ka = Math.sin((1 - t) * ang) / s;
  const kb = Math.sin(t * ang) / s;
  return norm([a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb]);
}

/** Distance from SPHEREx, metres, at scroll n (0–1), given the end's distance in metres. */
export function stepOutDistanceM(n: number, endM: number): number {
  if (n <= 0) return 0;
  if (n < BACK) return CLOSE_M * smooth(n / BACK);
  if (n < HOLD)
    return Math.exp(lerp(Math.log(CLOSE_M), Math.log(HOLD_M), (n - BACK) / (HOLD - BACK)));
  if (n < OUT) return Math.exp(lerp(Math.log(HOLD_M), Math.log(endM), (n - HOLD) / (OUT - HOLD)));
  return endM;
}

export interface StepOut {
  /** The camera, Earth radii from Earth's centre. */
  cam: Vec3;
  /** Where it looks (unit). */
  aim: Vec3;
  /** Its distance from SPHEREx, metres. */
  fromSpherexM: number;
  /** 0 while the aim is on SPHEREx, 1 once it is on Earth's centre. */
  toEarth: number;
}

/**
 * The camera at scroll n. `sat` is SPHEREx's place (unit, from Earth's centre), `look` its
 * line of sight, `sun` the Sun's direction, `orbitRe` the orbit's radius in Earth radii.
 */
export function stepOut(
  n: number,
  sat: Vec3,
  look: Vec3,
  sun: Vec3,
  orbitRe: number,
  track?: Vec3,
): StepOut {
  const S: Vec3 = [sat[0] * orbitRe, sat[1] * orbitRe, sat[2] * orbitRe];
  const end: Vec3 = [sun[0] * END_RE, sun[1] * END_RE, sun[2] * END_RE];
  const toEnd = add(end, S, -1);
  const endM = Math.hypot(...toEnd) * M_PER_RE;
  const d = stepOutDistanceM(n, endM);

  // First behind SPHEREx along its track (`track`: the way it travels), a little above it and
  // to its sunlit side; then round to the end.
  const up = norm(sat);
  const sunFlat = add(sun, up, -dot(sun, up));
  const side: Vec3 = Math.hypot(...sunFlat) < 1e-6 ? norm([up[1], -up[0], 0]) : norm(sunFlat);
  const along: Vec3 = track
    ? norm(add(track, up, -dot(track, up)))
    : norm([
        side[1] * up[2] - side[2] * up[1],
        side[2] * up[0] - side[0] * up[2],
        side[0] * up[1] - side[1] * up[0],
      ]);
  const back0 = norm([
    -along[0] * 0.85 + side[0] * 0.4 + up[0] * 0.25,
    -along[1] * 0.85 + side[1] * 0.4 + up[1] * 0.25,
    -along[2] * 0.85 + side[2] * 0.4 + up[2] * 0.25,
  ]);
  const decade = (m: number) => Math.log10(Math.max(1e-3, m));
  const span = (from: number) => smooth((decade(d) - from) / (decade(endM) - from));
  const dir = slerp(back0, norm(toEnd), span(4.3)); // from ~20 km
  const cam = add(S, dir, d / M_PER_RE);

  // The aim: from the patch onto SPHEREx while backing out (framed with a little of the sky
  // it looks at), then to Earth's centre over the last decades (from ~500 km).
  // SPHEREx's middle: 1.3 m up its axis from the separation ring (its place on the orbit).
  const mid = add(S, look, 1.3 / M_PER_RE);
  const toCraft = d > 0 ? norm(add(mid, cam, -1)) : look;
  const onCraft = toCraft;
  const first = slerp(look, onCraft, smooth(n / BACK));
  const toEarth = span(5.7);
  const aim = slerp(first, norm([-cam[0], -cam[1], -cam[2]]), toEarth);
  return { cam, aim, fromSpherexM: d, toEarth };
}
