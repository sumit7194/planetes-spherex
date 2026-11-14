/**
 * Survey passes over one spot, by Physics' rule (14 Nov), the same as pipeline/build_band.py
 * (tested there on the same synthetic cells):
 *   - a new pass starts after a gap of more than 60 days;
 *   - a spot photographed with no such gap for more than half a year (near the ecliptic poles,
 *     watched on every orbit) counts one pass per six months of its span.
 */
const GAP_DAYS = 60;
const HALF_YEAR = 182.6;

/** The start (MJD) of each pass over a spot photographed at these times. */
export function passStarts(mjds: readonly number[]): number[] {
  const t = [...mjds].sort((a, b) => a - b);
  const first = t[0];
  const last = t[t.length - 1];
  if (first === undefined || last === undefined) return [];
  // Each photo after a gap of more than 60 days starts a pass.
  const after = t.filter((m, i) => i > 0 && m - (t[i - 1] ?? m) > GAP_DAYS);
  if (!after.length && last - first > 182) {
    const n = 1 + Math.floor((last - first) / HALF_YEAR);
    return Array.from({ length: n }, (_, k) => first + k * HALF_YEAR);
  }
  return [first, ...after];
}

export function passCount(mjds: readonly number[]): number {
  return passStarts(mjds).length;
}

/** The homepage band's data (pipeline/build_band.py → public/data/band/band.json). */
export type BandFile = {
  format: 'planetes-band/1';
  /** Per target: every pack photo as [mjd, wavelength µm, detector]. */
  targets: Record<string, [number, number, number][]>;
  weeks: { start: number; end: number; label: string; startUtc: string }[];
  survey: {
    passes: Record<'1' | '2' | '3', { fraction: number; firstWeek95: string | null }>;
    line: string;
    lastWeek: string;
    releaseSeamMjd: number;
  };
};

/** Photos per week, for a spot's row of week bars. */
export function weekCounts(mjds: readonly number[], weeks: BandFile['weeks']): number[] {
  const out = weeks.map(() => 0);
  for (const m of mjds) {
    const k = weeks.findIndex((w) => m >= w.start && m < w.end);
    if (k >= 0) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
