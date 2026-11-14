/**
 * Known asteroids, comets and planets near a position at a given moment, from IMCCE's SkyBoT
 * cone search (https://ssp.imcce.fr/webservices/skybot/), which answers browser requests.
 *
 * SPHEREx photos are minutes apart and asteroids move arcseconds per minute, so ask once per
 * photo time, not per pass. The observer is the Earth's centre (IAU code 500). SPHEREx is about
 * 7,070 km from it (Earth's radius plus ~700 km), so a main-belt asteroid at 1.5 AU can appear
 * up to ~6.6″ (~1 px) from SkyBoT's place, in a direction that turns with SPHEREx's ~98 min
 * orbit; a near-Earth object can be several pixels off. (Corrected 15 Nov: this said "well under
 * an arcsecond", from using the altitude instead of the distance from Earth's centre. The N5
 * search corrects for it with the header's X_SC/Y_SC/Z_SC; the app doesn't yet.)
 *
 * Written during the event (14 Nov 2026).
 */

import type { SkyPosition } from '../coords';

export interface KnownMover {
  name: string;
  number: number | null;
  /** SkyBoT class, e.g. "MB>Inner", "NEA>Apollo", "Comet", "Planet". */
  kind: string;
  ra: number;
  dec: number;
  vmag: number | null;
  /** Apparent motion, arcsec per hour (RA already multiplied by cos dec, as SkyBoT gives it). */
  raRateArcsecH: number;
  decRateArcsecH: number;
  /** SkyBoT's position uncertainty, arcsec. */
  errArcsec: number;
}

const API = 'https://ssp.imcce.fr/webservices/skybot/api/conesearch.php';
const cache = new Map<string, Promise<KnownMover[]>>();

function hms(s: string): number {
  const [h, m, sec] = s.trim().split(/\s+/).map(Number);
  return ((h ?? 0) + (m ?? 0) / 60 + (sec ?? 0) / 3600) * 15;
}

function dms(s: string): number {
  const t = s.trim();
  const neg = t.startsWith('-');
  const [d, m, sec] = t.replace(/^[+-]/, '').split(/\s+/).map(Number);
  const v = (d ?? 0) + (m ?? 0) / 60 + (sec ?? 0) / 3600;
  return neg ? -v : v;
}

type Row = Record<string, string | number | null | undefined>;

export function parseSkybot(rows: Row[]): KnownMover[] {
  return rows.map((r) => ({
    name: String(r['Name'] ?? ''),
    number: typeof r['Num'] === 'number' ? r['Num'] : r['Num'] ? Number(r['Num']) : null,
    kind: String(r['Class'] ?? ''),
    ra: hms(String(r['RA (hms)'] ?? '0 0 0')),
    dec: dms(String(r['DEC (dms)'] ?? '0 0 0')),
    vmag: r['VMag (mag)'] == null ? null : Number(r['VMag (mag)']),
    raRateArcsecH: Number(r['dRA (arcsec/h)'] ?? 0),
    decRateArcsecH: Number(r['dDEC (arcsec/h)'] ?? 0),
    errArcsec: Number(r['Err (arcsec)'] ?? 0),
  }));
}

/**
 * Known solar-system objects within `radiusDeg` of `at` at time `mjd` (UTC), brightest first.
 * Resolves to [] when there are none (SkyBoT answers 204), and rejects on network errors.
 */
export function knownMovers(
  at: SkyPosition,
  mjd: number,
  radiusDeg: number,
  signal?: AbortSignal,
): Promise<KnownMover[]> {
  const key = `${at.ra.toFixed(3)},${at.dec.toFixed(3)},${mjd.toFixed(3)},${radiusDeg.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const q = new URLSearchParams({
    '-ep': (mjd + 2400000.5).toFixed(5),
    '-ra': at.ra.toFixed(6),
    '-dec': at.dec.toFixed(6),
    '-rd': radiusDeg.toFixed(4),
    '-mime': 'json',
    '-output': 'basic',
    '-loc': '500',
    '-filter': '120',
    '-objFilter': '111',
    '-from': 'Planetes',
  });
  const init: RequestInit = {};
  if (signal) init.signal = signal;
  const p = fetch(`${API}?${q}`, init).then(async (r) => {
    if (r.status === 204) return [];
    if (!r.ok) throw new Error(`SkyBoT: HTTP ${r.status}`);
    const text = await r.text();
    if (!text.trim()) return [];
    const rows = JSON.parse(text) as Row[];
    return parseSkybot(Array.isArray(rows) ? rows : []).sort(
      (a, b) => (a.vmag ?? 99) - (b.vmag ?? 99),
    );
  });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

/**
 * Known movers for many photo times at one spot, gently: one SkyBoT query per quarter-day bucket
 * (centred on the bucket, radius padded by 0.1°, about 60″/h for 6 h), then each object moved
 * linearly to each photo's time with its own rates and kept if it lands within `radiusDeg`.
 * Linear motion over ±3 h is far below a pixel for main-belt objects; near-Earth objects are
 * approximate anyway. Never rejects: a bucket that fails or times out (12 s) gives no markers,
 * and `failed` counts such buckets so the page can say SkyBoT didn't answer.
 */
export async function knownMoversAt(
  at: SkyPosition,
  mjds: number[],
  radiusDeg: number,
  signal?: AbortSignal,
): Promise<{ byMjd: Map<number, KnownMover[]>; failed: number }> {
  const buckets = new Map<number, number[]>();
  for (const m of mjds) {
    const b = Math.floor(m * 4) / 4;
    buckets.set(b, [...(buckets.get(b) ?? []), m]);
  }
  const byMjd = new Map<number, KnownMover[]>();
  let failed = 0;
  const D2R = Math.PI / 180;
  await Promise.all(
    [...buckets].map(async ([b, list]) => {
      const mid = b + 0.125;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      signal?.addEventListener('abort', () => ctl.abort());
      let movers: KnownMover[] = [];
      try {
        movers = await knownMovers(at, mid, radiusDeg + 0.1, ctl.signal);
      } catch {
        failed++;
      } finally {
        clearTimeout(timer);
      }
      for (const m of list) {
        const dtH = (m - mid) * 24;
        byMjd.set(
          m,
          movers
            .map((o) => ({
              ...o,
              ra: o.ra + (o.raRateArcsecH * dtH) / 3600 / Math.max(1e-6, Math.cos(o.dec * D2R)),
              dec: o.dec + (o.decRateArcsecH * dtH) / 3600,
            }))
            .filter((o) => {
              const dra = (o.ra - at.ra) * Math.cos(at.dec * D2R);
              return Math.hypot(dra, o.dec - at.dec) <= radiusDeg;
            }),
        );
      }
    }),
  );
  return { byMjd, failed };
}
