/**
 * Riding with SPHEREx along its real pointing: Physics' timelines, one row per exposure
 * (runs/viewer_data/pointing, from each QR2 file's header WCS), replayed on a faster clock.
 * SPHEREx stares through each exposure, then slews to the next (Physics: step, then hold;
 * don't tween smoothly).
 *
 * Slew time from Bock et al. 2025 (arXiv:2511.02985): 19.7 s + 1.088 s per degree for large
 * slews; never more than a third of the gap between exposures. Long gaps (downlinks,
 * calibration) are shortened on screen and said to be gaps.
 */

/** [mjd, ra°, dec°, position angle°, detectors, how the centre was found]. */
export type PointingRow = [number, number, number, number, number, string];

export interface Timeline {
  label: string;
  rows: PointingRow[];
  caveats?: string[];
}

/** The ride's clock runs this many times faster than SPHEREx did (said on screen). */
export const RIDE_SPEEDUP = 10;
/** A gap longer than this (s) is a downlink or calibration, shown in GAP_SHOWN_S on screen. */
const GAP_S = 400;
const GAP_SHOWN_S = 6;

const RAD = Math.PI / 180;
const DAY_S = 86_400;

export function separationDeg(a: [number, number], b: [number, number]): number {
  const c =
    Math.sin(a[1] * RAD) * Math.sin(b[1] * RAD) +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((a[0] - b[0]) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}

/** Real seconds for SPHEREx to slew `deg` and settle, within a gap of `gapS` seconds. */
export function slewSeconds(deg: number, gapS: number): number {
  if (deg < 0.05) return 0;
  return Math.min(19.7 + 1.088 * deg, gapS / 3);
}

/** The row whose pointing is nearest `at` (ra, dec): where a ride from here starts. */
export function nearestRow(rows: PointingRow[], at: [number, number]): number {
  let best = 0;
  let bestSep = Infinity;
  rows.forEach((r, i) => {
    const s = separationDeg([r[1], r[2]], at);
    if (s < bestSep) {
      bestSep = s;
      best = i;
    }
  });
  return best;
}

/** How fast the clock runs through the gap after row i: the speed-up, or faster in a long gap. */
export function speedAfter(rows: PointingRow[], i: number): number {
  const a = rows[i];
  const b = rows[i + 1];
  if (!a || !b) return RIDE_SPEEDUP;
  const gap = (b[0] - a[0]) * DAY_S;
  return gap > GAP_S ? gap / GAP_SHOWN_S : RIDE_SPEEDUP;
}

export interface RidePoint {
  ra: number;
  dec: number;
  /** The row being held, or slewed away from. */
  row: number;
  /** True while slewing between exposures. */
  slewing: boolean;
  /** True inside a long gap (a downlink or calibration). */
  gap: boolean;
}

/** Where SPHEREx points at time `mjd` along the timeline (clamped to its ends). */
export function pointingAt(rows: PointingRow[], mjd: number): RidePoint {
  const first = rows[0];
  if (!first) return { ra: 0, dec: 0, row: 0, slewing: false, gap: false };
  let i = 0;
  // Binary search for the last row at or before `mjd`.
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((rows[mid]?.[0] ?? Infinity) <= mjd) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const a = rows[i] ?? first;
  const b = rows[i + 1];
  if (!b || mjd <= a[0]) return { ra: a[1], dec: a[2], row: i, slewing: false, gap: false };
  const gapS = (b[0] - a[0]) * DAY_S;
  const deg = separationDeg([a[1], a[2]], [b[1], b[2]]);
  const slew = slewSeconds(deg, gapS);
  const intoS = (mjd - a[0]) * DAY_S;
  const gap = gapS > GAP_S;
  if (intoS < gapS - slew) return { ra: a[1], dec: a[2], row: i, slewing: false, gap };
  // Slewing: eased along the great circle from a to b.
  const t = (intoS - (gapS - slew)) / slew;
  const e = t * t * (3 - 2 * t);
  const [ra, dec] = greatCircle([a[1], a[2]], [b[1], b[2]], e);
  return { ra, dec, row: i, slewing: true, gap: false };
}

function greatCircle(a: [number, number], b: [number, number], t: number): [number, number] {
  const v = (p: [number, number]): [number, number, number] => [
    Math.cos(p[1] * RAD) * Math.cos(p[0] * RAD),
    Math.cos(p[1] * RAD) * Math.sin(p[0] * RAD),
    Math.sin(p[1] * RAD),
  ];
  const [ax, ay, az] = v(a);
  const [bx, by, bz] = v(b);
  const ang = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz)));
  const s = Math.sin(ang);
  const ka = ang < 1e-9 ? 1 - t : Math.sin((1 - t) * ang) / s;
  const kb = ang < 1e-9 ? t : Math.sin(t * ang) / s;
  const x = ax * ka + bx * kb;
  const y = ay * ka + by * kb;
  const z = az * ka + bz * kb;
  const l = Math.hypot(x, y, z) || 1;
  return [(((Math.atan2(y, x) / RAD) % 360) + 360) % 360, Math.asin(z / l) / RAD];
}
